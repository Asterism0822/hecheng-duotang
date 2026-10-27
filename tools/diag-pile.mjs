/** 诊断：稳定后的堆叠里，水果之间还残留多少重叠。 */
import { World, LEVELS } from '../public/physics.js';

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

const w = new World({ rng: mulberry32(9) });
for (let i = 0; i < 40; i += 1) {
  w.addFruit(w.pickDropLevel(), 40 + w.rng() * 340, 80);
  for (let k = 0; k < 30; k += 1) w.step(1 / 60);
}
for (let k = 0; k < 180; k += 1) w.step(1 / 60);

let worst = 0;
let worstPair = '';
for (let i = 0; i < w.bodies.length; i += 1) {
  for (let j = i + 1; j < w.bodies.length; j += 1) {
    const a = w.bodies[i];
    const b = w.bodies[j];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const pen = a.r + b.r - d;
    if (pen > worst) {
      worst = pen;
      worstPair = `${LEVELS[a.level].name}(${a.level}) / ${LEVELS[b.level].name}(${b.level})`;
    }
  }
}

console.log(`水果数量: ${w.bodies.length}`);
console.log(`最大重叠: ${worst.toFixed(2)} px  (${worstPair})`);
console.log(`分数: ${w.score}  合成次数: ${w.mergeCount}  gameOver=${w.gameOver}`);
