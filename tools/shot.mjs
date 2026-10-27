/**
 * 开发期：用无头浏览器把一局玩完，顺便截图检查界面。
 * 用法：先起 Edge（--remote-debugging-port=9333），再 node tools/shot.mjs
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CDP_PORT || 9333);
const APP = process.env.APP_URL || 'http://127.0.0.1:3000/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('CDP 连接失败'));
});

let seq = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
};

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    ws.send(JSON.stringify({ id: seq, method, params }));
    setTimeout(() => pending.has(seq) && reject(new Error(`timeout ${method}`)), 15000);
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await fsp.writeFile(path.join(HERE, name), Buffer.from(data, 'base64'));
  console.log(`  ${name}`);
};

const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 460, height: 880, deviceScaleFactor: 1, mobile: false });

// 从头开始，避免上次的记录干扰
await send('Page.navigate', { url: APP });
await sleep(600);
await evaluate('localStorage.clear()');
await send('Page.reload', { ignoreCache: true });
await sleep(1000);

console.log('标题:', await evaluate('document.title'));
console.log('含「排行榜」:', await evaluate(`document.body.innerHTML.includes('排行榜')`));

await shot('shot-start.png');

await evaluate(`document.getElementById('btn-start').click()`);
await sleep(400);

const rect = await evaluate(`
  (() => { const r = document.getElementById('board').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height }; })()
`);

const xs = [0.22, 0.4, 0.58, 0.76, 0.3, 0.5, 0.7, 0.44, 0.62, 0.36, 0.52, 0.68, 0.28, 0.72];
for (const fx of xs) {
  await click(rect.x + rect.w * fx, rect.y + rect.h * 0.35);
  await sleep(420);
}
await sleep(1300);
console.log('分数:', await evaluate(`document.getElementById('hud-score').textContent`));
await shot('shot-play.png');

// 结束游戏（点两次确认）
await evaluate(`document.getElementById('btn-end').click()`);
await sleep(120);
await evaluate(`document.getElementById('btn-end').click()`);
await sleep(500);
console.log('结算弹窗:', await evaluate(`!document.getElementById('modal-end').hidden`));
console.log('结算文案:', await evaluate(`document.getElementById('end-meta').textContent`));
console.log('提示:', await evaluate(`document.getElementById('end-note').textContent`));
await shot('shot-end.png');

// 打开游戏记录
await evaluate(`document.getElementById('btn-records-end').click()`);
await sleep(400);
console.log('记录条数:', await evaluate(`document.querySelectorAll('#records-list .rec-row').length`));
console.log('记录统计:', await evaluate(`document.getElementById('records-stats').textContent.replace(/\\s+/g, ' ')`));
console.log('存储里的记录:', await evaluate(`(JSON.parse(localStorage.getItem('duotang.records.v1')||'[]')).length`));
await shot('shot-records.png');

console.log(problems.length ? `\n页面报错: ${problems[0]}` : '\n页面没有 JS 报错');

// 「继续游戏」之后再次结算，不应该多出一条记录
await evaluate(`document.querySelector('[data-close="modal-records"]').click()`);
await sleep(200);
await evaluate(`document.getElementById('btn-resume').click()`);
await sleep(300);
for (const fx of [0.4, 0.55]) {
  await click(rect.x + rect.w * fx, rect.y + rect.h * 0.35);
  await sleep(420);
}
await sleep(500);
await evaluate(`document.getElementById('btn-end').click()`);
await sleep(100);
await evaluate(`document.getElementById('btn-end').click()`);
await sleep(400);
const afterResume = await evaluate(`
  (() => {
    const list = JSON.parse(localStorage.getItem('duotang.records.v1') || '[]');
    return { count: list.length, score: list[0] && list[0].score };
  })()
`);
console.log('继续后再结算，记录条数:', afterResume.count, '分数:', afterResume.score);

ws.close();
process.exit(problems.length || afterResume.count !== 1 ? 2 : 0);
