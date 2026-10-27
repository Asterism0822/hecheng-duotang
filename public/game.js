/**
 * 合成多糖 —— 页面逻辑
 * 负责渲染、输入、计分流程、自定义贴图、本机游戏记录。
 * 物理与合成规则在 physics.js 里，保持可测试。
 */

import { World, LEVELS, DEFAULT_GEOMETRY } from './physics.js';

const { width: W, height: H, left: LEFT, right: RIGHT, floor: FLOOR, dangerY: DANGER_Y } = DEFAULT_GEOMETRY;

const TAU = Math.PI * 2;
const HELD_Y = 78;
const DROP_COOLDOWN = 0.38;
const FONT_STACK = '"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
const MAX_RECORDS = 50;

const LS = {
  best: 'duotang.best.v1',
  skins: 'duotang.skins.v1',
  muted: 'duotang.muted.v1',
  records: 'duotang.records.v1',
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(
    A[2] + (B[2] - A[2]) * t,
  )})`;
}

/** 每级预先算好明暗色，避免每帧解析十六进制。 */
const PALETTE = LEVELS.map((L) => ({
  light: mix(L.color, '#ffffff', 0.45),
  dark: mix(L.color, '#000000', 0.24),
}));

const sortedKeys = (obj) => Object.keys(obj).sort((a, b) => Number(a) - Number(b));

function readNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function formatStamp(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* 状态                                                               */
/* ------------------------------------------------------------------ */

const state = {
  phase: 'start', // start | playing | ending | ended
  world: new World(),
  held: null,
  nextLevel: 0,
  aimX: W / 2,
  dropCooldown: 0,
  overDelay: 0,
  lastScore: 0,
  best: 0,
  maxLevel: 0,
  playTime: 0,
  runId: '',
  skins: {},
  muted: false,
  sparks: [],
  popups: [],
  shake: 0,
  dpr: 1,
  lastTime: 0,
  endArmedAt: 0,
};

let canvas;
let ctx;

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */

init();

function init() {
  canvas = $('board');
  ctx = canvas.getContext('2d', { alpha: true });

  state.best = readNumber(LS.best, 0);
  state.muted = localStorage.getItem(LS.muted) === '1';

  loadSkins();
  buildChainPreview();
  bindUi();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));

  $('hud-best').textContent = String(state.best);
  resetWorld();
  requestAnimationFrame(loop);
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  state.dpr = dpr;
  const w = Math.round(W * dpr);
  const h = Math.round(H * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

function loop(now) {
  if (!state.lastTime) state.lastTime = now;
  let dt = (now - state.lastTime) / 1000;
  state.lastTime = now;
  if (!Number.isFinite(dt)) dt = 0;
  dt = clamp(dt, 0, 0.05);

  update(dt);
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  updateEffects(dt);

  if (state.phase === 'playing' && !isModalOpen()) {
    state.playTime += dt;
    state.world.step(dt);
    handleEvents(state.world.drainEvents());

    if (state.dropCooldown > 0) state.dropCooldown = Math.max(0, state.dropCooldown - dt);
    if (!state.held && state.dropCooldown === 0) spawnHeld();

    if (state.world.gameOver) {
      state.phase = 'ending';
      state.overDelay = 0.7;
    }
  } else if (state.phase === 'ending' && !isModalOpen()) {
    state.overDelay -= dt;
    if (state.overDelay <= 0) endGame('over');
  }

  updateHud();
}

function updateHud() {
  const score = Math.floor(state.world.score);
  const el = $('hud-score');
  if (el.textContent !== String(score)) el.textContent = String(score);
  const bestEl = $('hud-best');
  if (bestEl.textContent !== String(state.best)) bestEl.textContent = String(state.best);
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */

function render() {
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  if (state.shake > 0.02) {
    const s = state.shake * 4.5;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  drawBoard();
  drawDangerLine();

  for (const b of state.world.bodies) drawFruit(b.x, b.y, b.r, b.level);
  drawHeldFruit();
  drawEffects();

  ctx.restore();
}

function roundRectPath(x, y, w, h, radii) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radii);
    return;
  }
  const [tl, tr, br, bl] = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
}

function drawBoard() {
  const w = RIGHT - LEFT;

  const bg = ctx.createLinearGradient(0, 0, 0, FLOOR);
  bg.addColorStop(0, 'rgba(255, 255, 255, 0.99)');
  bg.addColorStop(0.55, 'rgba(250, 252, 255, 0.99)');
  bg.addColorStop(1, 'rgba(243, 247, 255, 1)');

  roundRectPath(LEFT, 0, w, FLOOR, [0, 0, 22, 22]);
  ctx.fillStyle = bg;
  ctx.fill();

  // 底部暖光，给堆叠区一点层次
  const glow = ctx.createRadialGradient(W / 2, FLOOR, 20, W / 2, FLOOR, 300);
  glow.addColorStop(0, 'rgba(255, 184, 92, 0.12)');
  glow.addColorStop(1, 'rgba(255, 184, 92, 0)');
  ctx.fillStyle = glow;
  ctx.fill();

  // 顶部一点点内阴影，让容器更像一个「盒子」
  const top = ctx.createLinearGradient(0, 0, 0, 90);
  top.addColorStop(0, 'rgba(120, 142, 205, 0.10)');
  top.addColorStop(1, 'rgba(120, 142, 205, 0)');
  ctx.save();
  roundRectPath(LEFT, 0, w, FLOOR, [0, 0, 22, 22]);
  ctx.clip();
  ctx.fillStyle = top;
  ctx.fillRect(LEFT, 0, w, 90);
  ctx.restore();

  // 容器轮廓
  roundRectPath(LEFT, 0, w, FLOOR, [0, 0, 22, 22]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(116, 140, 205, 0.42)';
  ctx.stroke();

  // 侧壁高光
  ctx.beginPath();
  ctx.moveTo(LEFT + 2.5, 24);
  ctx.lineTo(LEFT + 2.5, FLOOR - 26);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.stroke();
}

function drawDangerLine() {
  const ratio = state.world ? state.world.overflowRatio : 0;
  const y = DANGER_Y;

  if (ratio > 0.001) {
    const grad = ctx.createLinearGradient(0, 0, 0, y + 70);
    grad.addColorStop(0, `rgba(242, 97, 126, ${0.14 * ratio})`);
    grad.addColorStop(1, 'rgba(242, 97, 126, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(LEFT, 0, RIGHT - LEFT, y + 70);
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(LEFT + 8, y);
  ctx.lineTo(RIGHT - 8, y);
  ctx.setLineDash([9, 8]);
  ctx.lineWidth = 1.6 + ratio * 1.6;
  ctx.strokeStyle = `rgba(242, 97, 126, ${0.45 + ratio * 0.5})`;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = `600 10px ${FONT_STACK}`;
  ctx.fillStyle = `rgba(230, 96, 126, ${0.55 + ratio * 0.4})`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('危险线', RIGHT - 12, y - 5);
  ctx.restore();
}

function skinFor(level) {
  const skin = state.skins[level];
  if (!skin) return null;
  const img = skin.img;
  if (!img || !img.complete || img.naturalWidth === 0) return null;
  return img;
}

function drawFruit(x, y, r, level, opts = {}) {
  const L = LEVELS[level];
  const pal = PALETTE[level];
  const alpha = opts.alpha === undefined ? 1 : opts.alpha;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (!opts.ghost) {
    ctx.beginPath();
    ctx.ellipse(x + r * 0.05, y + r * 0.95, r * 0.84, r * 0.22, 0, 0, TAU);
    ctx.fillStyle = 'rgba(70, 90, 150, 0.16)';
    ctx.fill();
  }

  const img = skinFor(level);

  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, TAU);
    ctx.clip();
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, r - 1.5, 0, TAU);
    ctx.lineWidth = Math.max(2, r * 0.055);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, r - 1.5, 0, TAU);
    ctx.lineWidth = Math.max(1, r * 0.02);
    ctx.strokeStyle = 'rgba(30, 40, 80, 0.16)';
    ctx.stroke();
  } else {
    const grad = ctx.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.1, x, y, r * 1.06);
    grad.addColorStop(0, pal.light);
    grad.addColorStop(0.62, L.color);
    grad.addColorStop(1, pal.dark);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(x - r * 0.32, y - r * 0.44, r * 0.32, r * 0.2, -0.6, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r - Math.max(1.4, r * 0.045), 0, TAU);
    ctx.strokeStyle = 'rgba(30, 40, 80, 0.12)';
    ctx.lineWidth = Math.max(1.4, r * 0.05);
    ctx.stroke();

    ctx.fillStyle = L.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = r * 0.78;
    const maxWidth = r * 1.62;
    ctx.font = `800 ${size}px ${FONT_STACK}`;
    const width = ctx.measureText(L.name).width;
    if (width > maxWidth) {
      size *= maxWidth / width;
      ctx.font = `800 ${size}px ${FONT_STACK}`;
    }
    ctx.fillText(L.name, x, y + size * 0.05);
  }

  if (opts.ghost) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(70, 90, 150, 0.4)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawHeldFruit() {
  if (!state.held || state.phase !== 'playing') return;
  const L = LEVELS[state.held.level];
  const x = clamp(state.aimX, LEFT + L.r, RIGHT - L.r);
  const y = HELD_Y;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + L.r + 2);
  ctx.lineTo(x, FLOOR - 8);
  ctx.setLineDash([4, 9]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(70, 90, 150, 0.22)';
  ctx.stroke();
  ctx.restore();

  drawFruit(x, y, L.r, state.held.level, { alpha: 0.92, ghost: true });
}

/* ------------------------------------------------------------------ */
/* 特效                                                               */
/* ------------------------------------------------------------------ */

function spawnSparks(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * TAU;
    const speed = 60 + Math.random() * 190;
    state.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      r: 1.6 + Math.random() * 3,
      life: 0,
      max: 0.45 + Math.random() * 0.35,
      color,
    });
  }
}

function spawnPopup(text, x, y, color) {
  state.popups.push({ text, x, y, life: 0, max: 0.9, color });
}

function updateEffects(dt) {
  for (let i = state.sparks.length - 1; i >= 0; i -= 1) {
    const p = state.sparks[i];
    p.life += dt;
    if (p.life >= p.max) {
      state.sparks.splice(i, 1);
      continue;
    }
    p.vy += 900 * dt;
    p.vx *= 1 - 2.2 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  for (let i = state.popups.length - 1; i >= 0; i -= 1) {
    const p = state.popups[i];
    p.life += dt;
    if (p.life >= p.max) {
      state.popups.splice(i, 1);
      continue;
    }
    p.y -= 46 * dt;
  }

  state.shake = Math.max(0, state.shake - dt * 2.6);
}

function drawEffects() {
  for (const p of state.sparks) {
    const k = 1 - p.life / p.max;
    ctx.globalAlpha = Math.max(0, k);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * k, 0, TAU);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const p of state.popups) {
    const k = 1 - p.life / p.max;
    ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.4));
    ctx.font = `800 16px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* 游戏流程                                                            */
