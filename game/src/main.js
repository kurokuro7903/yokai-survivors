// Yokai Survivors — a shrine maiden holds the shrine grounds against yokai
// waves until dawn. Move with WASD / arrows; every weapon fires on its own.
// Collect spirit orbs to level up and choose 1 of 3 blessings. Survive the
// full 180-second night to win. Canvas + WebAudio only: no libraries, no
// network, no storage.
//
// Screenshot / test hooks (not needed to play):
//   ?shot=start|play|boss|end  stages a deterministic scene for screenshots
//   window.__sm.state()        returns a plain snapshot of the run
//   window.__sm.start()        starts a run from the title screen

const W = 960, H = 540;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

let seed = 20261117;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const rr = (a, b) => a + rnd() * (b - a);

// ---------- audio (tiny synth) ----------
let AC = null;
function beep(freq, dur, type = 'square', vol = 0.05, slide = 0) {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), AC.currentTime + dur);
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
  } catch (e) { /* audio is decorative */ }
}
const sShoot = () => beep(880, 0.05, 'square', 0.015);
const sHit = () => beep(220, 0.05, 'sawtooth', 0.02);
const sPickup = (n) => beep(620 + Math.min(n, 12) * 45, 0.07, 'sine', 0.035);
const sHurt = () => beep(140, 0.18, 'sawtooth', 0.06, -60);
const sLevel = () => { beep(523, 0.1, 'sine', 0.05); setTimeout(() => beep(659, 0.1, 'sine', 0.05), 70); setTimeout(() => beep(784, 0.16, 'sine', 0.06), 140); };
const sBoss = () => beep(82, 0.5, 'sawtooth', 0.08, -30);

// ---------- game state ----------
const NIGHT = 180;
let mode = 'title';           // title | play | levelup | over | win
let t = 0, last = 0, shake = 0;
let px = W / 2, py = H / 2 + 30, pFace = 1, pWalk = 0;
let hp = 100, hpMax = 100, level = 1, xp = 0, xpNext = 6;
let kills = 0, score = 0, gemsGot = 0, invuln = 0, pickupChain = 0;
let dmgMul = 1, spdMul = 1, magnetR = 52, cdMul = 1;
let enemies = [], shots = [], gems = [], parts = [], floats = [], bolts = [];
let spawnT = 0, bossSpawned = {}, bossRef = null;
let choices = [], hoverChoice = -1;
const keys = {};

const weapons = {
  ofuda:     { lv: 1, t: 0, cd: 0.55, name: 'Ofuda Talismans', icon: '札' },
  orbit:     { lv: 1, t: 0, cd: 0,    name: 'Gohei Wards',     icon: '幣' },
  hamaya:    { lv: 0, t: 0, cd: 1.6,  name: 'Hamaya Arrows',   icon: '矢' },
  lightning: { lv: 0, t: 0, cd: 3.1,  name: 'Kaminari Wrath',  icon: '雷' },
};

const ETYPES = {
  chochin:  { hp: 12,  spd: 1.35, dmg: 6,  xp: 1, score: 10,  r: 13, name: 'Chochin-obake' },
  karakasa: { hp: 20,  spd: 0.95, dmg: 8,  xp: 1, score: 10,  r: 15, name: 'Karakasa' },
  kappa:    { hp: 38,  spd: 0.78, dmg: 12, xp: 2, score: 20,  r: 15, name: 'Kappa' },
  oni:      { hp: 300, spd: 0.6,  dmg: 20, xp: 12, score: 300, r: 26, name: 'Oni' },
  oniboss:  { hp: 1150, spd: 0.52, dmg: 26, xp: 30, score: 800, r: 40, name: 'Great Oni' },
};

function reset() {
  t = 0; px = W / 2; py = H / 2 + 30; pFace = 1; pWalk = 0;
  hpMax = 100; hp = hpMax; level = 1; xp = 0; xpNext = 6;
  kills = 0; score = 0; gemsGot = 0; invuln = 0; pickupChain = 0;
  dmgMul = 1; spdMul = 1; magnetR = 52; cdMul = 1;
  enemies = []; shots = []; gems = []; parts = []; floats = []; bolts = [];
  spawnT = 0; bossSpawned = {}; bossRef = null; shake = 0;
  weapons.ofuda.lv = 1; weapons.ofuda.t = 0;
  weapons.orbit.lv = 1;
  weapons.hamaya.lv = 0; weapons.hamaya.t = 0;
  weapons.lightning.lv = 0; weapons.lightning.t = 0;
}

function spawnEnemy(type, x, y) {
  const b = ETYPES[type];
  const e = { type, x, y, hp: b.hp, hpMax: b.hp, r: b.r, spd: b.spd * rr(0.85, 1.15),
              dmg: b.dmg, xp: b.xp, score: b.score, flash: 0, hitCd: 0, wob: rr(0, TAU),
              slow: 0, boss: type === 'oniboss' };
  enemies.push(e);
  return e;
}
function spawnEdge(type) {
  const side = Math.floor(rnd() * 4);
  let x, y;
  if (side === 0) { x = rr(0, W); y = -30; } else if (side === 1) { x = rr(0, W); y = H + 30; }
  else if (side === 2) { x = -30; y = rr(0, H); } else { x = W + 30; y = rr(0, H); }
  return spawnEnemy(type, x, y);
}

