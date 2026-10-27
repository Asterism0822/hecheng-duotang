/**
 * 合成多糖 —— 核心物理与合成逻辑
 *
 * 这个模块刻意不依赖任何 DOM / Canvas API，只做纯计算，
 * 因此可以直接在 Node 里跑测试（见 test/physics.test.mjs）。
 *
 * 每个水果都是一个圆：位置、速度、半径、等级。
 * 求解方式是「位置修正 + 冲量」的迭代式分离，配合低弹性与摩擦，
 * 足以做出接近《合成大西瓜》的堆叠手感。
 */

/** 从小到大共 9 级。r 是半径（逻辑像素），color 用于占位圆。 */
export const LEVELS = [
  { name: '可鸭', r: 16, color: '#FFE066', ink: '#4a3600' },
  { name: '土豆', r: 22, color: '#FFC24B', ink: '#4a3200' },
  { name: '照明', r: 29, color: '#FF9F43', ink: '#4a2500' },
  { name: '主播', r: 37, color: '#FF8787', ink: '#4a1010' },
  { name: '小猫', r: 46, color: '#FF6B9A', ink: '#4a0c25' },
  { name: '糖琨', r: 56, color: '#C08CFF', ink: '#2c1550' },
  { name: '糖入', r: 67, color: '#8B8CFF', ink: '#ffffff' },
  { name: '草木', r: 79, color: '#4DD6A8', ink: '#04382c' },
  { name: '麦', r: 92, color: '#3E8BFF', ink: '#ffffff' },
];

/** 画布与容器尺寸（逻辑像素）。 */
export const DEFAULT_GEOMETRY = {
  width: 360,
  height: 560,
  left: 30,
  right: 330,
  floor: 550,
  dangerY: 170,
};

export const GRAVITY = 2000;
const SUBSTEP = 1 / 120;
const SOLVER_ITERATIONS = 4;
const RESTITUTION = 0.06;
const FRICTION = 0.22;
const MAX_SPEED = 2600;
const WALL_RESTITUTION = 0.12;
/** 两颗水果「贴上」的容差，避免浮点误差导致永远碰不到。 */
const MERGE_TOLERANCE = 0.8;

/** 越过红线并停留多久算死（秒）。 */
export const OVERFLOW_LIMIT = 2.2;
/** 刚出生 / 刚合成的水果有这么久不计入死亡判定。 */
const OVERFLOW_GRACE = 0.85;
/** 速度过大时正在穿过危险线，不算「堆到顶」。 */
const OVERFLOW_MAX_SPEED = 320;

/** 合成到第 level 级（0 基）得多少分。 */
export function mergePoints(level) {
  return ((level + 1) * (level + 2)) / 2;
}

