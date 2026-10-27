import assert from 'node:assert/strict';
import {
  World,
  LEVELS,
  DEFAULT_GEOMETRY,
  mergePoints,
  MAX_MERGE_BONUS,
  OVERFLOW_LIMIT,
} from '../public/physics.js';

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** 确定性的伪随机数，保证测试可复现。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(world, seconds) {
  const step = 1 / 60;
  const rounds = Math.ceil(seconds / step);
  for (let i = 0; i < rounds; i += 1) world.step(step);
}

console.log('physics');

test('两个同级水果会合成高一级', () => {
  const w = new World({ rng: () => 0 });
  w.addFruit(0, 210, 600);
  w.addFruit(0, 210, 550);
  run(w, 4);

  assert.equal(w.bodies.length, 1, '应该只剩一个水果');
  assert.equal(w.bodies[0].level, 1, '等级应该升到第 2 级');
  assert.equal(w.bodies[0].r, LEVELS[1].r, '半径应该换成新等级');
  assert.equal(w.score, mergePoints(1), '分数应该是合成到该等级的分数');
});

test('不同等级不会合成', () => {
  const w = new World({ rng: () => 0 });
  w.addFruit(0, 210, 600);
  w.addFruit(1, 210, 540);
  run(w, 3);

  assert.equal(w.bodies.length, 2);
  assert.equal(w.score, 0);
});

test('四个小水果能连锁合成一个大水果', () => {
  const w = new World({ rng: () => 0 });
  for (let i = 0; i < 4; i += 1) w.addFruit(0, 210, 500 + i * 10);
  run(w, 6);

  assert.equal(w.bodies.length, 1, '四个应该合成一个');
  assert.equal(w.bodies[0].level, 2);
  assert.equal(w.score, mergePoints(1) * 2 + mergePoints(2));
  assert.equal(w.mergeCount, 3, '一次 4 合 1 应该发生 3 次合成');
});

test('两个「麦」相撞会一起消失并给奖励', () => {
  const w = new World({ rng: () => 0 });
  const last = LEVELS.length - 1;
  w.addFruit(last, 210, 600);
  w.addFruit(last, 210, 380);
  run(w, 8);

  assert.equal(w.bodies.length, 0, '最高的两个应该一起消失');
  assert.equal(w.score, MAX_MERGE_BONUS);
});

test('堆到危险线以上会判负', () => {
  const w = new World({
    rng: () => 0,
    geometry: { width: 300, height: 220, left: 10, right: 290, floor: 120, dangerY: 100 },
  });
  w.addFruit(0, 150, 100);
  run(w, OVERFLOW_LIMIT + 3);

  assert.equal(w.gameOver, true, '停留超过时限应该结束');
  assert.ok(w.overflowRatio >= 0.99);
});

test('还没越线时不会误判失败', () => {
  const w = new World({ rng: () => 0 });
  w.addFruit(0, 210, 600);
  run(w, 6);

  assert.equal(w.gameOver, false);
  assert.equal(w.overflowTime, 0);
});

test('随机投放 120 次：不出 NaN、不飞出容器', () => {
  const w = new World({ rng: mulberry32(20240101) });
  for (let i = 0; i < 120; i += 1) {
    if (w.gameOver) break;
    w.addFruit(w.pickDropLevel(), 20 + w.rng() * 380, 80);
    for (let k = 0; k < 8; k += 1) w.step(1 / 60);
  }

  assert.ok(w.bodies.length > 0, '应该还有一些水果');
  const g = w.geometry;
  for (const b of w.bodies) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), '坐标不能是 NaN');
    assert.ok(Number.isFinite(b.vx) && Number.isFinite(b.vy), '速度不能是 NaN');
    assert.ok(b.x >= g.left - 1 && b.x <= g.right + 1, `x 越界: ${b.x}`);
    assert.ok(b.y <= g.floor + 1, `y 越界: ${b.y}`);
    assert.ok(b.r === LEVELS[b.level].r, '半径必须和等级匹配');
  }
});

test('水果最终会停在地面上（不会无限下坠）', () => {
  const w = new World({ rng: () => 0 });
  w.addFruit(3, 210, 200);
  run(w, 3);

  const body = w.bodies[0];
  assert.ok(Math.abs(body.y + body.r - DEFAULT_GEOMETRY.floor) < 1.5, `应该贴着地面: ${body.y}`);
  assert.ok(Math.abs(body.vy) < 20, `应该静止下来: ${body.vy}`);
});

test('掉落等级只取前面的小水果', () => {
  const w = new World({ rng: mulberry32(5) });
  for (let i = 0; i < 500; i += 1) {
    const level = w.pickDropLevel();
    assert.ok(level >= 0 && level < w.dropWeights.length, `不该掉出范围: ${level}`);
  }
});

test('几何参数可以被覆盖', () => {
  const w = new World({ geometry: { floor: 300 } });
  assert.equal(w.geometry.floor, 300);
  assert.equal(w.geometry.left, DEFAULT_GEOMETRY.left);
});

console.log(failed === 0 ? '\nphysics: 全部通过' : `\nphysics: ${failed} 个失败`);
if (failed > 0) process.exitCode = 1;