/* ------------------------------------------------------------------ */

function resetWorld() {
  state.world = new World();
  state.held = null;
  state.nextLevel = state.world.pickDropLevel();
  state.aimX = W / 2;
  state.dropCooldown = 0.12;
  state.overDelay = 0;
  state.maxLevel = 0;
  state.playTime = 0;
  state.runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  state.sparks.length = 0;
  state.popups.length = 0;
  state.shake = 0;
  updateNextChip();
  updateHud();
}

function startGame() {
  closeAllModals();
  resetWorld();
  state.phase = 'playing';
  state.lastTime = 0;
  $('overlay-start').hidden = true;
  $('btn-end').textContent = '结束游戏';
  state.endArmedAt = 0;
}

function spawnHeld() {
  const level = state.nextLevel;
  state.nextLevel = state.world.pickDropLevel();
  state.held = { level };
  state.maxLevel = Math.max(state.maxLevel, level);
  const L = LEVELS[level];
  state.aimX = clamp(state.aimX, LEFT + L.r + 1, RIGHT - L.r - 1);
  updateNextChip();
}

function updateNextChip() {
  const L = LEVELS[state.nextLevel];
  const swatch = $('next-swatch');
  const skin = state.skins[state.nextLevel];
  if (skin && skin.img) {
    swatch.style.backgroundImage = `url("${skin.src}")`;
    swatch.style.backgroundSize = 'cover';
    swatch.style.backgroundPosition = 'center';
    swatch.style.backgroundColor = 'transparent';
  } else {
    swatch.style.backgroundImage = 'none';
    swatch.style.backgroundColor = L.color;
  }
  $('next-name').textContent = L.name;
}