function burst(x, y, color, n, spd = 2.2) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, s = rr(0.4, spd);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.4, life: rr(0.3, 0.8), max: 0.8, color, r: rr(1.5, 3.5) });
  }
}
function floatText(x, y, text, color = '#ffe9a8', size = 14) {
  floats.push({ x: x + rr(-6, 6), y, text, color, size, life: 0.9 });
}

function damageEnemy(e, dmg, kx = 0, ky = 0) {
  e.hp -= dmg; e.flash = 0.09;
  e.x += kx; e.y += ky;
  floatText(e.x, e.y - e.r - 4, String(Math.round(dmg)), e.boss ? '#ffb3b3' : '#ffe9a8', e.boss ? 16 : 13);
  if (e.hp <= 0 && !e.dead) {
    e.dead = true; kills++; score += e.score;
    burst(e.x, e.y, e.type === 'kappa' ? '#7fe0a8' : e.boss ? '#ff9d5c' : '#c9a8ff', e.boss ? 42 : 14, e.boss ? 3.4 : 2.2);
    for (let i = 0; i < e.xp; i++) gems.push({ x: e.x + rr(-14, 14), y: e.y + rr(-14, 14), vx: rr(-0.6, 0.6), vy: rr(-0.6, 0.6), val: 1 });
    if (e.boss) { shake = 14; bossRef = null; floatText(px, py - 60, 'GREAT ONI PURIFIED! +800', '#ffd76a', 22); sBoss(); }
    sHit();
  }
}

// ---------- level-up choices ----------
const UPOOL = [
  { id: 'hamaya',    can: () => weapons.hamaya.lv < 3, name: () => weapons.hamaya.lv ? 'Hamaya Arrows +' : 'Unlock: Hamaya Arrows', desc: 'Piercing sacred arrows seek the crowd.', icon: '矢' },
  { id: 'lightning', can: () => weapons.lightning.lv < 3, name: () => weapons.lightning.lv ? 'Kaminari Wrath +' : 'Unlock: Kaminari Wrath', desc: 'Lightning smites random yokai.', icon: '雷' },
  { id: 'ofuda+',    can: () => weapons.ofuda.lv < 5, name: () => 'Ofuda Talismans +', desc: 'One more homing talisman per volley.', icon: '札' },
  { id: 'orbit+',    can: () => weapons.orbit.lv < 5, name: () => 'Gohei Wards +', desc: 'One more orbiting ward.', icon: '幣' },
  { id: 'dmg',       can: () => true, name: () => 'Spirit Power +20%', desc: 'All damage rises.', icon: '力' },
  { id: 'spd',       can: () => true, name: () => 'Swift Sandals +12%', desc: 'Move faster.', icon: '速' },
  { id: 'magnet',    can: () => true, name: () => 'Soul Magnet +35%', desc: 'Spirit orbs fly to you from farther.', icon: '引' },
  { id: 'hp',        can: () => true, name: () => 'Vitality +25 & Heal 40', desc: 'Raise max HP and recover.', icon: '命' },
  { id: 'cd',        can: () => true, name: () => 'Focus −12% Cooldowns', desc: 'Weapons fire more often.', icon: '心' },
];
function applyUpgrade(id) {
  if (id === 'hamaya') weapons.hamaya.lv++;
  else if (id === 'lightning') weapons.lightning.lv++;
  else if (id === 'ofuda+') weapons.ofuda.lv++;
  else if (id === 'orbit+') weapons.orbit.lv++;
  else if (id === 'dmg') dmgMul *= 1.2;
  else if (id === 'spd') spdMul *= 1.12;
  else if (id === 'magnet') magnetR *= 1.35;
  else if (id === 'hp') { hpMax += 25; hp = Math.min(hpMax, hp + 40); }
  else if (id === 'cd') cdMul *= 0.88;
}
function openLevelUp() {
  const pool = UPOOL.filter(u => u.can());
  choices = [];
  const copy = pool.slice();
  while (choices.length < 3 && copy.length) choices.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  mode = 'levelup'; sLevel();
}
function gainXp(v) {
  xp += v; gemsGot += v;
  while (xp >= xpNext) { xp -= xpNext; level++; xpNext = 6 + level * 4; if (mode === 'play') openLevelUp(); }
}

