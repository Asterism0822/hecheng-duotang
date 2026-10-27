/**
 * 平衡性扫参：模拟「还算不错」的玩家（轮流往几列丢、每 0.4 秒一个），
 * 看不同容器尺寸下大概第几个水果会死。用来调参，不参与线上运行。
 */
import { World, DEFAULT_GEOMETRY } from '../public/physics.js';

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

function play(geometry, seed, maxDrops = 400) {
  const w = new World({ geometry, rng: mulberry32(seed) });
  const lanes = 9;
  const g = w.geometry;
  const inner = g.right - g.left;
  let drops = 0;
  for (let i = 0; i < maxDrops; i += 1) {
    if (w.gameOver) break;
    const lane = i % lanes;
    const x = g.left + inner * (0.08 + (0.84 * lane) / (lanes - 1));
    w.addFruit(w.pickDropLevel(), x, g.dangerY - 40);
    drops += 1;
    for (let k = 0; k < 24; k += 1) w.step(1 / 60); // 0.4 秒
  }
  return { drops: w.gameOver ? drops : null, score: w.score, bodies: w.bodies.length };
}

const geometries = {
  '默认 300x380': { ...DEFAULT_GEOMETRY },
  '340x450': { ...DEFAULT_GEOMETRY, left: 40, right: 380, dangerY: 220 },
  '320x430': { ...DEFAULT_GEOMETRY, left: 50, right: 370, dangerY: 240 },
  '300x400': { ...DEFAULT_GEOMETRY, left: 60, right: 360, dangerY: 270 },
  '300x380': { ...DEFAULT_GEOMETRY, left: 60, right: 360, dangerY: 290 },
  '280x380': { ...DEFAULT_GEOMETRY, left: 70, right: 350, dangerY: 290 },
};

for (const [name, geo] of Object.entries(geometries)) {
  const runs = [11, 22, 33, 44, 55].map((seed) => play(geo, seed));
  const dropsList = runs.map((r) => (r.drops === null ? '>400' : r.drops));
  const avgScore = Math.round(runs.reduce((a, r) => a + r.score, 0) / runs.length);
  const avgDrops = Math.round(
    runs.reduce((a, r) => a + (r.drops === null ? 400 : r.drops), 0) / runs.length,
  );
  console.log(`${name.padEnd(14)} 第 ${dropsList.join(' / ')} 个   平均 ${avgDrops} 个   平均分 ${avgScore}`);
}