function moveAim(dx) {
  const r = state.held ? LEVELS[state.held.level].r : 16;
  state.aimX = clamp(state.aimX + dx, LEFT + r + 1, RIGHT - r - 1);
}

function dropHeld() {
  if (state.phase !== 'playing' || !state.held) return;
  const L = LEVELS[state.held.level];
  const x = clamp(state.aimX, LEFT + L.r, RIGHT - L.r);
  state.world.addFruit(state.held.level, x, HELD_Y);
  state.maxLevel = Math.max(state.maxLevel, state.held.level);
  state.held = null;
  state.dropCooldown = DROP_COOLDOWN;
  playTone(140, 0.06, 0.05, 'sine');
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === 'merge' || ev.type === 'pop') {
      const level = Math.min(ev.level + (ev.type === 'merge' ? 1 : 0), LEVELS.length - 1);
      state.maxLevel = Math.max(state.maxLevel, level);
      const color = LEVELS[level].color;
      spawnSparks(ev.x, ev.y, color, 6 + level * 2);
      spawnPopup(`+${ev.points}`, ev.x, ev.y - 8, level >= 5 ? '#e08a00' : '#3b4468');
      state.shake = Math.min(1.4, state.shake + 0.18 + level * 0.06);
      playTone(300 * Math.pow(1.09, level), 0.16, 0.12, 'triangle');
    } else if (ev.type === 'gameover') {
      playTone(180, 0.5, 0.16, 'sawtooth');
    }
  }
}