// ---------- update ----------
function nearestEnemy(x, y, maxD = 1e9) {
  let best = null, bd = maxD * maxD;
  for (const e of enemies) { const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
  return best;
}

function update(dt) {
  t += dt;
  if (invuln > 0) invuln -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 30);
  pickupChain = Math.max(0, pickupChain - dt * 3);

  // --- player movement ---
  let mx = 0, my = 0;
  if (keys.ArrowLeft || keys.KeyA) mx -= 1;
  if (keys.ArrowRight || keys.KeyD) mx += 1;
  if (keys.ArrowUp || keys.KeyW) my -= 1;
  if (keys.ArrowDown || keys.KeyS) my += 1;
  if (autoPilot) { const a = autoMove(); mx = a[0]; my = a[1]; }
  const ml = Math.hypot(mx, my) || 1;
  if (mx || my) { px += (mx / ml) * 2.6 * spdMul * dt * 60; py += (my / ml) * 2.6 * spdMul * dt * 60; pWalk += dt * 10; if (mx) pFace = mx > 0 ? 1 : -1; }
  px = clamp(px, 24, W - 24); py = clamp(py, 70, H - 22);

  // --- spawning ---
  spawnT -= dt;
  const rate = Math.max(0.28, 0.95 - t * 0.0042);
  if (spawnT <= 0 && enemies.length < 240) {
    spawnT = rate;
    const roll = rnd();
    const type = t < 25 ? (roll < 0.6 ? 'chochin' : 'karakasa')
               : t < 70 ? (roll < 0.4 ? 'chochin' : roll < 0.75 ? 'karakasa' : 'kappa')
               : (roll < 0.3 ? 'chochin' : roll < 0.6 ? 'karakasa' : 'kappa');
    spawnEdge(type);
    if (t > 100 && rnd() < 0.4) spawnEdge(type);
  }
  for (const at of [55, 115]) if (t >= at && !bossSpawned[at]) { bossSpawned[at] = 1; const e = spawnEdge('oni'); floatText(px, py - 70, '⚠ AN ONI APPROACHES ⚠', '#ff9d5c', 20); sBoss(); }
  if (t >= 158 && !bossSpawned.boss) { bossSpawned.boss = 1; bossRef = spawnEdge('oniboss'); floatText(px, py - 70, '⚠ THE GREAT ONI ⚠', '#ff6b6b', 24); sBoss(); shake = 8; }

  // --- weapons ---
  const of = weapons.ofuda;
  of.t -= dt;
  if (of.t <= 0) {
    of.t = of.cd * cdMul;
    const n = of.lv;
    for (let i = 0; i < n; i++) {
      const tgt = nearestEnemy(px, py, 460);
      if (tgt) { shots.push({ kind: 'ofuda', x: px, y: py - 8, vx: 0, vy: -3, tgt, dmg: 12 * dmgMul, life: 1.6 }); sShoot(); }
    }
  }
  const ha = weapons.hamaya;
  if (ha.lv > 0) {
    ha.t -= dt;
    if (ha.t <= 0) {
      ha.t = ha.cd * cdMul;
      const tgt = nearestEnemy(px, py, 560);
      if (tgt) {
        const base = Math.atan2(tgt.y - py, tgt.x - px);
        const count = 1 + ha.lv;
        for (let i = 0; i < count; i++) {
          const a = base + (i - (count - 1) / 2) * 0.22;
          shots.push({ kind: 'arrow', x: px, y: py - 6, vx: Math.cos(a) * 7.2, vy: Math.sin(a) * 7.2, dmg: 16 * dmgMul, life: 0.95, pierce: 3 });
        }
        sShoot();
      }
    }
  }
  const li = weapons.lightning;
  if (li.lv > 0) {
    li.t -= dt;
    if (li.t <= 0) {
      li.t = li.cd * cdMul;
      const inRange = enemies.filter(e => dist2(px, py, e.x, e.y) < 300 * 300);
      for (let i = 0; i < Math.min(1 + li.lv, inRange.length); i++) {
        const e = inRange[Math.floor(rnd() * inRange.length)];
        bolts.push({ x: e.x, y: e.y, life: 0.18 });
        damageEnemy(e, 30 * dmgMul);
      }
      if (inRange.length) beep(1400, 0.12, 'sawtooth', 0.03, -900);
    }
  }
  // orbiting wards
  const orbN = 1 + weapons.orbit.lv;
  const orbR = 56;
  for (let i = 0; i < orbN; i++) {
    const a = t * 2.6 + (i / orbN) * TAU;
    const ox = px + Math.cos(a) * orbR, oy = py + Math.sin(a) * orbR;
    for (const e of enemies) {
      if (e.hitCd <= 0 && dist2(ox, oy, e.x, e.y) < (e.r + 13) * (e.r + 13)) {
        e.hitCd = 0.38;
        const ka = Math.atan2(e.y - py, e.x - px);
        damageEnemy(e, 10 * dmgMul, Math.cos(ka) * 3, Math.sin(ka) * 3);
      }
    }
  }

  // --- shots ---
  for (const s of shots) {
    s.life -= dt;
    if (s.kind === 'ofuda') {
      if (s.tgt && !s.tgt.dead) {
        const a = Math.atan2(s.tgt.y - s.y, s.tgt.x - s.x);
        s.vx += (Math.cos(a) * 9 - s.vx) * 0.22; s.vy += (Math.sin(a) * 9 - s.vy) * 0.22;
      }
      s.x += s.vx; s.y += s.vy;
      const tgt = nearestEnemy(s.x, s.y, 20 + 8);
      if (tgt && dist2(s.x, s.y, tgt.x, tgt.y) < (tgt.r + 6) * (tgt.r + 6)) { damageEnemy(tgt, s.dmg); s.life = 0; burst(s.x, s.y, '#ffd76a', 4, 1.4); }
    } else {
      s.x += s.vx; s.y += s.vy;
      for (const e of enemies) {
        if (!e.dead && dist2(s.x, s.y, e.x, e.y) < (e.r + 5) * (e.r + 5)) {
          damageEnemy(e, s.dmg, s.vx * 0.14, s.vy * 0.14);
          if (--s.pierce <= 0) { s.life = 0; break; }
        }
      }
    }
  }
  shots = shots.filter(s => s.life > 0 && s.x > -40 && s.x < W + 40 && s.y > -40 && s.y < H + 40);

  // --- enemies ---
  for (const e of enemies) {
    if (e.flash > 0) e.flash -= dt;
    if (e.hitCd > 0) e.hitCd -= dt;
    const a = Math.atan2(py - e.y, px - e.x);
    const sp = e.spd * (e.slow > 0 ? 0.5 : 1);
    if (e.slow > 0) e.slow -= dt;
    e.x += Math.cos(a) * sp * dt * 60; e.y += Math.sin(a) * sp * dt * 60;
    e.wob += dt * 5;
    if (dist2(px, py, e.x, e.y) < (e.r + 12) * (e.r + 12) && invuln <= 0) {
      hp -= e.dmg; invuln = 0.7; shake = Math.max(shake, 5); sHurt();
      burst(px, py, '#ff7b7b', 10, 2.4);
      floatText(px, py - 30, `-${e.dmg}`, '#ff8f8f', 16);
      const ka = Math.atan2(e.y - py, e.x - px);
      e.x += Math.cos(ka) * 22; e.y += Math.sin(ka) * 22;
      if (hp <= 0) { hp = 0; mode = 'over'; burst(px, py, '#ffffff', 40, 3); }
    }
  }
  enemies = enemies.filter(e => !e.dead);

  // --- gems ---
  for (const g of gems) {
    const d2 = dist2(px, py, g.x, g.y);
    if (d2 < magnetR * magnetR) { const a = Math.atan2(py - g.y, px - g.x); const pull = 5.2; g.x += Math.cos(a) * pull; g.y += Math.sin(a) * pull; }
    else { g.x += g.vx; g.y += g.vy; g.vx *= 0.92; g.vy *= 0.92; }
    if (d2 < 20 * 20 && !g.got) { g.got = true; pickupChain++; sPickup(pickupChain); gainXp(g.val); score += 2; }
  }
  gems = gems.filter(g => !g.got);

  for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  for (const f of floats) { f.y -= 0.7; f.life -= dt; }
  floats = floats.filter(f => f.life > 0);
  for (const b of bolts) b.life -= dt;
  bolts = bolts.filter(b => b.life > 0);

  score += dt * 5;
  if (t >= NIGHT && mode === 'play') { mode = 'win'; score += 1000 + hp * 5; }
}

