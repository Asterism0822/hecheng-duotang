/**
 * 合成多糖 —— 零依赖静态服务器
 *
 * 只做一件事：把 public/ 里的页面发给浏览器。
 * 分数、游戏记录、自定义贴图全都在玩家自己的浏览器里（localStorage），
 * 服务器不保存任何玩家数据。
 *
 * 启动：node server.mjs            （默认 0.0.0.0:3000）
 * 环境变量：PORT / HOST
 */

import http from 'node:http';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }
  if (decoded.includes('\0')) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  const rel = decoded === '/' ? '/index.html' : decoded;
  const target = path.join(PUBLIC_DIR, path.normalize(rel));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    sendText(res, 404, 'Not Found');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
    ...SECURITY_HEADERS,
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(target)
    .on('error', () => res.destroy())
    .pipe(res);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    let pathname = '/';
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      pathname = url.pathname;

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method Not Allowed');
        return;
      }

      await serveStatic(req, res, pathname);
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
      else res.end();
    }
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

export async function start() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actual = server.address().port;
  console.log('');
  console.log('  合成多糖 已启动');
  console.log(`  本机：   http://127.0.0.1:${actual}`);
  for (const ip of lanAddresses()) {
    console.log(`  局域网： http://${ip}:${actual}`);
  }
  console.log('  所有分数与记录只存在玩家自己的浏览器里。');
  console.log('');

  const shutdown = () => {
    console.log('\n正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  start().catch((err) => {
    console.error('启动失败：', err.message);
    process.exit(1);
  });
}