function endGame(reason) {
  if (state.phase === 'ended') return;
  state.phase = 'ended';
  state.held = null;

  const score = Math.floor(state.world.score);
  const prevBest = state.best;
  state.lastScore = score;

  if (score > state.best) {
    state.best = score;
    try {
      localStorage.setItem(LS.best, String(score));
    } catch {
      /* 隐私模式下写不进去就算了 */
    }
  }
  updateHud();

  const isNewBest = score > prevBest && score > 0;
  recordRun(score);

  $('end-title').textContent = reason === 'over' ? '游戏结束' : '本局结束';
  $('end-score').textContent = String(score);
  $('end-best').textContent = `历史最高 ${state.best}`;
  $('end-meta').textContent = `最大 ${LEVELS[state.maxLevel].name} · 用时 ${formatDuration(state.playTime)}`;
  $('btn-resume').hidden = reason === 'over';

  const note = $('end-note');
  note.className = 'note ok';
  note.textContent = isNewBest ? '新纪录！已记入游戏记录' : '已记入游戏记录';

  hideToast();
  openModal('modal-end');
}

function resumeGame() {
  if (state.world.gameOver) return;
  state.phase = 'playing';
  closeModal('modal-end');
  state.lastTime = 0;
}

/** 结算页关掉之后回到开始页，避免卡在没有入口的状态。 */
function goToStartScreen() {
  state.phase = 'start';
  closeAllModals();
  resetWorld();
  $('overlay-start').hidden = false;
  $('btn-end').textContent = '结束游戏';
  state.endArmedAt = 0;
}

/* ------------------------------------------------------------------ */
/* HUD / 按钮                                                          */
/* ------------------------------------------------------------------ */

