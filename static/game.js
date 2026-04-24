'use strict';

// ═══════════════════════════════════════════════════════════
// Constants (mirror server)
// ═══════════════════════════════════════════════════════════
const W = 900, H = 650;
const PW = 48, PH = 36;
const EW = 36, EH = 24;
const BOMB_DURATION    = 120; // ticks — must match game.go BombDuration
const POWERUP_DURATION = 450; // ticks — must match game.go PowerupDuration
const TICKS_PER_SEC    = 30;  // must match game.go TicksPerSecond

// ═══════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════
const gs = {
  myId: null, myName: null, myTeam: 'regular',
  connected: false,
  tick: 0, wave: 1,
  players: [], enemies: [], bullets: [], shields: [], powerups: [], ufo: null,
  leaderboard: [], gameOver: false,
};

// Shared animal data (used by audio.js and render.js)
const ANIMAL_COLORS = ['#f94','#fff','#ff0','#48f','#111','#3d3'];
const ANIMAL_NAMES  = ['CAT','RABBIT','DUCK','FISH','PENGUIN','FROG'];

// ═══════════════════════════════════════════════════════════
// Stars (drift slowly)
// ═══════════════════════════════════════════════════════════
const STARS = Array.from({length:120}, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  r: Math.random() * 1.4 + 0.3,
  b: Math.random() * 0.5 + 0.4,
  vy: Math.random() * 0.12 + 0.04, // drift speed px/frame
}));

function updateStars() {
  for (const s of STARS) {
    s.y += s.vy;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
  }
}