let autoPilot = false;
function autoMove() {
  // screenshot / demo pilot: drift toward the nearest gem, shy away from crowds
  let gx = 0, gy = 0, best = 1e12;
  for (const g of gems) { const d = dist2(px, py, g.x, g.y); if (d < best) { best = d; gx = g.x; gy = g.y; } }
  let ax = 0, ay = 0;
  for (const e of enemies) { const d = dist2(px, py, e.x, e.y); if (d < 110 * 110) { ax += (px - e.x) / Math.sqrt(d + 1) * 26; ay += (py - e.y) / Math.sqrt(d + 1) * 26; } }
  let tx = best < 1e11 ? gx : W / 2 + Math.sin(t * 0.6) * 160;
  let ty = best < 1e11 ? gy : H / 2 + Math.cos(t * 0.45) * 90;
  return [clamp((tx - px) / 30 + ax, -1, 1), clamp((ty - py) / 30 + ay, -1, 1)];
}

// ---------- drawing ----------
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0618'); g.addColorStop(0.55, '#150b31'); g.addColorStop(1, '#1d1038');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // moon + glow (rises as dawn nears)
  const dawn = clamp((t - 150) / 30, 0, 1);
  ctx.fillStyle = `rgba(255, 214, 130, ${0.10 + dawn * 0.25})`;
  ctx.beginPath(); ctx.arc(838, 66, 52, 0, TAU); ctx.fill();
  ctx.fillStyle = dawn > 0.4 ? '#ffe9bb' : '#f4ead2';
  ctx.beginPath(); ctx.arc(838, 66, 30, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(21, 11, 49, ${0.85 - dawn * 0.5})`;
  ctx.beginPath(); ctx.arc(826, 58, 26, 0, TAU); ctx.fill();
  // stars
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 40; i++) { const sx = (i * 173) % W, sy = (i * 97) % 150; ctx.fillRect(sx, sy, 2, 2); }
  // distant shrine silhouette + torii
  ctx.fillStyle = '#0e0824';
  ctx.fillRect(60, 118, 190, 60); ctx.beginPath(); ctx.moveTo(45, 118); ctx.lineTo(155, 84); ctx.lineTo(265, 118); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#241040';
  ctx.fillRect(872, 150, 10, 74); ctx.fillRect(916, 150, 10, 74);
  ctx.fillRect(862, 142, 74, 9); ctx.fillRect(868, 162, 62, 7);
  // ground
  const gg = ctx.createLinearGradient(0, 190, 0, H);
  gg.addColorStop(0, '#1a2b26'); gg.addColorStop(1, '#101d1a');
  ctx.fillStyle = gg; ctx.fillRect(0, 190, W, H - 190);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i < 90; i++) ctx.fillRect((i * 211) % W, 200 + (i * 67) % 320, 3, 3);
  // stone lanterns
  for (const lx of [70, 866]) {
    ctx.fillStyle = '#2c3550'; ctx.fillRect(lx, 300, 22, 44); ctx.fillRect(lx - 4, 292, 30, 9);
    ctx.fillStyle = 'rgba(255, 196, 92, 0.85)'; ctx.fillRect(lx + 5, 308, 12, 14);
    ctx.fillStyle = 'rgba(255, 196, 92, 0.16)'; ctx.beginPath(); ctx.arc(lx + 11, 315, 30, 0, TAU); ctx.fill();
  }
  // arena torii gate at top center
  ctx.fillStyle = '#7e2434';
  ctx.fillRect(404, 44, 12, 62); ctx.fillRect(544, 44, 12, 62);
  ctx.fillRect(388, 36, 184, 12); ctx.fillRect(400, 58, 160, 9);
  ctx.fillStyle = '#a33347'; ctx.fillRect(388, 36, 184, 4);
}

function drawMiko() {
  const bob = Math.sin(pWalk) * 2;
  ctx.save(); ctx.translate(px, py + bob * 0.4);
  if (invuln > 0 && Math.floor(t * 14) % 2) ctx.globalAlpha = 0.45;
  // hakama (red skirt)
  ctx.fillStyle = '#c2263c';
  ctx.beginPath(); ctx.moveTo(-7, -2); ctx.lineTo(7, -2); ctx.lineTo(11, 15); ctx.lineTo(-11, 15); ctx.closePath(); ctx.fill();
  // white top
  ctx.fillStyle = '#f7f3ea'; ctx.fillRect(-8, -12, 16, 11);
  ctx.fillStyle = '#c2263c'; ctx.fillRect(-8, -3, 16, 3);
  // head + hair
  ctx.fillStyle = '#ffd9b8'; ctx.beginPath(); ctx.arc(0, -19, 7.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1d1626'; ctx.beginPath(); ctx.arc(0, -21, 7.8, Math.PI, TAU); ctx.fill();
  ctx.fillRect(-8, -21, 3.4, 12); ctx.fillRect(4.6, -21, 3.4, 12);
  // ribbon
  ctx.fillStyle = '#e33e57';
  ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(7, -31); ctx.lineTo(6, -24); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(-7, -31); ctx.lineTo(-6, -24); ctx.closePath(); ctx.fill();
  // gohei wand in facing hand
  ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 2.4;
  const hx = pFace * 10;
  ctx.beginPath(); ctx.moveTo(hx, -6); ctx.lineTo(hx + pFace * 5, -16); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(hx + pFace * 5 - 2.5, -23, 5, 8);
  ctx.restore();
  // orbiting wards
  const orbN = 1 + weapons.orbit.lv;
  for (let i = 0; i < orbN; i++) {
    const a = t * 2.6 + (i / orbN) * TAU;
    const ox = px + Math.cos(a) * 56, oy = py + Math.sin(a) * 56;
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = '#fff7dd'; ctx.fillRect(-4, -8, 8, 16);
    ctx.fillStyle = '#e33e57'; ctx.fillRect(-4, -8, 8, 4);
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 215, 106, 0.20)'; ctx.beginPath(); ctx.arc(ox, oy, 12, 0, TAU); ctx.fill();
  }
}

function drawYokai(e) {
  const wob = Math.sin(e.wob) * 2;
  ctx.save(); ctx.translate(e.x, e.y + wob * 0.4);
  if (e.flash > 0) { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 16; }
  const face = px > e.x ? 1 : -1;
  if (e.type === 'chochin') {
    ctx.fillStyle = '#f59e42'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 15, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d97c26'; ctx.fillRect(-13, -6, 26, 3); ctx.fillRect(-13, 3, 26, 3);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -4, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#14101f'; ctx.beginPath(); ctx.arc(face * 2, -4, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e33e57'; ctx.beginPath(); ctx.ellipse(0, 8, 3.4, 5.5, 0, 0, TAU); ctx.fill();
  } else if (e.type === 'karakasa') {
    ctx.fillStyle = '#8e6cc8'; ctx.beginPath(); ctx.moveTo(-17, -2); ctx.lineTo(0, -18); ctx.lineTo(17, -2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7553ad'; ctx.fillRect(-17, -3, 34, 3.4);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -7, 4.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#14101f'; ctx.beginPath(); ctx.arc(face * 1.6, -7, 2.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 11); ctx.stroke();
    ctx.fillStyle = '#e33e57'; ctx.beginPath(); ctx.ellipse(face * 4, 2, 2.6, 4.4, 0, 0, TAU); ctx.fill();
  } else if (e.type === 'kappa') {
    ctx.fillStyle = '#3f9e63'; ctx.beginPath(); ctx.arc(0, 2, 14, 0, TAU); ctx.fill();
    ctx.fillStyle = '#57bb7d'; ctx.beginPath(); ctx.arc(0, -8, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#bfe8ff'; ctx.beginPath(); ctx.ellipse(0, -13, 6.4, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2d06b'; ctx.beginPath(); ctx.ellipse(face * 3, -6, 4.4, 2.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#14101f'; ctx.beginPath(); ctx.arc(-4.4, -9, 1.7, 0, TAU); ctx.arc(4.4, -9, 1.7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2c7a49'; ctx.fillRect(-9, 4, 18, 5);
  } else {
    const s = e.boss ? 1.55 : 1;
    ctx.scale(s, s);
    ctx.fillStyle = e.boss ? '#b3232e' : '#c2452d';
    ctx.beginPath(); ctx.arc(0, 2, 20, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8f1f28'; ctx.fillRect(-14, 6, 28, 9);
    ctx.fillStyle = '#ffd9b8'; ctx.beginPath(); ctx.arc(0, -12, 12.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2d06b';
    ctx.beginPath(); ctx.moveTo(-10, -20); ctx.lineTo(-14, -30); ctx.lineTo(-5, -23); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, -20); ctx.lineTo(14, -30); ctx.lineTo(5, -23); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#14101f';
    ctx.beginPath(); ctx.arc(-5, -13, 2, 0, TAU); ctx.arc(5, -13, 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#14101f'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-8, -17); ctx.lineTo(-2, -15.6); ctx.moveTo(8, -17); ctx.lineTo(2, -15.6); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(-4, -7, 3, 4); ctx.fillRect(1.4, -7, 3, 4);
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 4.6;
    ctx.beginPath(); ctx.moveTo(face * 16, -2); ctx.lineTo(face * 25, -13); ctx.stroke();
    ctx.fillStyle = '#3a3f4d'; ctx.fillRect(face * 25 - 3, -19, 7, 9);
  }
  ctx.restore();
  // hp bar for tough enemies
  if ((e.hpMax >= 38 || e.boss) && e.hp < e.hpMax) {
    const w = e.boss ? 84 : 32;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(e.x - w / 2, e.y - e.r - 13, w, 5);
    ctx.fillStyle = e.boss ? '#ff5c5c' : '#ffb35c'; ctx.fillRect(e.x - w / 2 + 0.5, e.y - e.r - 12.5, (w - 1) * clamp(e.hp / e.hpMax, 0, 1), 4);
  }
}

function drawWorld() {
  drawBackground();
  // gems
  for (const g of gems) {
    ctx.fillStyle = 'rgba(120, 230, 255, 0.25)'; ctx.beginPath(); ctx.arc(g.x, g.y, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7ce7ff'; ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8fbff'; ctx.beginPath(); ctx.arc(g.x - 1.2, g.y - 1.2, 1.6, 0, TAU); ctx.fill();
  }
  // enemies under shots
  for (const e of enemies) drawYokai(e);
  drawMiko();
  // shots
  for (const s of shots) {
    if (s.kind === 'ofuda') {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx) + Math.PI / 2);
      ctx.fillStyle = '#fff7dd'; ctx.fillRect(-4.5, -8, 9, 16);
      ctx.fillStyle = '#c2263c'; ctx.fillRect(-4.5, -8, 9, 5);
      ctx.fillStyle = '#7e2434'; ctx.fillRect(-1, -1, 2, 6);
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.strokeStyle = '#e8c98a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(7, 0); ctx.stroke();
      ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(5, -4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  // lightning bolts
  for (const b of bolts) {
    ctx.strokeStyle = 'rgba(255, 240, 160, 0.95)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(b.x - 14, 0);
    ctx.lineTo(b.x - 4, b.y * 0.4); ctx.lineTo(b.x + 5, b.y * 0.55); ctx.lineTo(b.x - 2, b.y - 14); ctx.lineTo(b.x + 3, b.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,160,0.3)'; ctx.beginPath(); ctx.arc(b.x, b.y, 22, 0, TAU); ctx.fill();
  }
  // particles + floats
  for (const p of parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const f of floats) { ctx.globalAlpha = clamp(f.life, 0, 1); ctx.font = `bold ${f.size}px sans-serif`; ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y); }
  ctx.globalAlpha = 1;
}

function bar(x, y, w, h, frac, back, fill) {
  ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill; ctx.fillRect(x + 1, y + 1, (w - 2) * clamp(frac, 0, 1), h - 2);
}
function drawHUD() {
  ctx.fillStyle = 'rgba(5, 3, 14, 0.72)'; ctx.fillRect(0, 0, W, 40);
  ctx.textAlign = 'left'; ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#ffb3c0';
  ctx.fillText('HP', 14, 17);
  bar(44, 8, 170, 11, hp / hpMax, '#3a1220', hp / hpMax < 0.3 ? '#ff5c5c' : '#e8486a');
  ctx.fillStyle = '#bfe9ff'; ctx.fillText(`Lv ${level}`, 14, 35);
  bar(44, 26, 170, 8, xp / xpNext, '#10303e', '#59c7e8');
  const remain = Math.max(0, NIGHT - t);
  const mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
  ctx.textAlign = 'center'; ctx.font = 'bold 21px sans-serif'; ctx.fillStyle = remain < 30 ? '#ffd76a' : '#f2edff';
  ctx.fillText(`🌙 ${mm}:${String(ss).padStart(2, '0')}`, W / 2, 28);
  ctx.textAlign = 'right'; ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`SCORE ${Math.floor(score)}`, W - 16, 18);
  ctx.font = '12.5px sans-serif'; ctx.fillStyle = '#bdb2e8';
  ctx.fillText(`Purified ${kills} · Orbs ${gemsGot}`, W - 16, 35);
  // weapon icons
  let wx = 14;
  for (const k of ['ofuda', 'orbit', 'hamaya', 'lightning']) {
    const w = weapons[k];
    if (w.lv <= 0) continue;
    ctx.fillStyle = 'rgba(10, 6, 26, 0.72)'; ctx.fillRect(wx, H - 40, 34, 32);
    ctx.strokeStyle = '#57448f'; ctx.strokeRect(wx + 0.5, H - 39.5, 33, 31);
    ctx.fillStyle = '#ffe9a8'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(w.icon, wx + 17, H - 24);
    ctx.font = '9.5px sans-serif'; ctx.fillStyle = '#bdb2e8'; ctx.fillText(`Lv${w.lv}`, wx + 17, H - 12);
    wx += 40;
  }
  // boss bar
  if (bossRef && !bossRef.dead) {
    ctx.textAlign = 'center'; ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#ff9d9d';
    ctx.fillText('👹 GREAT ONI', W / 2, 56);
    bar(W / 2 - 170, 62, 340, 9, bossRef.hp / bossRef.hpMax, '#3a0d12', '#e33e57');
  }
}

function panel(w, h) {
  ctx.fillStyle = 'rgba(7, 4, 18, 0.82)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#150b31'; ctx.fillRect((W - w) / 2, (H - h) / 2, w, h);
  ctx.strokeStyle = '#a33347'; ctx.lineWidth = 2; ctx.strokeRect((W - w) / 2, (H - h) / 2, w, h);
}

function drawTitle() {
  drawWorld();
  panel(620, 356);
  ctx.textAlign = 'center';
  ctx.font = 'bold 54px sans-serif'; ctx.fillStyle = '#ffd76a';
  ctx.fillText('YOKAI SURVIVORS', W / 2, 168);
  ctx.font = '17px sans-serif'; ctx.fillStyle = '#e8e2ff';
  ctx.fillText('The yokai own the night. The shrine maiden owns a gohei.', W / 2, 204);
  ctx.font = '15px sans-serif'; ctx.fillStyle = '#bdb2e8';
  ctx.fillText('Move with WASD / arrow keys — your weapons fire on their own.', W / 2, 248);
  ctx.fillText('Gather spirit orbs, level up, choose blessings, and drive back', W / 2, 272);
  ctx.fillText('the Great Oni before dawn. Survive 180 seconds to win.', W / 2, 296);
  ctx.font = 'bold 19px sans-serif'; ctx.fillStyle = '#7ce7ff';
  ctx.fillText('▶  CLICK or press ENTER to begin the night', W / 2, 348);
  ctx.font = '12.5px sans-serif'; ctx.fillStyle = '#8f86b8';
  ctx.fillText('Ofuda talismans · Hamaya arrows · Gohei wards · Kaminari lightning', W / 2, 388);
}

function drawLevelUp() {
  drawWorld(); drawHUD();
  ctx.fillStyle = 'rgba(7, 4, 18, 0.66)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = '#ffd76a';
  ctx.fillText('✦ LEVEL UP — CHOOSE A BLESSING ✦', W / 2, 148);
  choices.forEach((c, i) => {
    const x = W / 2 - 330 + i * 226, y = 190, w = 204, h = 168;
    ctx.fillStyle = i === hoverChoice ? '#2a1650' : '#1a0e38';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = i === hoverChoice ? '#ffd76a' : '#57448f'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.font = '34px sans-serif'; ctx.fillStyle = '#ffe9a8'; ctx.fillText(c.icon, x + w / 2, y + 52);
    ctx.font = 'bold 15.5px sans-serif'; ctx.fillStyle = '#f2edff';
    wrapText(c.name(), x + w / 2, y + 86, w - 22, 19);
    ctx.font = '12.5px sans-serif'; ctx.fillStyle = '#bdb2e8';
    wrapText(c.desc, x + w / 2, y + 126, w - 22, 16);
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#7ce7ff'; ctx.fillText(`[ ${i + 1} ]`, x + w / 2, y + h - 10);
  });
}
function wrapText(text, cx, y, maxW, lh) {
  const words = text.split(' '); let line = '', yy = y;
  for (const w of words) {
    if (ctx.measureText(line + w).width > maxW && line) { ctx.fillText(line, cx, yy); yy += lh; line = ''; }
    line += w + ' ';
  }
  if (line) ctx.fillText(line, cx, yy);
}

function drawEnd(win) {
  drawWorld();
  panel(560, 320);
  ctx.textAlign = 'center';
  ctx.font = 'bold 44px sans-serif'; ctx.fillStyle = win ? '#ffd76a' : '#ff8f8f';
  ctx.fillText(win ? '🌅 DAWN BREAKS!' : 'THE NIGHT TAKES YOU', W / 2, 190);
  ctx.font = '16.5px sans-serif'; ctx.fillStyle = '#e8e2ff';
  ctx.fillText(win ? 'The shrine stands. The yokai scatter with the light.' : `You purified ${kills} yokai before falling at ${Math.floor(t)}s.`, W / 2, 228);
  ctx.font = 'bold 21px sans-serif'; ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`SCORE ${Math.floor(score)}`, W / 2, 276);
  ctx.font = '14.5px sans-serif'; ctx.fillStyle = '#bdb2e8';
  ctx.fillText(`Purified ${kills} · Level ${level} · Orbs gathered ${gemsGot}`, W / 2, 306);
  ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#7ce7ff';
  ctx.fillText('▶  CLICK or press ENTER for another night', W / 2, 352);
}

function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(rr(-shake, shake) * 0.4, rr(-shake, shake) * 0.4);
  if (mode === 'title') drawTitle();
  else if (mode === 'levelup') drawLevelUp();
  else if (mode === 'over') drawEnd(false);
  else if (mode === 'win') drawEnd(true);
  else { drawWorld(); drawHUD(); }
  ctx.restore();
}

// ---------- input ----------
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if ((mode === 'title' || mode === 'over' || mode === 'win') && (e.code === 'Enter' || e.code === 'Space')) { reset(); mode = 'play'; }
  if (mode === 'levelup' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    const c = choices[Number(e.code.slice(-1)) - 1];
    if (c) { applyUpgrade(c.id); mode = 'play'; }
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
function choiceAt(mx, my) {
  for (let i = 0; i < choices.length; i++) {
    const x = W / 2 - 330 + i * 226, y = 190;
    if (mx >= x && mx <= x + 204 && my >= y && my <= y + 168) return i;
  }
  return -1;
}
cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  hoverChoice = choiceAt((e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height);
});
cv.addEventListener('click', (e) => {
  if (mode === 'title' || mode === 'over' || mode === 'win') { reset(); mode = 'play'; return; }
  if (mode === 'levelup') {
    const r = cv.getBoundingClientRect();
    const i = choiceAt((e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height);
    if (i >= 0) { applyUpgrade(choices[i].id); mode = 'play'; }
  }
});

// ---------- staged scenes for screenshots ----------
function stage(kind) {
  seed = 777;
  reset();
  px = 430; py = 320;
  if (kind === 'start') { mode = 'title'; scatterAmbient(); return; }
  mode = 'play'; autoPilot = true;
  if (kind === 'play') {
    bossSpawned = { 55: 1 };
    t = 74; level = 6; xp = 3; xpNext = 30; hp = 78; kills = 96; score = 2410; gemsGot = 121;
    weapons.hamaya.lv = 2; weapons.lightning.lv = 1; weapons.ofuda.lv = 3; weapons.orbit.lv = 2; dmgMul = 1.2;
    const kinds = ['chochin', 'karakasa', 'kappa'];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + rr(-0.2, 0.2), d = rr(120, 330);
      spawnEnemy(kinds[i % 3], clamp(px + Math.cos(a) * d, 20, W - 20), clamp(py + Math.sin(a) * d, 60, H - 20));
    }
    for (let i = 0; i < 14; i++) gems.push({ x: px + rr(-190, 190), y: py + rr(-140, 140), vx: 0, vy: 0, val: 1 });
    for (let i = 0; i < 7; i++) shots.push({ kind: 'ofuda', x: px + rr(-90, 90), y: py + rr(-80, 80), vx: rr(-2, 2), vy: rr(-2, 2), tgt: enemies[i], dmg: 14, life: 1.4 });
    for (let i = 0; i < 4; i++) shots.push({ kind: 'arrow', x: px + rr(-60, 160), y: py + rr(-50, 50), vx: 7, vy: rr(-1, 1), dmg: 16, life: 0.9, pierce: 2 });
    bolts.push({ x: px - 150, y: py - 90, life: 0.18 });
    floatText(px - 120, py - 110, '24', '#ffe9a8', 14); floatText(px + 140, py + 40, '36', '#ffe9a8', 14); floatText(px + 60, py - 150, '12', '#ffe9a8', 13);
  } else if (kind === 'boss') {
    bossSpawned = { 55: 1, 115: 1, boss: 1 };
    t = 166; level = 9; xp = 8; xpNext = 42; hp = 57; hpMax = 125; kills = 231; score = 5870; gemsGot = 268;
    weapons.hamaya.lv = 3; weapons.lightning.lv = 2; weapons.ofuda.lv = 4; weapons.orbit.lv = 3; dmgMul = 1.44;
    bossRef = spawnEnemy('oniboss', 660, 190); bossRef.hp = 520;
    const kinds = ['chochin', 'karakasa', 'kappa', 'oni'];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU + rr(-0.3, 0.3), d = rr(140, 360);
      spawnEnemy(kinds[i % 4], clamp(px + Math.cos(a) * d, 20, W - 20), clamp(py + Math.sin(a) * d, 60, H - 20));
    }
    for (let i = 0; i < 18; i++) gems.push({ x: px + rr(-230, 230), y: py + rr(-160, 160), vx: 0, vy: 0, val: 1 });
    bolts.push({ x: 660, y: 190, life: 0.18 }); bolts.push({ x: px - 190, y: py - 60, life: 0.18 });
    for (let i = 0; i < 8; i++) shots.push({ kind: 'ofuda', x: px + rr(-110, 110), y: py + rr(-90, 90), vx: rr(-2, 2), vy: rr(-2, 2), tgt: bossRef, dmg: 17, life: 1.4 });
    floatText(660, 130, '87', '#ffb3b3', 17); floatText(px - 140, py - 120, '41', '#ffe9a8', 14);
  } else if (kind === 'end') {
    t = 180; level = 10; kills = 286; score = 9640; gemsGot = 322; hp = 43; hpMax = 125;
    mode = 'win'; scatterAmbient();
  }
}
function scatterAmbient() {
  for (let i = 0; i < 7; i++) spawnEnemy(['chochin', 'karakasa', 'kappa'][i % 3], rr(60, W - 60), rr(90, H - 60));
}

// ---------- main loop ----------
function frame(ts) {
  const now = ts / 1000;
  let dt = Math.min(0.05, now - (last || now));
  last = now;
  if (mode === 'play') update(dt);
  else if (mode === 'title' || mode === 'win' || mode === 'over') { t += dt * 0.25; for (const e of enemies) { e.wob += dt * 4; } }
  draw();
  requestAnimationFrame(frame);
}

const shotKind = new URLSearchParams(location.search).get('shot');
if (shotKind) stage(shotKind);
requestAnimationFrame(frame);

window.__sm = {
  state: () => ({ mode, t: Math.round(t), hp, level, kills, score: Math.floor(score), enemies: enemies.length, weapons: { ofuda: weapons.ofuda.lv, hamaya: weapons.hamaya.lv, lightning: weapons.lightning.lv, orbit: weapons.orbit.lv } }),
  start: () => { reset(); mode = 'play'; },
  auto: (on) => { autoPilot = !!on; },
  choose: (i) => { if (mode === 'levelup' && choices[i]) { applyUpgrade(choices[i].id); mode = 'play'; } },
};