function bindUi() {
  $('btn-start').addEventListener('click', startGame);

  $('btn-end').addEventListener('click', () => {
    if (state.phase === 'start') {
      showToast('先点「开始游戏」吧');
      return;
    }
    if (state.phase !== 'playing') return;

    if (Date.now() < state.endArmedAt) {
      state.endArmedAt = 0;
      $('btn-end').textContent = '结束游戏';
      endGame('manual');
      return;
    }
    state.endArmedAt = Date.now() + 2800;
    $('btn-end').textContent = '确认结束？';
    showToast('再点一次「确认结束」，本局就会立刻结算');
    window.setTimeout(() => {
      if (state.endArmedAt && Date.now() >= state.endArmedAt) {
        state.endArmedAt = 0;
        $('btn-end').textContent = '结束游戏';
      }
    }, 2900);
  });

  const openRecords = () => {
    renderRecords();
    openModal('modal-records');
  };

  $('btn-records').addEventListener('click', openRecords);
  $('btn-records-start').addEventListener('click', openRecords);
  $('btn-records-end').addEventListener('click', openRecords);

  const openSettings = () => {
    renderSkinRows();
    $('mute-toggle').checked = !state.muted;
    openModal('modal-settings');
  };
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-start').addEventListener('click', openSettings);

  $('btn-again').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resumeGame);

  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  }

  // 点遮罩关闭（结算界面除外，避免误触把成绩关掉）
  for (const modal of document.querySelectorAll('.modal')) {
    if (modal.id === 'modal-end') continue;
    modal.addEventListener('pointerdown', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  }

  $('mute-toggle').addEventListener('change', (e) => {
    state.muted = !e.target.checked;
    try {
      localStorage.setItem(LS.muted, state.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!state.muted) playTone(520, 0.12, 0.1, 'triangle');
  });

  $('btn-records-clear').addEventListener('click', () => {
    if (loadRecords().length === 0) {
      showToast('现在还没有记录');
      return;
    }
    if (!window.confirm('清空所有游戏记录？清空后无法恢复。')) return;
    saveRecords([]);
    renderRecords();
    showToast('已清空');
  });

  $('btn-clear-skins').addEventListener('click', () => {
    if (Object.keys(state.skins).length === 0) {
      showToast('现在没有自定义贴图');
      return;
    }
    if (!window.confirm('清空所有自定义贴图？')) return;
    state.skins = {};
    persistSkins();
    renderSkinRows();
    updateNextChip();
    showToast('已清空');
  });

  const skinFile = $('skin-file');
  skinFile.addEventListener('change', () => {
    const file = skinFile.files && skinFile.files[0];
    const level = Number(skinFile.dataset.level);
    skinFile.value = '';
    if (!file || !Number.isInteger(level)) return;
    applySkinFile(level, file);
  });

  $('skin-list').addEventListener('click', (e) => {
    const upload = e.target.closest('[data-upload]');
    if (upload) {
      skinFile.dataset.level = upload.dataset.upload;
      skinFile.click();
      return;
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      const level = Number(clear.dataset.clear);
      delete state.skins[level];
      persistSkins();
      renderSkinRows();
      updateNextChip();
    }
  });

  bindPointer();

  window.addEventListener('keydown', onKeyDown);

  document.addEventListener('visibilitychange', () => {
    state.lastTime = 0;
  });
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    const open = Array.from(document.querySelectorAll('.modal:not([hidden])'));
    if (open.length) {
      closeModal(open[open.length - 1].id);
      e.preventDefault();
    }
    return;
  }
  if (state.phase !== 'playing' || isModalOpen()) return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'ArrowLeft') {
    moveAim(-16);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    moveAim(16);
    e.preventDefault();
  } else if (e.key === ' ' || e.key === 'Enter') {
    dropHeld();
    e.preventDefault();
  }
}

/* ------------------------------------------------------------------ */
/* 指针输入                                                            */
/* ------------------------------------------------------------------ */

