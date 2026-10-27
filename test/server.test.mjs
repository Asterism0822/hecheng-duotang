import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log('server');

await test('首页能打开，标题和记录入口都在', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('合成多糖'), '标题应该是「合成多糖」');
  assert.ok(html.includes('游戏记录'), '首页应该有游戏记录入口');
  assert.ok(!html.includes('排行榜'), '不应该再出现排行榜');
});

await test('静态资源类型正确', async () => {
  const js = await fetch(`${base}/game.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') || '', /javascript/);

  const css = await fetch(`${base}/style.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /css/);

  const mod = await fetch(`${base}/physics.js`);
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type') || '', /javascript/);
});

await test('目录穿越被挡住', async () => {
  const res = await fetch(`${base}/../server.mjs`);
  assert.ok([403, 404].includes(res.status), `实际 ${res.status}`);
  const body = await res.text();
  assert.ok(!body.includes('createServer'), '不能把源码吐出来');
});

await test('不存在的文件返回 404', async () => {
  const res = await fetch(`${base}/nope.txt`);
  assert.equal(res.status, 404);
});

await test('原来的排行榜接口已经下线', async () => {
  const res = await fetch(`${base}/api/leaderboard`);
  assert.equal(res.status, 404);
  const post = await fetch(`${base}/api/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: 'x', score: 1 }),
  });
  assert.equal(post.status, 405);
});

await test('非 GET 请求返回 405', async () => {
  const res = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(res.status, 405);
});

await test('HEAD 只回头不回体', async () => {
  const res = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, '');
});

await new Promise((resolve) => server.close(resolve));

console.log(failed === 0 ? '\nserver: 全部通过' : `\nserver: ${failed} 个失败`);
if (failed > 0) process.exitCode = 1;