function drawStars(ctx) {
  for (const s of STARS) {
    ctx.fillStyle = `rgba(255,255,255,${s.b})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
    ctx.fill();
  }
}

// ═══════════════════════════════════════════════════════════
// Shifting space background
// ═══════════════════════════════════════════════════════════
let bgPhase = 0;

function drawBackground(ctx) {
  bgPhase += 0.0018;

  // Base sky color drifts very slowly through deep space hues
  const rBase = Math.round(2  + 3  * Math.sin(bgPhase));
  const gBase = Math.round(2  + 4  * Math.sin(bgPhase * 0.7 + 1.0));
  const bBase = Math.round(10 + 9  * Math.sin(bgPhase * 0.5 + 0.4));
  ctx.fillStyle = `rgb(${rBase},${gBase},${bBase})`;
  ctx.fillRect(0, 0, W, H);

  // Nebula blob 1 — drifts slowly, blue/purple range
  const cx1 = W * 0.45 + Math.sin(bgPhase * 0.6)       * W * 0.22;
  const cy1 = H * 0.40 + Math.cos(bgPhase * 0.4 + 0.8) * H * 0.18;
  const hue1 = 220 + 70 * Math.sin(bgPhase * 0.9);      // 150–290 blue→purple
  const g1 = ctx.createRadialGradient(cx1, cy1, 0, cx1, cy1, W * 0.62);
  g1.addColorStop(0,   `hsla(${hue1},65%,9%,0.55)`);
  g1.addColorStop(0.55,`hsla(${hue1},50%,5%,0.18)`);
  g1.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  // Nebula blob 2 — offset phase, teal/indigo range
  const cx2 = W * 0.65 + Math.cos(bgPhase * 0.5 + 1.2) * W * 0.25;
  const cy2 = H * 0.30 + Math.sin(bgPhase * 0.35 + 2.1) * H * 0.22;
  const hue2 = 185 + 55 * Math.cos(bgPhase * 0.8 + 1.5); // 130–240 teal→blue
  const g2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, W * 0.45);
  g2.addColorStop(0,   `hsla(${hue2},70%,8%,0.45)`);
  g2.addColorStop(0.6, `hsla(${hue2},55%,4%,0.12)`);
  g2.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // Nebula blob 3 — deep crimson / dark ruby range
  const cx3 = W * 0.25 + Math.sin(bgPhase * 0.3 + 2.4) * W * 0.28;
  const cy3 = H * 0.65 + Math.cos(bgPhase * 0.45 + 0.3) * H * 0.20;
  const hue3 = 340 + 25 * Math.sin(bgPhase * 0.6 + 3.1);  // 315–5 ruby→crimson
  const g3 = ctx.createRadialGradient(cx3, cy3, 0, cx3, cy3, W * 0.40);
  g3.addColorStop(0,   `hsla(${hue3},60%,8%,0.40)`);
  g3.addColorStop(0.5, `hsla(${hue3},45%,4%,0.12)`);
  g3.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, W, H);

  // Nebula blob 4 — dark emerald / forest range
  const cx4 = W * 0.80 + Math.cos(bgPhase * 0.38 + 1.7) * W * 0.18;
  const cy4 = H * 0.72 + Math.sin(bgPhase * 0.28 + 4.0) * H * 0.16;
  const hue4 = 130 + 30 * Math.cos(bgPhase * 0.52 + 2.8); // 100–160 emerald→teal
  const g4 = ctx.createRadialGradient(cx4, cy4, 0, cx4, cy4, W * 0.35);
  g4.addColorStop(0,   `hsla(${hue4},55%,7%,0.35)`);
  g4.addColorStop(0.55,`hsla(${hue4},40%,4%,0.10)`);
  g4.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g4;
  ctx.fillRect(0, 0, W, H);

  // Vignette — dark edges to frame the play area
  const vg = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, W*0.75);
  vg.addColorStop(0,   'rgba(0,0,0,0)');
  vg.addColorStop(1,   'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ═══════════════════════════════════════════════════════════
// Input
// ═══════════════════════════════════════════════════════════
const keys = {ArrowLeft:false, ArrowRight:false, ArrowUp:false, ArrowDown:false, Space:false};
let debugWaveOffset = 0;  // secret 'm' key bumps apparent wave for music debugging
let debugModeActive   = false; // becomes true once m/M pressed — shows track display
let crtMode = false;
document.addEventListener('keydown', e => {
  if (e.code in keys) { keys[e.code]=true; e.preventDefault(); }
  if (e.key === 'm') { debugWaveOffset++; debugModeActive = true; }
  if (e.key === 'M') { debugWaveOffset = 0; debugModeActive = true; } // Shift+M resets
  if (e.key === 'W') { sendNextWave(); }   // Shift+W advances wave
  if (e.key === 'b' || e.key === 'B') { sendSwapTeam(); }
  if (e.key === 'C') { // Shift+C toggles CRT effect
    crtMode = !crtMode;
    const c = document.getElementById('game');
    if (crtMode) {
      c.style.borderRadius = '42% / 5%';
      c.style.filter = 'brightness(0.88) contrast(1.15) saturate(1.1)';
      c.style.boxShadow = '0 0 60px 8px rgba(80,255,120,0.18), inset 0 0 80px rgba(0,0,0,0.5)';
    } else {
      c.style.borderRadius = '';
      c.style.filter = '';
      c.style.boxShadow = '';
    }
  }
  initAudio(); // user gesture — safe to start AudioContext here
});
document.addEventListener('keyup', e => {
  if (e.code in keys) { keys[e.code]=false; }
});
// Also handle click/touch for users who haven't pressed a key yet
document.addEventListener('click',      () => initAudio(), {once: true});
document.addEventListener('touchstart', () => initAudio(), {once: true});

// Mobile touch control buttons
(function setupTouchControls() {
  function bindBtn(id, keyCode) {
    const el = document.getElementById(id);
    if (!el) return;
    const press   = e => { e.preventDefault(); keys[keyCode] = true;  initAudio(); };
    const release = e => { e.preventDefault(); keys[keyCode] = false; };
    el.addEventListener('touchstart',  press,   {passive:false});
    el.addEventListener('touchend',    release, {passive:false});
    el.addEventListener('touchcancel', release, {passive:false});
    // Also mouse for desktop testing
    el.addEventListener('mousedown', press);
    el.addEventListener('mouseup',   release);
    el.addEventListener('mouseleave',release);
  }
  bindBtn('tc-left',  'ArrowLeft');
  bindBtn('tc-right', 'ArrowRight');
  bindBtn('tc-fire',  'Space');
})();

// ═══════════════════════════════════════════════════════════
// WebSocket
// ═══════════════════════════════════════════════════════════
let ws = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen  = () => { gs.connected = true; setStatus('Connected'); };
  ws.onclose = () => {
    gs.connected = false;
    setStatus('Disconnected — reconnecting…');
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = ({data}) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'welcome') {
      gs.myId = m.id; gs.myName = m.name; gs.myTeam = m.team || 'regular';
      setStatus(`Playing as: ${m.name} [${gs.myTeam}]`);
      const ld = document.getElementById('loading');
      if (ld) { ld.classList.add('hide'); setTimeout(() => ld.remove(), 550); }
      document.getElementById('invader-hint').style.display =
        gs.myTeam === 'invader' ? 'inline' : 'none';
    } else if (m.type === 'announce') {
      addToast(m.msg, m.kind === 'join' ? '#0f8' : '#f84');
    } else if (m.type === 'state') {
      const s = m.state;
      const prevTeam = gs.myTeam;
      const prevWave = gs.wave;
      const prevGameOver = gs.gameOver;
      gs.tick = s.tick; gs.wave = s.wave;
      gs.players = s.players || []; gs.enemies = s.enemies || [];
      gs.bullets = s.bullets || []; gs.shields = s.shields || [];
      gs.powerups = s.powerups || [];
      gs.ufo = s.ufo || null; gs.leaderboard = s.leaderboard || [];
      gs.gameOver = s.gameOver || false;
      // UFO killed — trigger particle explosion
      if (s.ufoKill)  spawnUFOExplosion(s.ufoKill);
      if (s.bombKill) spawnBombExplosion(s.bombKill);
      // Game over transition — play sad melody
      if (!prevGameOver && gs.gameOver) playGameOverMelody();
      // Game reset — restart music from beginning
      if (prevGameOver && !gs.gameOver) resetMusicSequencer();
      // Detect team change
      if (gs.myId) {
        const me = gs.players.find(p => p.id === gs.myId);
        if (me && me.team !== prevTeam) {
          gs.myTeam = me.team;
          document.getElementById('invader-hint').style.display = me.team === 'invader' ? 'inline' : 'none';
          if (me.team === 'invader') {
            addBigToast('YOU ARE NOW THE ENEMY', '#f44', 'Shoot the players!  ↑ ↓ ← → to move');
          } else {
            addBigToast('YOU ARE ON THE SIDE OF GOOD', '#0f8', 'Defend against the invaders!');
          }
        }
      }
      // Wave-change toast
      if (prevWave && s.wave > prevWave && !s.gameOver) {
        addBigToast(`— WAVE ${s.wave} —`, '#ff0', 'Good luck!', 0.45);
      }
      // Wave reset without game over (e.g. debug skip back)
      if (prevWave && prevWave > 1 && s.wave === 1 && !prevGameOver) {
        resetMusicSequencer();
      }
      // Sync music tempo to wave
      updateMusicTempo();
    }
  };
}

function sendInput() {
  if (!gs.connected || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type:'input',
    left:keys.ArrowLeft, right:keys.ArrowRight,
    up:keys.ArrowUp, down:keys.ArrowDown,
    shoot:keys.Space,
  }));
}

function sendRestart() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'restart'}));
}
function sendSwapTeam() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'swap'}));
}
function sendNextWave() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'nextwave'}));
}

function setStatus(t) { document.getElementById('status').textContent = t; }

// ═══════════════════════════════════════════════════════════
// Leaderboard — HTML panel outside canvas
// ═══════════════════════════════════════════════════════════
let lbLastHash = '';
function updateLeaderboard() {
  const entries = gs.leaderboard || [];
  const hash = entries.map(e=>`${e.name}:${e.score}`).join('|');
  if (hash === lbLastHash) return;
  lbLastHash = hash;
  const ul = document.getElementById('lb-entries');
  if (!entries.length) {
    ul.innerHTML = '<li style="color:#333;font-size:10px;text-align:center;border:none">no scores yet</li>';
    return;
  }
  ul.innerHTML = entries.slice(0,10).map((e,i) =>
    `<li class="${e.name===gs.myName?'me':''}"><span>${i+1}. ${e.name.slice(0,9)}</span><span>${e.score}</span></li>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════
// Big team-change toast
// ═══════════════════════════════════════════════════════════
let bigToast = null;
function addBigToast(title, color, sub, maxAlpha = 1.0) {
  const total = 180;
  bigToast = {title, color, sub, tick: total, total, maxAlpha}; // 6 seconds
}
function drawBigToast(ctx) {
  if (!bigToast || bigToast.tick <= 0) return;
  const FADE_IN = 22, FADE_OUT = 35;
  const elapsed = bigToast.total - bigToast.tick;
  const fadeInFrac  = elapsed  < FADE_IN  ? elapsed  / FADE_IN  : 1;
  const fadeOutFrac = bigToast.tick < FADE_OUT ? bigToast.tick / FADE_OUT : 1;
  const alpha = bigToast.maxAlpha * Math.min(fadeInFrac, fadeOutFrac);
  const cy = H * 0.38;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(W*0.1, cy - 38, W*0.8, 64);
  ctx.strokeStyle = bigToast.color;
  ctx.lineWidth = 2;
  ctx.strokeRect(W*0.1, cy - 38, W*0.8, 64);

  ctx.shadowColor = bigToast.color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = bigToast.color;
  ctx.font = 'bold 22px "Courier New",monospace';
  ctx.textAlign = 'center';
  ctx.fillText(bigToast.title, W/2, cy - 8);
  ctx.shadowBlur = 0;

  ctx.font = '11px "Courier New",monospace';
  ctx.fillStyle = '#ccc';
  ctx.fillText(bigToast.sub, W/2, cy + 16);
  ctx.globalAlpha = 1;
  ctx.restore();
  bigToast.tick--;
}

// ═══════════════════════════════════════════════════════════
// Toast notifications (join/leave)
// ═══════════════════════════════════════════════════════════
const toasts = [];
function addToast(msg, color) {
  toasts.push({msg, color, tick: 90}); // ~3s at 30fps
  if (toasts.length > 5) toasts.shift();
}
function drawToasts(ctx) {
  ctx.save();
  for (let i = 0; i < toasts.length; i++) {
    const t = toasts[i];
    if (t.tick <= 0) continue;
    const alpha = Math.min(1, t.tick / 20);
    const y = H - 30 - i * 20;
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font = 'bold 12px "Courier New",monospace';
    const tw = ctx.measureText(t.msg).width;
    ctx.fillRect(W/2 - tw/2 - 8, y - 13, tw + 16, 18);
    ctx.fillStyle = t.color;
    ctx.textAlign = 'center';
    ctx.fillText(t.msg, W/2, y);
    t.tick--;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Game loop
// ═══════════════════════════════════════════════════════════
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');

let lastSend = 0;
function gameLoop(ts) {
  if (ts - lastSend >= 16) { sendInput(); lastSend = ts; }
  render(ctx);
  requestAnimationFrame(gameLoop);
}

// Startup is deferred to render.js (last script) so render() is defined first.