function bindPointer() {
  let pressing = false;

  const aimFrom = (e) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    state.aimX = ((e.clientX - rect.left) / rect.width) * W;
    if (state.held) {
      const r = LEVELS[state.held.level].r;
      state.aimX = clamp(state.aimX, LEFT + r + 1, RIGHT - r - 1);
    }
    state.aimX = clamp(state.aimX, LEFT + 4, RIGHT - 4);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (state.phase !== 'playing' || isModalOpen()) return;
    unlockAudio();
    pressing = true;
    aimFrom(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (state.phase !== 'playing' || isModalOpen()) return;
    aimFrom(e);
  });

  const finish = (e) => {
    if (!pressing) return;
    pressing = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (state.phase !== 'playing') return;
    aimFrom(e);
    dropHeld();
  };

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => {
    pressing = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ------------------------------------------------------------------ */
/* 音效                                                               */
/* ------------------------------------------------------------------ */

let audioCtx = null;

function unlockAudio() {
  if (state.muted) return;
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* 没有音频就算了 */
  }
}

function playTone(freq, duration, volume, type) {
  if (state.muted) return;
  try {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.35, t + duration * 0.8);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch {
    /* 忽略音频错误 */
  }
}

/* ------------------------------------------------------------------ */
/* 弹窗                                                               */
/* ------------------------------------------------------------------ */

function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.hidden = false;
  document.body.classList.add('modal-open');
  state.lastTime = 0;
}

function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('modal-open');
  state.lastTime = 0;
  if (id === 'modal-end' && state.phase === 'ended') goToStartScreen();
}

function closeAllModals() {
  for (const el of document.querySelectorAll('.modal')) el.hidden = true;
  document.body.classList.remove('modal-open');
}

function isModalOpen() {
  return Boolean(document.querySelector('.modal:not([hidden])'));
}

let toastTimer = 0;
function showToast(message, ms = 2400) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function hideToast() {
  window.clearTimeout(toastTimer);
  $('toast').hidden = true;
}

/* ------------------------------------------------------------------ */
/* 游戏记录（只存本机）                                                */
/* ------------------------------------------------------------------ */

function isRecord(item) {
  return (
    item &&
    typeof item === 'object' &&
    Number.isFinite(item.score) &&
    Number.isFinite(item.at) &&
    Number.isFinite(item.level)
  );
}

function loadRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS.records) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRecord).slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

function saveRecords(list) {
  try {
    localStorage.setItem(LS.records, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    showToast('浏览器存储空间不够，记录没保存上');
  }
}

/** 同一局如果「继续游戏」后再次结束，就更新那条记录，而不是新增。 */
function recordRun(score) {
  const list = loadRecords();
  const index = list.findIndex((item) => item.id === state.runId);
  const payload = {
    score,
    level: state.maxLevel,
    seconds: Math.round(state.playTime),
  };

  if (index >= 0) {
    list[index] = { ...list[index], ...payload };
  } else {
    list.unshift({
      id: state.runId,
      at: Date.now(),
      ...payload,
    });
  }

  list.sort((a, b) => b.at - a.at);
  saveRecords(list);
}

function renderRecords() {
  const list = loadRecords();
  const stats = $('records-stats');
  const ul = $('records-list');
  stats.replaceChildren();
  ul.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'rec-empty';
    empty.textContent = '还没有记录，先玩一局吧。';
    ul.appendChild(empty);
    return;
  }

  const best = list.reduce((a, r) => Math.max(a, r.score), 0);
  const avg = Math.round(list.reduce((a, r) => a + r.score, 0) / list.length);

  for (const [label, value] of [
    ['局数', String(list.length)],
    ['最高', String(best)],
    ['平均', String(avg)],
  ]) {
    const box = document.createElement('div');
    box.className = 'rec-stat';
    const name = document.createElement('span');
    name.textContent = label;
    const num = document.createElement('b');
    num.textContent = value;
    box.append(name, num);
    stats.appendChild(box);
  }

  let bestMarked = false;
  for (const record of list) {
    const li = document.createElement('li');
    li.className = 'rec-row';

    const isBest = !bestMarked && record.score === best && best > 0;
    if (isBest) {
      li.classList.add('best');
      bestMarked = true;
    }

    const score = document.createElement('span');
    score.className = 'rec-score';
    score.textContent = String(record.score);

    const main = document.createElement('div');
    main.className = 'rec-main';

    const meta = document.createElement('div');
    meta.className = 'rec-meta';
    const levelName = LEVELS[record.level] ? LEVELS[record.level].name : LEVELS[0].name;
    meta.textContent = `最大 ${levelName} · 用时 ${formatDuration(record.seconds || 0)}`;

    const time = document.createElement('div');
    time.className = 'rec-time';
    time.textContent = formatStamp(record.at);

    main.append(meta, time);
    li.append(score, main);

    if (isBest) {
      const badge = document.createElement('span');
      badge.className = 'rec-badge';
      badge.textContent = '最高';
      li.appendChild(badge);
    }

    ul.appendChild(li);
  }
}

