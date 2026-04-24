'use strict';

// ═══════════════════════════════════════════════════════════
// Enemy pixel sprites — original designs (5 rows × 8 cols)
// Type 0: "Data Wraith"  Type 1: "Packet Goblin"  Type 2: "Firewall Drone"
// ═══════════════════════════════════════════════════════════
const SPR = [
  // Type 0 — Data Wraith (skull-like, top rows, 30 pts)
  [ [[1,0,1,0,0,1,0,1],[0,1,1,1,1,1,1,0],[1,1,0,1,1,0,1,1],[0,1,1,1,1,1,1,0],[1,0,0,1,1,0,0,1]],
    [[0,1,0,1,1,0,1,0],[1,1,1,1,1,1,1,1],[0,1,0,1,1,0,1,0],[1,1,1,1,1,1,1,1],[0,1,0,0,0,0,1,0]] ],
  // Type 1 — Packet Goblin (horns + wide grin, middle row, 20 pts)
  [ [[1,0,0,1,1,0,0,1],[0,1,1,1,1,1,1,0],[1,0,1,0,0,1,0,1],[0,1,1,1,1,1,1,0],[0,0,1,0,0,1,0,0]],
    [[1,0,1,0,0,1,0,1],[0,1,1,1,1,1,1,0],[0,1,0,1,1,0,1,0],[0,1,1,1,1,1,1,0],[1,0,0,1,1,0,0,1]] ],
  // Type 2 — Firewall Drone (angular + symmetric, bottom rows, 10 pts)
  [ [[1,1,0,0,0,0,1,1],[0,1,1,0,0,1,1,0],[0,0,1,1,1,1,0,0],[0,1,1,0,0,1,1,0],[1,0,0,1,1,0,0,1]],
    [[0,1,1,0,0,1,1,0],[1,0,1,1,1,1,0,1],[0,0,1,1,1,1,0,0],[1,0,1,1,1,1,0,1],[0,1,0,0,0,0,1,0]] ],
];
const SPR_COLORS = ['#ff4488','#44ffcc','#ffaa00'];

