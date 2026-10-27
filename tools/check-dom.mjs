/**
 * 一个很小的静态检查：确认 game.js 里引用的元素 id 都真的存在于 index.html，
 * data-close 指向的弹窗都存在，以及改名 / 去排行榜改干净了。
 * 浏览器跑不起来时用它兜底。
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = await fsp.readFile(path.join(root, 'public/index.html'), 'utf8');
const js = await fsp.readFile(path.join(root, 'public/game.js'), 'utf8');
const css = await fsp.readFile(path.join(root, 'public/style.css'), 'utf8');
const physics = await fsp.readFile(path.join(root, 'public/physics.js'), 'utf8');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
assert.deepEqual(duplicates, [], `HTML 里有重复 id: ${duplicates.join(', ')}`);

const referenced = new Set();
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) referenced.add(m[1]);
for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) referenced.add(m[1]);

const missing = [...referenced].filter((id) => !ids.includes(id));
assert.deepEqual(missing, [], `game.js 引用了不存在的元素: ${missing.join(', ')}`);

const closeTargets = [...html.matchAll(/data-close="([^"]+)"/g)].map((m) => m[1]);
const badClose = closeTargets.filter((id) => !ids.includes(id));
assert.deepEqual(badClose, [], `data-close 指向了不存在的元素: ${badClose.join(', ')}`);

const modals = [...html.matchAll(/class="modal[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
assert.equal(modals.length, 3, `应该有 3 个弹窗，实际 ${modals.length}`);

// 合成链的文字必须和需求一致、顺序一致
const chain = ['可鸭', '土豆', '照明', '主播', '小猫', '糖琨', '糖入', '草木', '麦'];
const names = [...physics.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
assert.deepEqual(names, chain, `合成链不对: ${names.join(' / ')}`);

// 游戏记录：三个入口都要在
for (const id of ['btn-records-start', 'btn-records', 'btn-records-end']) {
  assert.ok(ids.includes(id), `缺少游戏记录入口 ${id}`);
}
assert.ok(ids.includes('records-list'), '缺少记录列表容器');
assert.ok(ids.includes('records-stats'), '缺少记录统计区');
assert.ok(ids.includes('btn-end'), '缺少结束游戏按钮');
assert.ok(ids.includes('skin-file'), '缺少自定义贴图上传入口');
assert.ok(ids.includes('modal-settings'), '缺少设置弹窗');

// 改名要彻底：页面、脚本、样式里都不该再出现「大麦」或「排行榜」
const banned = [
  ['大麦', `${html}${js}${css}${physics}`],
  ['排行榜', `${html}${js}`],
  ['nickname', html + js],
  ['api/scores', js],
];
for (const [word, haystack] of banned) {
  assert.ok(!haystack.includes(word), `不应该再出现「${word}」`);
}

assert.ok(html.includes('<title>合成多糖</title>'), '页面标题应该是「合成多糖」');
assert.ok(html.includes('游戏记录'), '应该有游戏记录');

const unused = ids.filter((id) => !referenced.has(id) && !closeTargets.includes(id) && !/^modal-/.test(id));
console.log('未被 JS 直接引用的 id（可能是纯样式/A11y 用）:', unused.join(', ') || '无');

console.log(`OK · ${ids.length} 个 id，${referenced.size} 处引用，${modals.length} 个弹窗，合成链 ${names.length} 级`);