/** 两颗「麦」相撞时的额外奖励（它们会一起消失）。 */
export const MAX_MERGE_BONUS = 120;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class World {
  /**
   * @param {object} [options]
   * @param {object} [options.geometry] 覆盖默认容器尺寸（测试时很有用）
   * @param {() => number} [options.rng] 随机源，默认 Math.random
   */
  constructor(options = {}) {
    this.geometry = { ...DEFAULT_GEOMETRY, ...(options.geometry || {}) };
    this.rng = options.rng || Math.random;
    this.bodies = [];
    this.nextId = 1;
    this.score = 0;
    this.mergeCount = 0;
    this.gameOver = false;
    this.overflowTime = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.events = [];
    /** 可掉落的等级与权重（只掉小的，大的靠合成）。 */
    this.dropWeights = options.dropWeights || [0.4, 0.3, 0.2, 0.1];
    this.maxBodies = options.maxBodies || 120;
  }

  /** 距离死亡还有多远，0 ~ 1。给 UI 做警示用。 */
  get overflowRatio() {
    return Math.min(1, this.overflowTime / OVERFLOW_LIMIT);
  }

  /** 随机挑一个可以掉落的水果等级。 */
  pickDropLevel() {
    const total = this.dropWeights.reduce((a, b) => a + b, 0);
    let roll = this.rng() * total;
    for (let i = 0; i < this.dropWeights.length; i += 1) {
      roll -= this.dropWeights[i];
      if (roll <= 0) return i;
    }
    return 0;
  }

  /**
   * 放入一个水果。
   * @param {number} level 等级下标
   * @param {number} x 横坐标（会被夹在容器内）
   * @param {number} [y] 纵坐标，默认从顶部下落
   * @param {number} [vx]
   * @param {number} [vy]
   */
  addFruit(level, x, y, vx = 0, vy = 0) {
    const L = LEVELS[level];
    if (!L) throw new Error(`未知等级: ${level}`);
    const g = this.geometry;
    const body = {
      id: this.nextId++,
      level,
      x: clamp(x, g.left + L.r + 0.5, g.right - L.r - 0.5),
      y: y === undefined ? g.dangerY - L.r - 20 : y,
      vx,
      vy,
      r: L.r,
      age: 0,
    };
    this.bodies.push(body);
    return body;
  }

  /** 推进 dt 秒（内部会拆成固定的 1/120 秒子步，保证稳定）。 */
  step(dt) {
    if (this.gameOver) return;
    const clamped = Math.min(Math.max(dt, 0), 0.05);
    this.accumulator += clamped;
    let guard = 0;
    while (this.accumulator >= SUBSTEP && guard < 12) {
      this.substep(SUBSTEP);
      this.accumulator -= SUBSTEP;
      guard += 1;
      if (this.gameOver) break;
    }
    if (guard >= 12) this.accumulator = 0;
  }

  /** 取出并清空待处理事件（合成特效、游戏结束等）。 */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  substep(h) {
    this.elapsed += h;

    for (const b of this.bodies) {
      b.vy += GRAVITY * h;
      const damp = 1 - 0.35 * h;
      b.vx *= damp;
      b.vy *= damp;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > MAX_SPEED) {
        b.vx = (b.vx / speed) * MAX_SPEED;
        b.vy = (b.vy / speed) * MAX_SPEED;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.age += h;
    }

    for (let i = 0; i < SOLVER_ITERATIONS; i += 1) {
      this.solveWalls();
      this.solvePairs();
    }

    this.resolveMerges();
    this.updateOverflow(h);
    this.prune();

    if (this.bodies.length > this.maxBodies) {
      this.bodies.sort((a, b) => a.age - b.age);
      this.bodies.length = this.maxBodies;
    }
  }

  solveWalls() {
    const g = this.geometry;
    for (const b of this.bodies) {
      if (b.x - b.r < g.left) {
        b.x = g.left + b.r;
        if (b.vx < 0) b.vx = -b.vx * WALL_RESTITUTION;
        b.vy *= 0.98;
      } else if (b.x + b.r > g.right) {
        b.x = g.right - b.r;
        if (b.vx > 0) b.vx = -b.vx * WALL_RESTITUTION;
        b.vy *= 0.98;
      }
      if (b.y + b.r > g.floor) {
        b.y = g.floor - b.r;
        if (b.vy > 0) b.vy = -b.vy * WALL_RESTITUTION;
        b.vx *= 0.9;
      }
    }
  }

  solvePairs() {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const sum = a.r + b.r;
        const distSq = dx * dx + dy * dy;
        if (distSq >= sum * sum || distSq === 0) continue;
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const penetration = sum - dist;

        const ia = 1 / (a.r * a.r);
        const ib = 1 / (b.r * b.r);
        const invSum = ia + ib;

        const shareA = ia / invSum;
        const shareB = ib / invSum;
        a.x -= nx * penetration * shareA;
        a.y -= ny * penetration * shareA;
        b.x += nx * penetration * shareB;
        b.y += ny * penetration * shareB;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const impulse = (-(1 + RESTITUTION) * vn) / invSum;
          a.vx -= nx * impulse * ia;
          a.vy -= ny * impulse * ia;
          b.vx += nx * impulse * ib;
          b.vy += ny * impulse * ib;

          const tx = -ny;
          const ty = nx;
          const vt = rvx * tx + rvy * ty;
          const jt = (-vt * FRICTION) / invSum;
          a.vx -= tx * jt * ia;
          a.vy -= ty * jt * ia;
          b.vx += tx * jt * ib;
          b.vy += ty * jt * ib;
        }
      }
    }
  }

  resolveMerges() {
    const bodies = this.bodies;
    if (bodies.length < 2) return;

    const consumed = new Set();
    const pairs = [];
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i];
      if (consumed.has(a.id)) continue;
      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j];
        if (consumed.has(b.id) || b.level !== a.level) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.r + b.r + MERGE_TOLERANCE;
        if (dx * dx + dy * dy > reach * reach) continue;
        consumed.add(a.id);
        consumed.add(b.id);
        pairs.push([a, b]);
        break;
      }
    }
    if (pairs.length === 0) return;

    const kept = bodies.filter((b) => !consumed.has(b.id));
    for (const [a, b] of pairs) {
      const merged = this.buildMerge(a, b);
      if (merged) kept.push(merged);
    }
    this.bodies = kept;
  }

  buildMerge(a, b) {
    const ma = a.r * a.r;
    const mb = b.r * b.r;
    const mt = ma + mb;
    const x = (a.x * ma + b.x * mb) / mt;
    const y = (a.y * ma + b.y * mb) / mt;
    const vx = (a.vx * ma + b.vx * mb) / mt;
    const vy = (a.vy * ma + b.vy * mb) / mt;
    const level = a.level + 1;

    if (level >= LEVELS.length) {
      // 两个「麦」撞在一起 —— 一起消失，给一笔奖励
      this.score += MAX_MERGE_BONUS;
      this.mergeCount += 1;
      this.events.push({
        type: 'pop',
        x,
        y,
        level: a.level,
        points: MAX_MERGE_BONUS,
      });
      return null;
    }

    const points = mergePoints(level);
    this.score += points;
    this.mergeCount += 1;
    this.events.push({ type: 'merge', x, y, level, points });

    const g = this.geometry;
    const L = LEVELS[level];
    return {
      id: this.nextId++,
      level,
      x: clamp(x, g.left + L.r, g.right - L.r),
      y,
      vx: vx * 0.5,
      // 轻微上顶，合成时更有「弹」的手感
      vy: vy * 0.5 - 55,
      r: L.r,
      age: 0,
    };
  }

  updateOverflow(h) {
    const g = this.geometry;
    let pressing = false;
    for (const b of this.bodies) {
      if (b.age < OVERFLOW_GRACE) continue;
      if (b.y - b.r > g.dangerY) continue;
      if (Math.abs(b.vy) > OVERFLOW_MAX_SPEED) continue;
      pressing = true;
      break;
    }
    this.overflowTime = pressing
      ? this.overflowTime + h
      : Math.max(0, this.overflowTime - h * 1.8);

    if (this.overflowTime >= OVERFLOW_LIMIT && !this.gameOver) {
      this.gameOver = true;
      this.events.push({ type: 'gameover', score: this.score });
    }
  }

  /** 把飞出容器的漏网之鱼清掉（正常不会发生，纯保险）。 */
  prune() {
    const g = this.geometry;
    const kept = [];
    for (const b of this.bodies) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      if (b.x < g.left - 200 || b.x > g.right + 200) continue;
      if (b.y > g.floor + 200 || b.y < -500) continue;
      kept.push(b);
    }
    if (kept.length !== this.bodies.length) this.bodies = kept;
  }
}