function drawEnemy(ctx, e) {
  const ti = e.points === 30 ? 0 : e.points === 20 ? 1 : 2;
  const frame = (gs.tick >> 4) & 1;
  const sprite = SPR[ti][frame];
  const rows = sprite.length, cols = sprite[0].length;
  const pw = e.w / cols, ph = e.h / rows;
  const bob = audioCtx ? Math.sin(beatPhase) * 1.8 : 0;

  if (e.bomb) {
    const urgency = 1 - e.bombTick / BOMB_DURATION;
    const flashRate = 4 + Math.round(urgency * 8);
    const flashOn = (gs.tick % flashRate) < (flashRate >> 1);
    ctx.save();
    ctx.fillStyle = flashOn ? (urgency > 0.6 ? '#fff' : '#ff4400') : SPR_COLORS[ti];
    if (flashOn) { ctx.shadowColor = '#ff2200'; ctx.shadowBlur = 14 + urgency * 10; }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (sprite[r][c])
          ctx.fillRect(Math.round(e.x + c*pw), Math.round(e.y + r*ph + bob),
                       Math.max(1, Math.floor(pw)), Math.max(1, Math.floor(ph)));
    ctx.strokeStyle = flashOn ? '#ff4400' : '#ff000066';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(e.x + e.w/2, e.y + e.h/2, e.w * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.fillStyle = SPR_COLORS[ti];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (sprite[r][c])
        ctx.fillRect(Math.round(e.x + c*pw), Math.round(e.y + r*ph + bob),
                     Math.max(1, Math.floor(pw)), Math.max(1, Math.floor(ph)));
}

// ═══════════════════════════════════════════════════════════
// Generic spaceship sprite — vector triangle design
// faceDown=false → nose points up (regular), true → nose points down (invader)
// ═══════════════════════════════════════════════════════════
function drawShip(ctx, cx, cy, w, h, bodyCol, trimCol, engineCol, faceDown) {
  ctx.save();
  if (faceDown) {
    ctx.translate(cx, cy);
    ctx.scale(1, -1);
    ctx.translate(-cx, -cy);
  }

  // Wide, squat triangle — nose up, broad base (2:1 width-to-height)
  const hw = w * 0.48;
  const hh = h * 0.34;

  ctx.beginPath();
  ctx.moveTo(cx,       cy - hh);   // nose
  ctx.lineTo(cx - hw,  cy + hh);   // bottom-left
  ctx.lineTo(cx + hw,  cy + hh);   // bottom-right
  ctx.closePath();
  ctx.fillStyle = bodyCol;
  ctx.fill();

  // Small cockpit dot near nose
  ctx.beginPath();
  ctx.arc(cx, cy - hh * 0.2, hw * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = trimCol;
  ctx.fill();

  // Engine glow strip along the base
  ctx.shadowColor = engineCol;
  ctx.shadowBlur = 7;
  ctx.fillStyle = engineCol;
  ctx.fillRect(cx - hw * 0.3, cy + hh - 3, hw * 0.6, 3);
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Player rendering
// ═══════════════════════════════════════════════════════════
function drawPlayer(ctx, p) {
  const isSelf    = p.id === gs.myId;
  const exploding = p.explodeTick > 0;

  if (exploding) {
    drawExplosion(ctx, p.x + p.w/2, p.y + p.h/2, p.explodeTick, 45, p.id);
    return;
  }

  const cx = p.x + p.w/2, cy = p.y + p.h/2;

  ctx.save();
  if (p.team === 'invader') {
    const body   = isSelf ? '#f84' : '#c33';
    const cockpit = isSelf ? '#ff0' : '#a00';
    const engine  = isSelf ? '#f40' : '#800';
    drawShip(ctx, cx, cy, p.w, p.h, body, cockpit, engine, true);
  } else {
    const body   = isSelf ? '#8ef' : '#5a8';
    const cockpit = isSelf ? '#fff' : '#9db';
    const engine  = isSelf ? '#0cf' : '#080';
    drawShip(ctx, cx, cy, p.w, p.h, body, cockpit, engine, false);
  }
  ctx.restore();

  // Name label
  ctx.save();
  ctx.font      = 'bold 10px "Courier New",monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = isSelf ? '#fff' : '#aaa';
  ctx.fillText(p.name, cx, p.y - 18);

  // Score under name
  ctx.fillStyle = '#666';
  ctx.font = '9px "Courier New",monospace';
  ctx.fillText(p.score, cx, p.y - 8);

  // Health bar
  const bw = p.w + 10, bh = 4;
  const bx = p.x - 5,  by = p.y - 5;
  const pct = Math.max(0, p.health / p.maxHealth);
  ctx.fillStyle = '#222';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = pct > 0.5 ? '#0f0' : pct > 0.25 ? '#ff0' : '#f00';
  ctx.fillRect(bx, by, bw * pct, bh);

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Explosion animation
// ═══════════════════════════════════════════════════════════
// Seeded PRNG for reproducible particles per player
function prng(seed) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [seed / 0xffffffff, seed];
}

const explosionParts = {}; // cache per player id

function getParticles(id) {
  if (explosionParts[id]) return explosionParts[id];
  const parts = [];
  let s = 0;
  for (const ch of id) s = (s*31 + ch.charCodeAt(0)) | 0;
  for (let i = 0; i < 24; i++) {
    let v, r;
    [v, s] = prng(s); const angle = v * Math.PI * 2;
    [v, s] = prng(s); const speed = 0.4 + v * 0.6;
    [v, s] = prng(s); const color = ['#f60','#f00','#ff0','#fa0'][Math.floor(v*4)];
    [v, s] = prng(s); const size  = 2 + v * 3;
    parts.push({angle, speed, color, size});
  }
  explosionParts[id] = parts;
  return parts;
}

let prevExploding = {};

// ── Enemy death explosions (client-side, position tracked locally) ──
const prevEnemyPos = {}; // id -> {cx, cy, points}
const enemyBlasts  = []; // [{cx,cy,tick,maxTick,id,color}]

function tickEnemyBlasts() {
  for (let i = enemyBlasts.length-1; i >= 0; i--) {
    enemyBlasts[i].tick--;
    if (enemyBlasts[i].tick <= 0) enemyBlasts.splice(i,1);
  }
}

function syncEnemyDeaths() {
  const alive = new Set(gs.enemies.map(e => e.id));
  for (const [id, pos] of Object.entries(prevEnemyPos)) {
    if (!alive.has(parseInt(id))) {
      // Enemy just died — spawn blast
      const color = pos.points === 30 ? '#d04fff' : pos.points === 20 ? '#ffdd00' : '#00ff66';
      const maxT = 40;
      enemyBlasts.push({cx:pos.cx, cy:pos.cy, tick:maxT, maxTick:maxT, id:`e${id}`, color});
      playEnemyDeathSound(pos.points);
      playEnemyHitSound();
      delete prevEnemyPos[id];
    }
  }
  for (const e of gs.enemies) {
    prevEnemyPos[e.id] = {cx: e.x + e.w/2, cy: e.y + e.h/2, points: e.points};
  }
}

function drawEnemyBlasts(ctx) {
  for (const b of enemyBlasts) {
    const progress = 1 - b.tick / b.maxTick;
    const maxR = 38;

    // Shockwave
    ctx.save();
    ctx.globalAlpha = (1 - progress) * 0.9;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, progress * maxR * 1.6, 0, Math.PI*2);
    ctx.stroke();

    // Second ring (delayed)
    if (progress > 0.2) {
      ctx.globalAlpha = (1 - progress) * 0.6;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, (progress-0.2) * maxR * 2.2, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    // Bright flash (early)
    if (progress < 0.25) {
      ctx.save();
      ctx.globalAlpha = (0.25 - progress) / 0.25 * 0.9;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, maxR * 0.35 * (1 - progress/0.25), 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Sparks
    const parts = getParticles(b.id);
    ctx.save();
    for (const p of parts) {
      const dist = progress * maxR * (p.speed + 0.5);
      const px = b.cx + Math.cos(p.angle) * dist;
      const py = b.cy + Math.sin(p.angle) * dist;
      const sz = Math.max(0.5, p.size * 0.8 * (1 - progress));
      ctx.globalAlpha = Math.max(0, 1 - progress * 1.4);
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(px, py, sz, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawExplosion(ctx, cx, cy, tick, maxTick, id) {
  const progress = 1 - tick / maxTick;
  const maxR = 55;

  // Expanding shockwave ring
  ctx.save();
  ctx.globalAlpha = (1 - progress) * 0.7;
  ctx.strokeStyle = '#f80';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, progress * maxR * 1.4, 0, Math.PI*2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // Bright core flash (early only)
  if (progress < 0.3) {
    ctx.save();
    ctx.globalAlpha = (0.3 - progress) / 0.3;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.3 * (1 - progress/0.3), 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // Particles (use a dummy id if none)
  const parts = getParticles(id || `${Math.round(cx)},${Math.round(cy)}`);
  ctx.save();
  for (const p of parts) {
    const dist = progress * maxR * p.speed;
    const px = cx + Math.cos(p.angle) * dist;
    const py = cy + Math.sin(p.angle) * dist;
    const sz = Math.max(0.5, p.size * (1 - progress));
    ctx.globalAlpha = Math.max(0, 1 - progress * 1.3);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(px, py, sz, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Animal critters (replace UFO)
// ═══════════════════════════════════════════════════════════
let ufoSndTick = 0;

// 6 animals: cat, rabbit, duck, fish, penguin, frog
// Each is drawn with pixel-rect art in a 8×6 grid
// Pixel grids [6 rows × 8 cols]
const ANIMAL_SPR = [
  // 0: Cat — pointy ears, whiskers
  [[0,1,0,0,0,0,1,0],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[0,1,1,0,0,1,1,0],[0,0,1,1,1,1,0,0]],
  // 1: Rabbit — tall ears, round body
  [[0,1,0,1,1,0,1,0],[0,1,0,1,1,0,1,0],[0,1,1,1,1,1,1,0],[1,1,0,1,1,0,1,1],[0,1,1,1,1,1,1,0],[0,0,1,0,0,1,0,0]],
  // 2: Duck — beak, round head
  [[0,0,1,1,1,0,0,0],[0,1,1,1,1,1,0,0],[1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1],[0,0,1,1,1,1,0,0],[0,0,0,1,1,0,0,0]],
  // 3: Fish — fins, tail fan
  [[0,0,0,1,1,0,1,0],[1,0,1,1,1,1,1,1],[1,1,1,1,1,1,0,0],[1,0,1,1,1,1,1,1],[0,0,0,1,1,0,1,0],[0,0,0,0,0,0,0,0]],
  // 4: Penguin — tuxedo belly
  [[0,0,1,1,1,1,0,0],[0,1,0,1,1,0,1,0],[0,1,1,0,0,1,1,0],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0],[0,1,0,0,0,0,1,0]],
  // 5: Frog — big eyes, wide mouth
  [[0,1,0,0,0,0,1,0],[1,1,1,1,1,1,1,1],[0,1,0,1,1,0,1,0],[0,1,1,1,1,1,1,0],[0,0,1,0,0,1,0,0],[0,0,0,0,0,0,0,0]],
];

function drawUFO(ctx, u) {
  const cx = u.x + u.w/2, cy = u.y + u.h/2;
  const ai = (u.animal || 0) % 6;
  const col = ANIMAL_COLORS[ai];
  const spr = ANIMAL_SPR[ai];
  const rows = spr.length, cols = spr[0].length;
  const pw = u.w / cols, ph = u.h / rows;

  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 10;
  ctx.fillStyle = col;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (spr[r][c])
        ctx.fillRect(Math.round(u.x + c*pw), Math.round(u.y + r*ph),
                     Math.max(1, Math.floor(pw)), Math.max(1, Math.floor(ph)));
  ctx.shadowBlur = 0;

  // Points label
  ctx.font = 'bold 9px "Courier New",monospace';
  ctx.fillStyle = '#ff0';
  ctx.textAlign = 'center';
  ctx.fillText(`${ANIMAL_NAMES[ai]} +${u.points}`, cx, u.y - 4);
  ctx.restore();

  const now = Date.now();
  if (now - ufoSndTick > 600) { playUFOSound(); ufoSndTick = now; }
}

// ═══════════════════════════════════════════════════════════
// Shields
// ═══════════════════════════════════════════════════════════
function drawShields(ctx) {
  // Group cells by shield group, compute bounding box per group
  const groups = {};
  for (const s of gs.shields) {
    const g = s.group;
    if (!groups[g]) groups[g] = {minX:Infinity, minY:Infinity, maxX:-Infinity, maxY:-Infinity, cells:[]};
    const gr = groups[g];
    gr.minX = Math.min(gr.minX, s.x);
    gr.minY = Math.min(gr.minY, s.y);
    gr.maxX = Math.max(gr.maxX, s.x + s.w);
    gr.maxY = Math.max(gr.maxY, s.y + s.h);
    gr.cells.push(s);
  }
  for (const gr of Object.values(groups)) {
    // Majority HP determines gradient color
    const intact = gr.cells.filter(s => s.hp === 2).length;
    const mostly = intact >= gr.cells.length / 2;
    const grad = ctx.createLinearGradient(gr.minX, gr.minY, gr.minX, gr.maxY);
    if (mostly) {
      grad.addColorStop(0,   '#7fffc4');
      grad.addColorStop(0.35,'#0ec870');
      grad.addColorStop(1,   '#023a18');
    } else {
      grad.addColorStop(0,   '#f0c030');
      grad.addColorStop(0.4, '#9a4006');
      grad.addColorStop(1,   '#2a0800');
    }
    ctx.fillStyle = grad;
    for (const s of gr.cells) {
      ctx.fillRect(s.x, s.y, s.w, s.h);
      if (s.hp === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(s.x + s.w*0.3, s.y,           s.w*0.1, s.h*0.6);
        ctx.fillRect(s.x + s.w*0.6, s.y + s.h*0.4, s.w*0.1, s.h*0.6);
        ctx.fillStyle = grad; // restore for next cell
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Bullet rendering
// ═══════════════════════════════════════════════════════════
function drawBullet(ctx, b) {
  if (b.owner === 'regular') {
    ctx.fillStyle = '#0ff';
    ctx.shadowColor = '#0ff';
  } else if (b.owner === 'invader') {
    ctx.fillStyle = '#f80';
    ctx.shadowColor = '#f80';
  } else {
    ctx.fillStyle = '#f33';
    ctx.shadowColor = '#f33';
  }
  ctx.shadowBlur = 5;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.shadowBlur = 0;
}

// ═══════════════════════════════════════════════════════════
// HUD
// ═══════════════════════════════════════════════════════════
function drawHUD(ctx) {
  ctx.save();

  // ── Title banner ──────────────────────────────────
  ctx.textAlign = 'center';

  // Glow pass
  ctx.shadowColor = '#0ff';
  ctx.shadowBlur  = 18;
  ctx.font        = 'bold 22px "Courier New",monospace';
  ctx.fillStyle   = '#0ff';
  ctx.fillText('SCALE INVADERS', W/2, 22);
  ctx.shadowBlur  = 0;

  // Subtitle
  ctx.font        = '9px "Courier New",monospace';
  ctx.shadowColor = '#0cf';
  ctx.shadowBlur  = 10;
  ctx.fillStyle   = '#9ef';
  ctx.fillText('Powered by Tailscale', W/2, 34);
  ctx.shadowBlur  = 0;

  // ── Wave counter (top-left) ────────────────────────
  ctx.font      = 'bold 14px "Courier New",monospace';
  ctx.fillStyle = '#0ff';
  ctx.textAlign = 'left';
  ctx.fillText(`WAVE ${gs.wave}`, 12, 22);

  if (!gs.connected) {
    ctx.fillStyle = '#f44';
    ctx.font = '14px "Courier New",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CONNECTING…', W/2, H/2);
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Game-over overlay
// ═══════════════════════════════════════════════════════════
function drawGameOver(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#f33';
  ctx.font = 'bold 48px "Courier New",monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#f33';
  ctx.shadowBlur = 20;
  ctx.fillText('GAME OVER', W/2, H/2 - 20);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#aaa';
  ctx.font = '16px "Courier New",monospace';
  ctx.fillText('Resetting…', W/2, H/2 + 20);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Ground line
// ═══════════════════════════════════════════════════════════
function drawGround(ctx) {
  ctx.save();
  ctx.strokeStyle = '#0a03';
  ctx.lineWidth = 1;
  ctx.setLineDash([4,4]);
  ctx.beginPath();
  ctx.moveTo(0, H-28); ctx.lineTo(W, H-28);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Active power-up bar (bottom of canvas, for self only)
// ═══════════════════════════════════════════════════════════
const POWER_DEFS = [
  {key:'powerRapid', lbl:'RAPID FIRE',  col:'#f0f'},
  {key:'powerWide',  lbl:'WIDE SHOT',   col:'#0ff'},
  {key:'powerMulti', lbl:'TRIPLE SHOT', col:'#ff0'},
  {key:'powerSpeed', lbl:'SPEED BOOST', col:'#7ff'},
];

function drawPowerBar(ctx) {
  if (!gs.myId) return;
  const me = gs.players.find(p => p.id === gs.myId);
  if (!me) return;
  const items = [];
  for (const {key, lbl, col} of POWER_DEFS) {
    const ticks = me[key];
    if (ticks > 0) items.push({lbl, col, pct: ticks / POWERUP_DURATION, ticks});
  }
  if (!items.length) return;

  ctx.save();
  const barH = 14, barW = 120, gap = 8;
  let x = gap;
  const y = H - 22;
  ctx.font = 'bold 8px "Courier New",monospace';
  for (const it of items) {
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, barW, barH);
    // Progress fill
    ctx.fillStyle = it.col + '55';
    ctx.fillRect(x, y, barW * it.pct, barH);
    // Border
    ctx.strokeStyle = it.col;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barW, barH);
    // Label + seconds remaining
    const secs = Math.ceil(it.ticks / TICKS_PER_SEC);
    ctx.fillStyle = it.col;
    ctx.textAlign = 'left';
    ctx.fillText(it.lbl, x + 4, y + 10);
    ctx.textAlign = 'right';
    ctx.fillText(secs + 's', x + barW - 3, y + 10);
    x += barW + gap;
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Power-up rendering
// ═══════════════════════════════════════════════════════════
const PU_COLORS = {rapid:'#f0f', wide:'#0ff', multi:'#ff0', speed:'#0ff', health:'#0f0'};
const PU_LABELS = {rapid:'⚡', wide:'▶◀', multi:'✦', speed:'»', health:'♥'};

function drawPowerups(ctx) {
  for (const pu of gs.powerups) {
    const col = PU_COLORS[pu.type] || '#fff';
    const cx = pu.x + pu.w/2, cy = pu.y + pu.h/2;
    // Glowing box
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur  = 12;
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(pu.x, pu.y, pu.w, pu.h);
    ctx.fillStyle = col + '22';
    ctx.fillRect(pu.x, pu.y, pu.w, pu.h);
    // Spinning diagonal lines (cheap animation)
    const phase = (gs.tick * 3) % 360 * Math.PI / 180;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(phase)*6, cy + Math.sin(phase)*6);
    ctx.lineTo(cx - Math.cos(phase)*6, cy - Math.sin(phase)*6);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Label
    ctx.fillStyle = col;
    ctx.font = '11px "Courier New",monospace';
    ctx.textAlign = 'center';
    ctx.fillText(PU_LABELS[pu.type] || pu.type.slice(0,1).toUpperCase(), cx, cy + 4);
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════
// Bullet trails
// ═══════════════════════════════════════════════════════════
const explodingSet = new Set();
const prevPlayerHealth = {}; // id -> health, for hit sound detection
const bulletTrails = {};     // id -> [{x,y,w,h,owner}, ...]
const BULLET_TRAIL_LEN = 7;

function updateBulletTrails() {
  const live = new Set();
  for (const b of gs.bullets) {
    live.add(b.id);
    if (!bulletTrails[b.id]) bulletTrails[b.id] = [];
    const t = bulletTrails[b.id];
    t.push({x: b.x, y: b.y, w: b.w, h: b.h, owner: b.owner});
    if (t.length > BULLET_TRAIL_LEN) t.shift();
  }
  for (const id of Object.keys(bulletTrails)) {
    if (!live.has(+id)) delete bulletTrails[id];
  }
}

function drawBulletTrails(ctx) {
  for (const trail of Object.values(bulletTrails)) {
    for (let i = 0; i < trail.length - 1; i++) {
      const t = trail[i];
      const alpha = ((i + 1) / trail.length) * 0.4;
      const col = t.owner === 'regular' ? '#0ff' : t.owner === 'invader' ? '#f80' : '#f33';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 5;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.restore();
    }
  }
}

// UFO trail
const ufoTrail = [];
const UFO_TRAIL_LEN = 12;

function updateUFOTrail() {
  if (gs.ufo) {
    ufoTrail.push({x: gs.ufo.x, y: gs.ufo.y, w: gs.ufo.w, h: gs.ufo.h, animal: gs.ufo.animal || 0});
    if (ufoTrail.length > UFO_TRAIL_LEN) ufoTrail.shift();
  } else {
    ufoTrail.length = 0;
  }
}

function drawUFOTrail(ctx) {
  for (let i = 0; i < ufoTrail.length - 1; i++) {
    const t = ufoTrail[i];
    const alpha = ((i + 1) / ufoTrail.length) * 0.22;
    const col = ANIMAL_COLORS[t.animal % 6];
    const spr = ANIMAL_SPR[t.animal % 6];
    const rows = spr.length, cols = spr[0].length;
    const pw = t.w / cols, ph = t.h / rows;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (spr[r][c])
          ctx.fillRect(Math.round(t.x + c*pw), Math.round(t.y + r*ph),
                       Math.max(1, Math.floor(pw)), Math.max(1, Math.floor(ph)));
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════
// CRT overlay effect (Shift+C)
// Static layers (scanlines, phosphor columns, vignette, tint) are
// pre-rendered once to an offscreen canvas and composited as a single
// drawImage each frame. Only the moving scan-flicker line is dynamic.
// ═══════════════════════════════════════════════════════════
let crtOverlay = null; // offscreen canvas, built once on first use

function buildCRTOverlay(cw, ch) {
  const oc = document.createElement('canvas');
  oc.width = cw; oc.height = ch;
  const octx = oc.getContext('2d');

  // Scanlines
  octx.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < ch; y += 3) octx.fillRect(0, y, cw, 1);

  // Phosphor dot columns
  octx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = 0; x < cw; x += 3) octx.fillRect(x + 2, 0, 1, ch);

  // Vignette
  const vig = octx.createRadialGradient(cw/2, ch/2, ch*0.28, cw/2, ch/2, ch*0.82);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.78)');
  octx.fillStyle = vig;
  octx.fillRect(0, 0, cw, ch);

  // Phosphor tint
  octx.fillStyle = 'rgba(40,255,80,0.03)';
  octx.fillRect(0, 0, cw, ch);

  return oc;
}

function drawCRT(ctx) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  if (!crtOverlay) crtOverlay = buildCRTOverlay(cw, ch);

  ctx.save();
  ctx.drawImage(crtOverlay, 0, 0);

  // Dynamic scan-flicker line
  const scanY = (Date.now() / 18) % ch;
  const scanGrad = ctx.createLinearGradient(0, scanY - 6, 0, scanY + 6);
  scanGrad.addColorStop(0,   'rgba(255,255,255,0)');
  scanGrad.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  scanGrad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = scanGrad;
  ctx.fillRect(0, scanY - 6, cw, 12);

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Player trails — ring buffer of recent positions per player
// ═══════════════════════════════════════════════════════════
const TRAIL_LEN       = 8;
const TRAIL_LEN_SPEED = 24; // longer trail when speed-boosted
const playerTrails = {}; // id → [{cx, cy, team, isSelf, powerSpeed}, ...]

function updateTrails() {
  for (const p of gs.players) {
    if (p.explodeTick > 0) { delete playerTrails[p.id]; continue; }
    if (!playerTrails[p.id]) playerTrails[p.id] = [];
    const trail = playerTrails[p.id];
    trail.push({cx: p.x + p.w/2, cy: p.y + p.h/2, w: p.w, h: p.h,
                team: p.team, isSelf: p.id === gs.myId, powerSpeed: p.powerSpeed || 0});
    const maxLen = (p.powerSpeed > 0) ? TRAIL_LEN_SPEED : TRAIL_LEN;
    if (trail.length > maxLen) trail.splice(0, trail.length - maxLen);
  }
  // Remove trails for disconnected players
  for (const id of Object.keys(playerTrails)) {
    if (!gs.players.find(p => p.id === id)) delete playerTrails[id];
  }
}

function drawTrails(ctx) {
  for (const [id, trail] of Object.entries(playerTrails)) {
    // Check if the latest entry has speed boost
    const latestSpeed = trail.length > 0 ? trail[trail.length-1].powerSpeed : 0;
    for (let i = 0; i < trail.length - 1; i++) {
      const t = trail[i];
      const frac = (i + 1) / trail.length;
      ctx.save();
      if (latestSpeed > 0) {
        // Bright electric speed trail
        const alpha = frac * 0.42;
        ctx.globalAlpha = alpha;
        const faceDown = t.team === 'invader';
        // Alternate cyan/white for electric shimmer
        const col = (i % 3 === 0) ? '#fff' : '#0ff';
        drawShip(ctx, t.cx, t.cy, t.w, t.h, col, col, col, faceDown);
      } else {
        const alpha = frac * 0.13;
        ctx.globalAlpha = alpha;
        const faceDown = t.team === 'invader';
        const body = t.isSelf ? (faceDown ? '#f84' : '#8ef') : (faceDown ? '#c33' : '#5a8');
        drawShip(ctx, t.cx, t.cy, t.w, t.h, body, body, body, faceDown);
      }
      ctx.restore();
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Master render
// ═══════════════════════════════════════════════════════════
function render(ctx) {
  ctx.clearRect(0, 0, W, H);
  tickBeatPhase();
  drawBackground(ctx);
  updateStars();
  drawStars(ctx);
  drawGround(ctx);
  drawHUD(ctx);

  syncEnemyDeaths();
  tickEnemyBlasts();

  if (gs.gameOver) { drawGameOver(ctx); return; }

  // Shields
  drawShields(ctx);

  // Power-ups (behind enemies)
  drawPowerups(ctx);

  // Enemy death blasts (behind live enemies)
  drawEnemyBlasts(ctx);

  // Enemies
  for (const e of gs.enemies) drawEnemy(ctx, e);

  // UFO trail + UFO + explosion particles
  updateUFOTrail();
  drawUFOTrail(ctx);
  if (gs.ufo) drawUFO(ctx, gs.ufo);
  tickUFOParticles(ctx);
  tickBombParticles(ctx);

  // Bullets — trails then sprites
  updateBulletTrails();
  drawBulletTrails(ctx);
  for (const b of gs.bullets) {
    if (b.owner === 'regular' && b.id > (render._lastBulletId||0)) {
      playFireSound();
      render._lastBulletId = b.id;
    }
    drawBullet(ctx, b);
  }

  // Players — trails then sprites
  updateTrails();
  drawTrails(ctx);
  const nowExploding = new Set();
  for (const p of gs.players) {
    if (p.explodeTick > 0) {
      nowExploding.add(p.id);
      if (!explodingSet.has(p.id)) playExplosionSound();
    } else if (prevPlayerHealth[p.id] !== undefined && p.health < prevPlayerHealth[p.id]) {
      playPlayerHitSound();
    }
    prevPlayerHealth[p.id] = p.health;
    drawPlayer(ctx, p);
  }
  explodingSet.clear();
  for (const id of nowExploding) explodingSet.add(id);

  // Leaderboard (HTML panel)
  updateLeaderboard();

  // Power-up bar (bottom)
  drawPowerBar(ctx);

  // Team-change toast
  drawBigToast(ctx);

  // Join/leave toasts
  drawToasts(ctx);

  // Debug track indicator (only after m/M pressed)
  if (debugModeActive) {
    const trackNum = (gs.wave || 1) + debugWaveOffset;
    const ks = trackNum <= 10 ? 0 : (trackNum - 10) % 12;
    const keyName = KEY_NAMES[ks];
    ctx.save();
    ctx.font = '11px "Courier New",monospace';
    ctx.fillStyle = '#404040';
    ctx.textAlign = 'left';
    ctx.fillText(`TRACK ${trackNum}  ${keyName}`, 8, H - 6);
    ctx.restore();
  }

  // CRT overlay (Shift+C)
  if (crtMode) drawCRT(ctx);
}

// Start the game — called here because render.js is the last script to load,
// guaranteeing render() and all other globals are defined before the first rAF.
connect();
requestAnimationFrame(gameLoop);