/* ------------------------------------------------------------------ */
/* 自定义贴图（只存本机）                                              */
/* ------------------------------------------------------------------ */

function loadSkins() {
  state.skins = {};
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(LS.skins) || '{}') || {};
  } catch {
    raw = {};
  }
  for (const key of sortedKeys(raw)) {
    const level = Number(key);
    const src = raw[key];
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS.length) continue;
    if (typeof src !== 'string' || !src.startsWith('data:image/')) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    state.skins[level] = { img, src };
  }
}

function persistSkins() {
  const out = {};
  for (const key of sortedKeys(state.skins)) out[String(key)] = state.skins[key].src;
  try {
    localStorage.setItem(LS.skins, JSON.stringify(out));
  } catch {
    showToast('浏览器存储空间不够了，贴图没能保存');
  }
}

function applySkinFile(level, file) {
  if (!file.type.startsWith('image/')) {
    showToast('请选一张图片文件');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('图片太大了，请选 10MB 以内的');
    return;
  }

  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    URL.revokeObjectURL(url);
    try {
      const size = 192;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const cx = c.getContext('2d');
      const side = Math.min(img.naturalWidth, img.naturalHeight) || 1;
      cx.drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );

      let dataUrl = c.toDataURL('image/webp', 0.86);
      if (!dataUrl.startsWith('data:image/webp')) dataUrl = c.toDataURL('image/png');

      const skinImg = new Image();
      skinImg.src = dataUrl;
      state.skins[level] = { img: skinImg, src: dataUrl };
      persistSkins();
      renderSkinRows();
      if (state.nextLevel === level) updateNextChip();
      showToast('贴图已替换 · 只有你能看到');
    } catch {
      showToast('这张图片处理不了，换一张试试');
    }
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('这张图片读不出来，换一张试试');
  };

  img.src = url;
}

function renderSkinRows() {
  const list = $('skin-list');
  list.replaceChildren();

  LEVELS.forEach((L, level) => {
    const li = document.createElement('li');
    li.className = 'skin-row';

    const index = document.createElement('span');
    index.className = 'skin-index';
    index.textContent = String(level + 1);

    const name = document.createElement('span');
    name.className = 'skin-name';
    name.textContent = L.name;

    const thumb = document.createElement('span');
    thumb.className = 'skin-thumb';
    const skin = state.skins[level];
    if (skin) {
      thumb.style.backgroundImage = `url("${skin.src}")`;
      thumb.setAttribute('title', '已使用自定义贴图');
    } else {
      thumb.style.backgroundColor = L.color;
      thumb.style.color = L.ink;
      thumb.textContent = L.name;
    }

    const actions = document.createElement('span');
    actions.className = 'skin-actions';

    const upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'btn tiny';
    upload.dataset.upload = String(level);
    upload.textContent = skin ? '更换' : '上传';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn tiny ghost';
    clear.dataset.clear = String(level);
    clear.textContent = '清除';
    clear.disabled = !skin;

    actions.append(upload, clear);
    li.append(index, name, thumb, actions);
    list.appendChild(li);
  });
}

function buildChainPreview() {
  const box = $('chain-preview');
  const frag = document.createDocumentFragment();
  LEVELS.forEach((L, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'chain-arrow';
      arrow.textContent = '→';
      frag.appendChild(arrow);
    }
    const item = document.createElement('span');
    item.className = 'chain-item';
    item.textContent = L.name;
    frag.appendChild(item);
  });
  box.appendChild(frag);
}
