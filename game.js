'use strict';

// ============================================================
//  MUNCH CATCH — Healthy vs Junk Food Falling Objects Game
//  Computer Graphics Final Project
// ============================================================

// ============================================================
// CG CONCEPT: roundRect Polyfill
// Ensures ctx.roundRect() works in all browsers, even those
// that do not yet support the native Canvas API method.
// ============================================================
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y,     x + w, y + h, r);
    this.arcTo(x + w, y + h, x,     y + h, r);
    this.arcTo(x,     y + h, x,     y,     r);
    this.arcTo(x,     y,     x + w, y,     r);
    this.closePath();
  };
}

// ============================================================
// CG CONCEPT: HTML5 Canvas Setup
// The Canvas element provides a 2D bitmap drawing surface.
// The 2D rendering context (ctx) exposes the drawing API
// used for all game graphics — no DOM elements are used for
// rendering game objects.
// ============================================================
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

let W, H; // live canvas dimensions (updated on resize)

// ============================================================
// CG CONCEPT: Responsive Canvas / Window Resize
// The canvas dynamically resizes to fill the available window
// while maintaining a fixed 2:3 (portrait) aspect ratio.
// All game coordinates and sizes are expressed as fractions
// of W or H so they scale correctly at any resolution.
// ============================================================
function resizeCanvas() {
  const RATIO = 2 / 3; // width / height
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (w / h > RATIO) { w = Math.floor(h * RATIO); }
  else               { h = Math.floor(w / RATIO); }
  W = Math.min(w, 480);
  H = Math.min(h, 720);
  canvas.width  = W;
  canvas.height = H;
  if (basket) basket.reset();
}
window.addEventListener('resize', resizeCanvas);

// ============================================================
// CONFIGURATION
// ============================================================
const CFG = {
  BASE_FALL_SPEED:   100,    // px/s
  BASE_SPAWN_MS:     2200,   // ms between spawns
  SPEED_MULT:        1.15,   // speed multiplier per level
  SPAWN_MULT:        0.90,   // spawn interval multiplier per level
  LEVEL_DURATION_MS: 30000,  // ms per difficulty level
  MAX_LIVES:         3,
  HEALTHY_PTS:       10,
  COMBO_BONUS_PTS:   5,
  COMBO_THRESHOLD:   3,      // catch streak needed for combo bonus
  FOOD_RATIO:        0.095,  // food half-size as fraction of W
  BASKET_W_RATIO:    0.22,
  BASKET_H_RATIO:    0.055,
  BASKET_SPD_RATIO:  0.73,   // W per second
  SCORE_THRESHOLDS:  [100, 250, 500, 1000],
  PARTICLE_COUNT:    14,
};

// ============================================================
// FOOD TYPE REGISTRY
// Healthy foods award points; junk foods cost a life.
// baseColor is used for particle effects on catch.
// ============================================================
const FOOD_DATA = {
  apple:      { healthy: true,  color: '#e74c3c', label: 'Apple'      },
  broccoli:   { healthy: true,  color: '#27ae60', label: 'Broccoli'   },
  carrot:     { healthy: true,  color: '#e67e22', label: 'Carrot'     },
  banana:     { healthy: true,  color: '#f1c40f', label: 'Banana'     },
  watermelon: { healthy: true,  color: '#c0392b', label: 'Watermelon' },
  burger:     { healthy: false, color: '#d35400', label: 'Burger'     },
  fries:      { healthy: false, color: '#f39c12', label: 'Fries'      },
  soda:       { healthy: false, color: '#8e44ad', label: 'Soda'       },
  donut:      { healthy: false, color: '#e91e8c', label: 'Donut'      },
  candy:      { healthy: false, color: '#e74c3c', label: 'Candy'      },
};
const HEALTHY = Object.keys(FOOD_DATA).filter(k =>  FOOD_DATA[k].healthy);
const JUNK    = Object.keys(FOOD_DATA).filter(k => !FOOD_DATA[k].healthy);

// ============================================================
// CG CONCEPT: Procedural Audio Synthesis (Web Audio API)
// All sound effects are synthesized at runtime using the
// Web Audio API — no external .mp3 or .wav files are loaded.
// OscillatorNode generates waveforms; GainNode controls volume
// and creates fade-out envelopes. The AudioContext is created
// lazily on the first user interaction to comply with browsers'
// autoplay policies.
// ============================================================
const SoundManager = {
  actx: null,
  muted: localStorage.getItem('munchcatch_mute') === '1',

  init() {
    if (this.actx) {
      // Resume if suspended (browser autoplay policy)
      if (this.actx.state === 'suspended') this.actx.resume();
      return;
    }
    this.actx = new (window.AudioContext || window.webkitAudioContext)();
  },

  // Internal helper — plays a single tone with exponential fade-out.
  _tone(freq, type, duration, gainPeak, startDelay = 0) {
    if (this.muted || !this.actx) return;
    const now  = this.actx.currentTime + startDelay;
    const osc  = this.actx.createOscillator();
    const gain = this.actx.createGain();
    osc.connect(gain);
    gain.connect(this.actx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  },

  // Short high-pitched ding — played on healthy food catch.
  playCollect() {
    this.init();
    this._tone(880, 'sine', 0.20, 0.28);
    this._tone(1320, 'sine', 0.10, 0.12, 0.05);
  },

  // Low buzz/thud — played on junk food catch OR missed healthy food.
  playHurt() {
    this.init();
    this._tone(110, 'square', 0.25, 0.30);
    this._tone(80,  'sawtooth', 0.18, 0.18, 0.04);
  },

  // Ascending three-note chime — played when a combo triggers.
  playCombo() {
    this.init();
    [523, 659, 880].forEach((freq, i) => this._tone(freq, 'sine', 0.18, 0.22, i * 0.09));
  },

  // Ascending arpeggio — played on level up.
  playLevelUp() {
    this.init();
    [392, 523, 659, 784, 1047].forEach((freq, i) => this._tone(freq, 'sine', 0.14, 0.20, i * 0.08));
  },

  // Descending sad tones — played on game over.
  playGameOver() {
    this.init();
    [440, 370, 294, 220].forEach((freq, i) => this._tone(freq, 'sine', 0.28, 0.22, i * 0.18));
  },

  // Soft pop — played on game start / button click.
  playClick() {
    this.init();
    this._tone(660, 'sine', 0.08, 0.20);
    this._tone(880, 'sine', 0.06, 0.12, 0.06);
  },

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('munchcatch_mute', this.muted ? '1' : '0');
  },
};

// ============================================================
// GAME STATES
// ============================================================
const S = { START: 'START', PLAYING: 'PLAYING', PAUSED: 'PAUSED', OVER: 'OVER' };

// ============================================================
// GAME STATE VARIABLES
// ============================================================
let state     = S.START;
let score     = 0;
let highScore = parseInt(localStorage.getItem('munchcatch_hs') || '0', 10);
let lives     = CFG.MAX_LIVES;
let level     = 1;
let combo     = 0;
let gameMs    = 0;
let levelMs   = 0;
let fallSpeed = CFG.BASE_FALL_SPEED;
let spawnMs   = CFG.BASE_SPAWN_MS;
let spawnTimer    = 0;
let triggeredMilestones = new Set();

// ============================================================
// VISUAL EFFECTS STATE
// ============================================================
let shakeAmt  = 0;    // pixels of shake displacement
let shakeDur  = 0;    // seconds remaining
let glowTimer = 0;    // score glow duration
let bgHue     = 210;  // current background hue (shifts with level)
let fadeAlpha = 1;    // screen fade overlay (1=black, 0=clear)
let lvlUpText  = '';
let lvlUpTimer = 0;   // counts down from 2.0
let bottomFlashTimer = 0; // red flash at bottom when healthy food missed
let muteBtn = { x: 0, y: 0, w: 0, h: 0 }; // mute button bounds for click detection

// ============================================================
// ENTITY ARRAYS
// ============================================================
let objects    = [];  // FallObj[]
let particles  = [];  // Particle[]
let floatTexts = [];  // FloatText[]
let bgClouds   = [];  // far parallax layer
let bgNear     = [];  // near parallax layer

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function lerp(a, b, t)    { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function rnd(a, b)        { return a + Math.random() * (b - a); }
function rndEl(arr)       { return arr[Math.floor(rnd(0, arr.length))]; }

// ============================================================
// CG CONCEPT: Parallax Scrolling Background
// Two independent layers of background shapes move at
// different speeds to simulate depth (parallax effect).
// The far layer (clouds) moves slowly; the near layer
// moves faster, giving an illusion of 3D space on a 2D canvas.
// ============================================================
function initBg() {
  bgClouds = [];
  bgNear   = [];
  for (let i = 0; i < 5; i++) {
    bgClouds.push({ x: rnd(0, W), y: rnd(H * 0.06, H * 0.38), w: rnd(55, 105), spd: rnd(12, 22) });
  }
  for (let i = 0; i < 4; i++) {
    bgNear.push({ x: rnd(0, W), y: rnd(H * 0.62, H * 0.84), r: rnd(18, 40), spd: rnd(32, 52) });
  }
}

function updateBg(dt) {
  // ============================================================
  // CG CONCEPT: 2D Translation — Parallax Layer Movement
  // Each background layer translates along the X axis at a
  // different speed each frame, wrapping when off-screen.
  // This is a direct application of 2D translation transforms.
  // ============================================================
  bgClouds.forEach(c => { c.x += c.spd * dt; if (c.x > W + c.w)       c.x = -c.w; });
  bgNear.forEach(n   => { n.x -= n.spd * dt; if (n.x < -(n.r * 2))    n.x = W + n.r; });
}

function drawBg() {
  // ============================================================
  // CG CONCEPT: Dynamic Background Gradient
  // The sky hue lerps toward a warmer/darker tone as the
  // difficulty level increases, giving players a visual cue
  // that time is passing and the game is getting harder.
  // ctx.createLinearGradient() creates a gradient stop array
  // that the GPU blends across the canvas rectangle.
  // ============================================================
  const targetHue = 210 - (level - 1) * 20;
  bgHue = lerp(bgHue, targetHue, 0.006);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,   `hsl(${bgHue},      65%, 42%)`);
  sky.addColorStop(0.55,`hsl(${bgHue + 15}, 55%, 60%)`);
  sky.addColorStop(1,   `hsl(${bgHue + 30}, 45%, 74%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth   = 1;
  for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Far parallax clouds
  bgClouds.forEach(c => {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c.x,                c.y,            c.w * 0.30, 0, Math.PI * 2);
    ctx.arc(c.x + c.w * 0.28,  c.y - c.w * 0.1,c.w * 0.24, 0, Math.PI * 2);
    ctx.arc(c.x + c.w * 0.52,  c.y,            c.w * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Near parallax shapes
  bgNear.forEach(n => {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Ground strip
  const gnd = ctx.createLinearGradient(0, H - 55, 0, H);
  gnd.addColorStop(0, `hsl(${bgHue - 50}, 42%, 38%)`);
  gnd.addColorStop(1, `hsl(${bgHue - 65}, 36%, 26%)`);
  ctx.fillStyle = gnd;
  ctx.fillRect(0, H - 55, W, 55);
}

// ============================================================
// CG CONCEPT: Procedural Shape Rendering
// All ten food items are drawn entirely using Canvas 2D path
// commands (moveTo, lineTo, arc, bezierCurveTo, ellipse,
// arcTo, quadraticCurveTo) and fill/stroke operations.
// No external image files are loaded.  Each function draws
// its food centered at the local origin (0, 0); the caller
// applies translation and rotation via the matrix stack.
// The parameter s is the food's half-size in pixels.
// ============================================================
const FOOD_DRAWERS = {

  // ----------------------------------------------------------
  // APPLE (healthy)
  // ----------------------------------------------------------
  apple(ctx, s) {
    // Body
    ctx.beginPath();
    ctx.arc(0, s * 0.05, s * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = s * 0.05;
    ctx.stroke();
    // Top indent
    ctx.beginPath();
    ctx.arc(0, -s * 0.36, s * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
    // Highlight
    ctx.beginPath();
    ctx.arc(-s * 0.14, -s * 0.07, s * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.fill();
    // Stem
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.37);
    ctx.quadraticCurveTo(s * 0.12, -s * 0.66, s * 0.06, -s * 0.60);
    ctx.strokeStyle = '#6d4c41';
    ctx.lineWidth   = s * 0.09;
    ctx.lineCap     = 'round';
    ctx.stroke();
    // Leaf
    ctx.beginPath();
    ctx.moveTo(s * 0.03, -s * 0.48);
    ctx.bezierCurveTo(s * 0.26, -s * 0.74, s * 0.30, -s * 0.44, s * 0.06, -s * 0.43);
    ctx.fillStyle = '#27ae60';
    ctx.fill();
  },

  // ----------------------------------------------------------
  // BROCCOLI (healthy)
  // ----------------------------------------------------------
  broccoli(ctx, s) {
    // Stem
    ctx.fillStyle = '#5d8a3c';
    ctx.beginPath();
    ctx.roundRect(-s * 0.11, s * 0.04, s * 0.22, s * 0.44, s * 0.04);
    ctx.fill();
    // Floret clusters
    const florets = [
      [0,        -s * 0.22, s * 0.24, '#2ecc71'],
      [-s * 0.25,-s * 0.04, s * 0.20, '#27ae60'],
      [ s * 0.25,-s * 0.04, s * 0.20, '#27ae60'],
      [-s * 0.10, s * 0.04, s * 0.15, '#2ecc71'],
      [ s * 0.10, s * 0.04, s * 0.15, '#2ecc71'],
    ];
    florets.forEach(([fx, fy, fr, fc]) => {
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fillStyle = fc;
      ctx.fill();
      ctx.strokeStyle = '#1e8449';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    // Highlight dots on top floret
    [[-0.05, -0.30],[0.05, -0.32],[0, -0.38]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.arc(dx * s, dy * s, s * 0.042, 0, Math.PI * 2);
      ctx.fillStyle = '#58d68d';
      ctx.fill();
    });
  },

  // ----------------------------------------------------------
  // CARROT (healthy)
  // ----------------------------------------------------------
  carrot(ctx, s) {
    // Orange tapered body
    ctx.beginPath();
    ctx.moveTo(-s * 0.20, -s * 0.28);
    ctx.lineTo( s * 0.20, -s * 0.28);
    ctx.bezierCurveTo( s * 0.20,  s * 0.28,  s * 0.06,  s * 0.50, 0,  s * 0.52);
    ctx.bezierCurveTo(-s * 0.06,  s * 0.50, -s * 0.20,  s * 0.28, -s * 0.20, -s * 0.28);
    ctx.fillStyle = '#e67e22';
    ctx.fill();
    ctx.strokeStyle = '#ca6f1e';
    ctx.lineWidth = s * 0.04;
    ctx.stroke();
    // Texture rings
    ctx.strokeStyle = 'rgba(200,100,0,0.30)';
    ctx.lineWidth = s * 0.025;
    [-0.12, 0.06, 0.22].forEach(ty => {
      const halfW = s * 0.20 * (1 - (ty + 0.28) / 0.80);
      ctx.beginPath();
      ctx.moveTo(-halfW, ty * s);
      ctx.lineTo( halfW, ty * s);
      ctx.stroke();
    });
    // Green feathery leaves
    ctx.strokeStyle = '#27ae60';
    ctx.lineCap = 'round';
    [[-s*0.10, -s*0.28, -s*0.20, -s*0.66],
     [       0, -s*0.28,         0, -s*0.70],
     [ s*0.10, -s*0.28,  s*0.20, -s*0.66]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath();
      ctx.lineWidth = s * 0.055;
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2 + (x2 - x1) * 0.4, y1 - s * 0.08, x2, y2);
      ctx.stroke();
    });
  },

  // ----------------------------------------------------------
  // BANANA (healthy)
  // ----------------------------------------------------------
  banana(ctx, s) {
    // Outer yellow crescent — drawn with bezier curves
    ctx.beginPath();
    ctx.moveTo(-s * 0.20, s * 0.28);
    ctx.bezierCurveTo(-s * 0.38, -s * 0.08, -s * 0.18, -s * 0.52,  s * 0.06, -s * 0.48);
    ctx.bezierCurveTo( s * 0.34, -s * 0.44,  s * 0.48, -s * 0.04,  s * 0.34,  s * 0.28);
    ctx.bezierCurveTo( s * 0.24,  s * 0.40, -s * 0.10,  s * 0.40, -s * 0.20,  s * 0.28);
    ctx.fillStyle = '#f1c40f';
    ctx.fill();
    ctx.strokeStyle = '#d4ac0d';
    ctx.lineWidth = s * 0.05;
    ctx.stroke();
    // Inner highlight along the curve
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, s * 0.14);
    ctx.bezierCurveTo(-s * 0.18, -s * 0.06, -s * 0.03, -s * 0.36, s * 0.12, -s * 0.34);
    ctx.strokeStyle = 'rgba(255,255,200,0.55)';
    ctx.lineWidth = s * 0.07;
    ctx.lineCap = 'round';
    ctx.stroke();
    // Brown tips
    ctx.fillStyle = '#7d6608';
    ctx.beginPath(); ctx.arc(-s * 0.20,  s * 0.28, s * 0.066, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( s * 0.06, -s * 0.48, s * 0.056, 0, Math.PI * 2); ctx.fill();
  },

  // ----------------------------------------------------------
  // WATERMELON (healthy) — viewed as a round slice cross-section
  // ----------------------------------------------------------
  watermelon(ctx, s) {
    // Green outer rind
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = '#27ae60';
    ctx.fill();
    // White rind ring
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.40, 0, Math.PI * 2);
    ctx.fillStyle = '#f0fff0';
    ctx.fill();
    // Red flesh
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
    // Dark green stripes on rind (fixed angles)
    [0, 0.4, 0.8, 1.2, 1.6].forEach(t => {
      ctx.save();
      ctx.rotate(t * Math.PI);
      ctx.strokeStyle = '#1e8449';
      ctx.lineWidth = s * 0.055;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.46);
      ctx.lineTo(0, -s * 0.40);
      ctx.stroke();
      ctx.restore();
    });
    // Seeds (fixed positions)
    [[-0.18,-0.12, 0.3],[0,-0.22,-0.2],[0.18,-0.12, 0.5],[-0.08,0,-0.1],[0.08,0, 0.4],[0,0.13, 0]].forEach(([sx, sy, angle]) => {
      ctx.save();
      ctx.translate(sx * s, sy * s);
      ctx.rotate(angle);
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.028, s * 0.056, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    // Highlight
    ctx.beginPath();
    ctx.arc(-s * 0.11, -s * 0.11, s * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
  },

  // ----------------------------------------------------------
  // BURGER (junk)
  // ----------------------------------------------------------
  burger(ctx, s) {
    // Bottom bun
    ctx.beginPath();
    ctx.ellipse(0, s * 0.36, s * 0.44, s * 0.13, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d4a84b';
    ctx.fill();
    ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1; ctx.stroke();
    // Patty
    ctx.beginPath();
    ctx.ellipse(0, s * 0.18, s * 0.42, s * 0.10, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#5d2d0a';
    ctx.fill();
    // Cheese
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.roundRect(-s * 0.38, s * 0.06, s * 0.76, s * 0.10, 2);
    ctx.fill();
    // Lettuce (wavy green edge)
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth   = s * 0.085;
    ctx.lineCap     = 'round';
    for (let i = 0; i < 8; i++) {
      const lx = -s * 0.42 + (s * 0.84 / 7) * i;
      ctx.beginPath();
      ctx.moveTo(lx, s * 0.02);
      ctx.lineTo(lx + s * 0.06, -s * 0.06);
      ctx.stroke();
    }
    // Tomato
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.08, s * 0.38, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
    // Top bun dome
    ctx.beginPath();
    ctx.arc(0, -s * 0.20, s * 0.40, Math.PI, 0, false);
    ctx.ellipse(0, -s * 0.20, s * 0.40, s * 0.12, 0, 0, Math.PI, false);
    ctx.fillStyle = '#d4a84b';
    ctx.fill();
    ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1; ctx.stroke();
    // Sesame seeds
    ctx.fillStyle = '#ffe4b5';
    [[-0.14,-0.50,0.4],[0.05,-0.54,-0.3],[0.22,-0.45,0.6],[-0.03,-0.60,0.1]].forEach(([sx,sy,angle]) => {
      ctx.save();
      ctx.translate(sx * s, sy * s);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.036, s * 0.022, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },

  // ----------------------------------------------------------
  // FRIES (junk)
  // ----------------------------------------------------------
  fries(ctx, s) {
    // Fry sticks (drawn first, behind box top)
    const fryXs = [-0.22, -0.11, 0, 0.11, 0.22];
    fryXs.forEach((fx, i) => {
      const fh = (i % 2 === 0) ? 0.56 : 0.46;
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.roundRect(fx * s - s * 0.038, -s * fh, s * 0.076, s * (fh + 0.10), 2);
      ctx.fill();
      ctx.strokeStyle = '#e6b800'; ctx.lineWidth = 1; ctx.stroke();
    });
    // Red container box
    ctx.beginPath();
    ctx.roundRect(-s * 0.30, s * 0.08, s * 0.60, s * 0.44, s * 0.04);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = s * 0.04; ctx.stroke();
    // White arch decoration (McDonald's-style)
    ctx.strokeStyle = 'rgba(255,255,255,0.70)';
    ctx.lineWidth = s * 0.048;
    ctx.beginPath(); ctx.arc(-s * 0.07, s * 0.32, s * 0.17, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.arc( s * 0.07, s * 0.32, s * 0.17, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  },

  // ----------------------------------------------------------
  // SODA (junk)
  // ----------------------------------------------------------
  soda(ctx, s) {
    // Cup body (trapezoid wider at top)
    ctx.beginPath();
    ctx.moveTo(-s * 0.30, -s * 0.14);
    ctx.lineTo( s * 0.30, -s * 0.14);
    ctx.lineTo( s * 0.24,  s * 0.50);
    ctx.lineTo(-s * 0.24,  s * 0.50);
    ctx.closePath();
    ctx.fillStyle = '#ecf0f1';
    ctx.fill();
    ctx.strokeStyle = '#bdc3c7'; ctx.lineWidth = s * 0.04; ctx.stroke();
    // Liquid fill
    ctx.beginPath();
    ctx.moveTo(-s * 0.27, -s * 0.05);
    ctx.lineTo( s * 0.27, -s * 0.05);
    ctx.lineTo( s * 0.22,  s * 0.47);
    ctx.lineTo(-s * 0.22,  s * 0.47);
    ctx.closePath();
    ctx.fillStyle = '#4a235a';
    ctx.fill();
    // Bubbles in liquid
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    [[-0.10,0.14],[0.05,0.27],[-0.05,0.38],[0.14,0.09],[0,0.22]].forEach(([bx, by]) => {
      ctx.beginPath();
      ctx.arc(bx * s, by * s, s * 0.028, 0, Math.PI * 2);
      ctx.fill();
    });
    // Cup stripes (branding)
    ctx.strokeStyle = 'rgba(189,195,199,0.55)';
    ctx.lineWidth = s * 0.025;
    [-0.04, 0.14, 0.30].forEach(ty => {
      ctx.beginPath();
      const halfW = s * 0.30 - (ty + 0.14) * s * 0.09;
      ctx.moveTo(-halfW, ty * s);
      ctx.lineTo( halfW, ty * s);
      ctx.stroke();
    });
    // Lid (ellipse)
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.15, s * 0.30, s * 0.08, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#dde0e2';
    ctx.fill();
    ctx.strokeStyle = '#bdc3c7'; ctx.lineWidth = s * 0.03; ctx.stroke();
    // Straw
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.roundRect(s * 0.08, -s * 0.64, s * 0.07, s * 0.52, 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(s * 0.10, -s * 0.64, s * 0.02, s * 0.52, 1);
    ctx.fill();
  },

  // ----------------------------------------------------------
  // DONUT (junk)
  // ----------------------------------------------------------
  donut(ctx, s) {
    // Donut ring — outer circle minus inner hole via even-odd fill
    ctx.beginPath();
    ctx.arc(0, 0,  s * 0.46, 0, Math.PI * 2, false);
    ctx.moveTo(s * 0.19, 0);
    ctx.arc(0, 0, s * 0.19, 0, Math.PI * 2, true);
    ctx.fillStyle = '#d4822e';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#b7770d'; ctx.lineWidth = s * 0.03; ctx.stroke();
    // Pink icing arc (top portion)
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, -s * 0.05,  s * 0.40, Math.PI * 1.06, Math.PI * 1.94, false);
    ctx.arc(0, -s * 0.05, s * 0.155, Math.PI * 1.94, Math.PI * 1.06, true);
    ctx.closePath();
    ctx.fillStyle = '#ff69b4';
    ctx.fill();
    ctx.restore();
    // Icing drizzle accent
    ctx.strokeStyle = '#ffadd4';
    ctx.lineWidth = s * 0.042;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -s * 0.05, s * 0.32, Math.PI * 1.12, Math.PI * 1.55);
    ctx.stroke();
    // Sprinkles (fixed positions & colors)
    [[-0.20,-0.28, 0.30,'#e74c3c'],
     [ 0.12,-0.32,-0.50,'#3498db'],
     [ 0.02,-0.38, 0.10,'#2ecc71'],
     [-0.08,-0.18, 0.80,'#f1c40f'],
     [ 0.22,-0.20,-0.30,'#e91e8c']].forEach(([sx, sy, angle, color]) => {
      ctx.save();
      ctx.translate(sx * s, sy * s);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.fillRect(-s * 0.055, -s * 0.015, s * 0.11, s * 0.03);
      ctx.restore();
    });
  },

  // ----------------------------------------------------------
  // CANDY / LOLLIPOP (junk)
  // ----------------------------------------------------------
  candy(ctx, s) {
    // Stick
    ctx.beginPath();
    ctx.moveTo(s * 0.04,  s * 0.22);
    ctx.lineTo(s * 0.04,  s * 0.70);
    ctx.strokeStyle = '#c8b8a0';
    ctx.lineWidth   = s * 0.095;
    ctx.lineCap     = 'round';
    ctx.stroke();
    // Wrapper at stick base
    ctx.beginPath();
    ctx.ellipse(s * 0.04, s * 0.26, s * 0.11, s * 0.065, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(230,225,215,0.88)';
    ctx.fill();
    // Candy circle body
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = s * 0.04; ctx.stroke();
    // White swirl stripes
    ctx.lineCap = 'butt';
    [0, Math.PI * 0.67, Math.PI * 1.33].forEach(start => {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.28, start, start + Math.PI * 0.58);
      ctx.strokeStyle = 'rgba(255,255,255,0.78)';
      ctx.lineWidth = s * 0.10;
      ctx.stroke();
    });
    [0.04, 0.71, 1.38].forEach(start => {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.14, start * Math.PI, start * Math.PI + Math.PI * 0.52);
      ctx.strokeStyle = 'rgba(255,255,255,0.60)';
      ctx.lineWidth = s * 0.06;
      ctx.stroke();
    });
    // Highlight
    ctx.beginPath();
    ctx.arc(-s * 0.16, -s * 0.16, s * 0.10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fill();
  },
};

// ============================================================
// CG CONCEPT: Particle System
// When the player catches food, a burst of colored particles
// is emitted.  Each particle is an independent object with its
// own position, velocity, color, size, and lifetime.
// Gravity is applied each frame, and alpha fades as lifetime
// decreases — this is a classic real-time particle effect.
// ============================================================
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    const angle = Math.random() * Math.PI * 2;
    const spd   = rnd(80, 210);
    this.vx = Math.cos(angle) * spd;
    this.vy = Math.sin(angle) * spd - rnd(40, 90);
    this.r  = rnd(3, 6);
    this.life    = rnd(0.45, 0.85);
    this.maxLife = this.life;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 240 * dt; // gravity
    this.life -= dt;
    this.r = Math.max(0, this.r - dt * 4);
  }
  draw() {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha  = alpha;
    ctx.fillStyle    = this.color;
    ctx.shadowColor  = this.color;
    ctx.shadowBlur   = this.r * 2.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  get dead() { return this.life <= 0; }
}

// ============================================================
// CG CONCEPT: Floating Score Text Animation
// Score labels ("+10", "COMBO!") rise upward and fade out,
// giving the player immediate visual feedback.
// Alpha interpolation over time is a core animation technique.
// ============================================================
class FloatText {
  constructor(x, y, text, color) {
    this.x    = x;
    this.y    = y;
    this.text = text;
    this.color = color;
    this.life = 1.0;
    this.vy   = -52;
  }
  update(dt) {
    this.y    += this.vy * dt;
    this.life -= dt;
  }
  draw() {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.font        = `bold ${Math.round(H * 0.038)}px Arial, sans-serif`;
    ctx.textAlign   = 'center';
    ctx.fillStyle   = this.color;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 5;
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
  get dead() { return this.life <= 0; }
}

// ============================================================
// CG CONCEPT: 2D Transformations — Falling Food Objects
// Each food item demonstrates three fundamental 2D transforms:
//   1. Translation  — y position increases each frame (falling)
//   2. Rotation     — angle increments each frame (spinning)
//   3. Scaling      — size grows slightly near the bottom AND
//                     explodes outward when caught
// These transforms are composed via the matrix stack:
//   ctx.translate → ctx.rotate → ctx.scale → draw
// ============================================================
class FallObj {
  constructor(type, x) {
    this.type  = type;
    this.x     = x;
    this.y     = -(W * CFG.FOOD_RATIO * 1.5);
    this.size  = W * CFG.FOOD_RATIO * rnd(0.88, 1.18);
    this.speed = fallSpeed * rnd(0.78, 1.28);
    this.rot   = Math.random() * Math.PI * 2;
    this.rotSpd = rnd(0.80, 2.60) * (Math.random() < 0.5 ? 1 : -1);
    this.scale = 1;
    this.alpha = 1;
    this.caught = false;
    this.missed = false; // true once a missed-healthy penalty has been applied
  }

  update(dt) {
    if (this.caught) {
      // ============================================================
      // CG CONCEPT: 2D Scaling — Catch Burst Animation
      // On catch, the object scales up rapidly while fading out,
      // providing visual feedback without needing a sprite sheet.
      // ============================================================
      this.scale += 5.5 * dt;
      this.alpha -= 3.8 * dt;
      return;
    }
    // ============================================================
    // CG CONCEPT: 2D Translation — Falling Motion
    // The y coordinate is incremented each frame proportional to
    // speed × deltaTime, giving smooth, frame-rate-independent
    // downward movement.
    // ============================================================
    this.y += this.speed * dt;

    // ============================================================
    // CG CONCEPT: 2D Rotation — Spinning Objects
    // The rotation angle increments each frame.  Each object has
    // a randomised rotational speed and direction.
    // ============================================================
    this.rot += this.rotSpd * dt;

    // ============================================================
    // CG CONCEPT: Proximity Scaling
    // Objects grow slightly as they approach the bottom of the
    // screen, reinforcing the sense of forward movement / depth.
    // ============================================================
    const progress = clamp(this.y / H, 0, 1);
    this.scale = 1 + progress * 0.13;
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = clamp(this.alpha, 0, 1);

    // ============================================================
    // CG CONCEPT: Matrix Stack — Transformation Pipeline
    // Applying translate → rotate → scale in sequence is exactly
    // how a 2D/3D transformation matrix pipeline works.
    // ctx.save() / ctx.restore() manage the matrix stack so that
    // each object's transforms do not bleed into the next.
    // ============================================================
    ctx.translate(this.x, this.y);           // 1. move to world position
    ctx.rotate(this.rot);                     // 2. rotate around object centre
    ctx.scale(this.scale, this.scale);        // 3. scale from centre

    // Shadow (drawn in object-local space)
    ctx.shadowColor   = 'rgba(0,0,0,0.30)';
    ctx.shadowBlur    = this.size * 0.28;
    ctx.shadowOffsetY = this.size * 0.10;

    FOOD_DRAWERS[this.type](ctx, this.size); // 4. draw shape at origin

    ctx.restore();  // pop matrix stack
  }

  getRect() {
    // Approximate AABB in world space (used for collision)
    const hs = this.size * 0.43 * this.scale;
    return { x: this.x - hs, y: this.y - hs, w: hs * 2, h: hs * 2 };
  }

  get dead() { return this.alpha <= 0 || this.y > H + this.size * 2; }
}

// ============================================================
// BASKET (player-controlled catcher)
// ============================================================
const basket = {
  x: 0, y: 0, w: 0, h: 0,

  reset() {
    this.w = W * CFG.BASKET_W_RATIO;
    this.h = W * CFG.BASKET_H_RATIO;
    this.x = W / 2 - this.w / 2;
    this.y = H - this.h - H * 0.038;
  },

  update(dt) {
    // ============================================================
    // CG CONCEPT: 2D Translation — Player Movement
    // Basket position is updated each frame based on input,
    // clamped to remain within the canvas bounds.
    // ============================================================
    const spd = W * CFG.BASKET_SPD_RATIO;
    if (keys.left  || touchDir === -1) this.x -= spd * dt;
    if (keys.right || touchDir ===  1) this.x += spd * dt;
    this.x = clamp(this.x, 0, W - this.w);
  },

  getRect() {
    // Slightly narrower hitbox than the visual for fairness
    const pad = this.w * 0.09;
    return { x: this.x + pad, y: this.y, w: this.w - pad * 2, h: this.h };
  },

  draw() {
    const bx = this.x, by = this.y, bw = this.w, bh = this.h;
    ctx.save();

    // Rim ellipse
    ctx.beginPath();
    ctx.ellipse(bx + bw / 2, by + bh * 0.14, bw / 2, bh * 0.20, 0, 0, Math.PI * 2);
    ctx.fillStyle   = '#c8a96a';
    ctx.fill();
    ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 2; ctx.stroke();

    // Basket body (trapezoid)
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.04, by + bh * 0.12);
    ctx.lineTo(bx,             by + bh);
    ctx.lineTo(bx + bw,        by + bh);
    ctx.lineTo(bx + bw - bw * 0.04, by + bh * 0.12);
    ctx.closePath();
    const bGrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    bGrad.addColorStop(0,   '#e8c87a');
    bGrad.addColorStop(0.5, '#c8a96a');
    bGrad.addColorStop(1,   '#a07840');
    ctx.fillStyle   = bGrad;
    ctx.fill();
    ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 2; ctx.stroke();

    // Woven horizontal lines
    ctx.strokeStyle = 'rgba(100,65,10,0.28)';
    ctx.lineWidth   = 1;
    [0.36, 0.57, 0.76].forEach(frac => {
      const fy      = by + bh * frac;
      const shrink  = (1 - frac) * bw * 0.04;
      ctx.beginPath();
      ctx.moveTo(bx + shrink,        fy);
      ctx.lineTo(bx + bw - shrink,   fy);
      ctx.stroke();
    });

    // Diagonal weave lines
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      ctx.beginPath();
      ctx.moveTo(bx + bw * t * 0.96 + bw * 0.02, by + bh * 0.12);
      ctx.lineTo(bx + bw * t,                      by + bh);
      ctx.stroke();
    }

    ctx.restore();
  },
};

// ============================================================
// CG CONCEPT: User Interaction / Input Handling
// Keyboard, mouse, and touch events are all handled and
// mapped to the same internal movement flags so that the
// game loop does not need to know the input source.
// ============================================================
const keys = { left: false, right: false };
let touchDir = 0; // -1 = left, 0 = none, 1 = right

document.addEventListener('keydown', e => {
  SoundManager.init(); // resume AudioContext on first key press
  switch (e.key) {
    case 'ArrowLeft':  case 'a': case 'A': keys.left  = true;  e.preventDefault(); break;
    case 'ArrowRight': case 'd': case 'D': keys.right = true;  e.preventDefault(); break;
    case ' ':
      if (state === S.START || state === S.OVER) startGame();
      e.preventDefault();
      break;
    case 'p': case 'P': case 'Escape':
      if (state === S.PLAYING || state === S.PAUSED) pauseGame();
      e.preventDefault();
      break;
    case 'm': case 'M':
      SoundManager.toggleMute();
      break;
  }
});

document.addEventListener('keyup', e => {
  switch (e.key) {
    case 'ArrowLeft':  case 'a': case 'A': keys.left  = false; break;
    case 'ArrowRight': case 'd': case 'D': keys.right = false; break;
  }
});

// Touch controls — tap left or right half to move
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  SoundManager.init(); // resume AudioContext on first touch
  const touch = e.touches[0];
  const rect  = canvas.getBoundingClientRect();
  const tx    = (touch.clientX - rect.left) * (W / rect.width);
  const ty    = (touch.clientY - rect.top)  * (H / rect.height);
  // Check mute button tap first
  if (tx >= muteBtn.x && tx <= muteBtn.x + muteBtn.w &&
      ty >= muteBtn.y && ty <= muteBtn.y + muteBtn.h) {
    SoundManager.toggleMute();
    return;
  }
  if (state === S.START || state === S.OVER) { startGame(); return; }
  if (state === S.PAUSED) { pauseGame(); return; }
  touchDir = tx < W / 2 ? -1 : 1;
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  touchDir = 0;
}, { passive: false });

// Mouse click for start / restart / mute toggle
canvas.addEventListener('click', e => {
  SoundManager.init();
  const rect = canvas.getBoundingClientRect();
  const cx   = (e.clientX - rect.left) * (W / rect.width);
  const cy   = (e.clientY - rect.top)  * (H / rect.height);
  // Mute button click (available in all states)
  if (cx >= muteBtn.x && cx <= muteBtn.x + muteBtn.w &&
      cy >= muteBtn.y && cy <= muteBtn.y + muteBtn.h) {
    SoundManager.toggleMute();
    return;
  }
  if (state === S.START || state === S.OVER) startGame();
  else if (state === S.PAUSED) pauseGame();
});

// ============================================================
// CG CONCEPT: AABB Collision Detection
// Axis-Aligned Bounding Box (AABB) is the simplest and most
// common broadphase collision technique.  Two rectangles
// overlap when neither is fully to the left, right, above,
// or below the other — tested with four comparisons.
// Visual feedback (particles, screen shake, floating text)
// is triggered immediately on detection.
// ============================================================
function rectsOverlap(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

function spawnParticles(x, y, color) {
  for (let i = 0; i < CFG.PARTICLE_COUNT; i++) {
    particles.push(new Particle(x, y, color));
  }
  // Extra white sparkle particles
  for (let i = 0; i < 4; i++) {
    particles.push(new Particle(x, y, '#ffffff'));
  }
}

function triggerShake(mag, dur) {
  shakeAmt = mag;
  shakeDur = dur;
}

function triggerLevelUp(msg) {
  lvlUpText  = msg;
  lvlUpTimer = 2.2;
  SoundManager.playLevelUp();
}

function checkCollisions() {
  const br = basket.getRect();
  objects.forEach(obj => {
    if (obj.caught) return;
    // Skip food that has already fallen past the basket bottom — prevents
    // phantom collisions from the food's hitbox extending below the visual basket.
    if (obj.y > basket.y + basket.h + obj.size * 0.5) return;
    if (rectsOverlap(br, obj.getRect())) {
      obj.caught = true;
      const info = FOOD_DATA[obj.type];

      if (info.healthy) {
        combo++;
        let pts = CFG.HEALTHY_PTS;
        let label = `+${pts}`;
        const isCombo = combo >= CFG.COMBO_THRESHOLD;
        if (isCombo) {
          pts  += CFG.COMBO_BONUS_PTS;
          label = `+${pts} COMBO x${combo}!`;
          SoundManager.playCombo();
        } else {
          SoundManager.playCollect();
        }
        score += pts;
        glowTimer = 0.55;
        floatTexts.push(new FloatText(obj.x, obj.y - obj.size, label, isCombo ? '#f1c40f' : '#ffffff'));
        spawnParticles(obj.x, obj.y, info.color);
        // Milestone check
        CFG.SCORE_THRESHOLDS.forEach(t => {
          if (!triggeredMilestones.has(t) && score >= t) {
            triggeredMilestones.add(t);
            triggerLevelUp(`★ ${t} POINTS!`);
          }
        });
        if (score > highScore) {
          highScore = score;
          localStorage.setItem('munchcatch_hs', highScore);
        }
      } else {
        // Junk food caught — lose a life
        combo = 0;
        lives--;
        SoundManager.playHurt();
        floatTexts.push(new FloatText(obj.x, obj.y - obj.size, '-1 ❤', '#e74c3c'));
        spawnParticles(obj.x, obj.y, '#e74c3c');
        // ============================================================
        // CG CONCEPT: Screen Shake (Translation-based Feedback)
        // The canvas origin is randomly displaced for a short duration
        // to simulate physical impact when the player loses a life.
        // ============================================================
        triggerShake(8, 0.38);
        if (lives <= 0) endGame();
      }
    }
  });
}

// ============================================================
// DIFFICULTY PROGRESSION
// Every 30 seconds the fall speed increases by 15% and the
// spawn interval decreases by 10%, making the game harder.
// ============================================================
function updateProgression(dt) {
  levelMs += dt * 1000;
  gameMs  += dt * 1000;
  if (levelMs >= CFG.LEVEL_DURATION_MS) {
    levelMs   = 0;
    level++;
    fallSpeed = CFG.BASE_FALL_SPEED * Math.pow(CFG.SPEED_MULT, level - 1);
    spawnMs   = CFG.BASE_SPAWN_MS   * Math.pow(CFG.SPAWN_MULT,  level - 1);
    triggerLevelUp(`LEVEL ${level}!`);
  }
}

// ============================================================
// SPAWN SYSTEM
// ============================================================
function spawnObject() {
  // 60% chance of healthy food, 40% junk
  const type = Math.random() < 0.60 ? rndEl(HEALTHY) : rndEl(JUNK);
  const s    = W * CFG.FOOD_RATIO;
  const x    = rnd(s * 1.1, W - s * 1.1);
  objects.push(new FallObj(type, x));
}

// ============================================================
// GAME CONTROL FUNCTIONS
// ============================================================
function startGame() {
  SoundManager.playClick();
  score      = 0;
  lives      = CFG.MAX_LIVES;
  level      = 1;
  combo      = 0;
  gameMs     = 0;
  levelMs    = 0;
  fallSpeed  = CFG.BASE_FALL_SPEED;
  spawnMs    = CFG.BASE_SPAWN_MS;
  spawnTimer = 0;
  bgHue      = 210;
  fadeAlpha  = 1;        // fade in from black
  lvlUpText  = '';
  lvlUpTimer = 0;
  glowTimer  = 0;
  shakeAmt   = 0;
  shakeDur   = 0;
  bottomFlashTimer = 0;
  triggeredMilestones = new Set();
  objects    = [];
  particles  = [];
  floatTexts = [];
  basket.reset();
  initBg();
  state = S.PLAYING;
}

function pauseGame() {
  state = state === S.PLAYING ? S.PAUSED : S.PLAYING;
}

function endGame() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('munchcatch_hs', highScore);
  }
  SoundManager.playGameOver();
  state = S.OVER;
}

// ============================================================
// HUD RENDERING
// CG CONCEPT: On-Canvas HUD
// Score, lives, level, combo, and the difficulty bar are all
// drawn directly onto the canvas using ctx text and shape
// commands, layered on top of all game objects.
// ============================================================
function drawHUD() {
  const pad = W * 0.038;
  const fs  = Math.round(H * 0.032);

  ctx.textBaseline = 'top';

  // --- Score (left, with glow when points gained) ---
  ctx.save();
  if (glowTimer > 0) {
    // ============================================================
    // CG CONCEPT: Glow Effect via shadowBlur
    // ctx.shadowBlur + shadowColor simulate a soft-light emission
    // around text or shapes, adding a sense of illumination.
    // ============================================================
    ctx.shadowColor = '#f1c40f';
    ctx.shadowBlur  = 20 * Math.min(glowTimer / 0.55, 1);
  }
  ctx.font      = `bold ${fs}px Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${score}`, pad, pad);
  ctx.restore();

  // Best score (smaller, dimmer)
  ctx.save();
  ctx.font      = `${Math.round(fs * 0.74)}px Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.textAlign = 'left';
  ctx.fillText(`BEST: ${highScore}`, pad, pad + fs * 1.42);
  ctx.restore();

  // --- Level (centre) ---
  ctx.save();
  ctx.font      = `bold ${fs}px Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(`LEVEL ${level}`, W / 2, pad);
  ctx.restore();

  // Level progress bar (below level text)
  const barW = W * 0.27;
  const barH = H * 0.011;
  const barX = W / 2 - barW / 2;
  const barY = pad + fs * 1.5;
  const prog = clamp(levelMs / CFG.LEVEL_DURATION_MS, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, barH / 2); ctx.fill();
  ctx.fillStyle = `hsl(${120 - prog * 120}, 80%, 55%)`;
  if (prog > 0) {
    ctx.beginPath(); ctx.roundRect(barX, barY, barW * prog, barH, barH / 2); ctx.fill();
  }

  // --- Lives (right, as hearts) ---
  ctx.save();
  ctx.font      = `${Math.round(fs * 1.15)}px Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  let hearts = '';
  for (let i = 0; i < CFG.MAX_LIVES; i++) hearts += (i < lives ? '❤' : '🖤');
  ctx.fillText(hearts, W - pad, pad);
  ctx.restore();

  // --- Combo counter ---
  if (combo >= 2) {
    ctx.save();
    ctx.font      = `bold ${Math.round(fs * 0.82)}px Arial, sans-serif`;
    ctx.fillStyle = '#f1c40f';
    ctx.textAlign = 'left';
    ctx.shadowColor = '#f1c40f'; ctx.shadowBlur = 9;
    ctx.fillText(`🔥 COMBO x${combo}`, pad, pad + fs * 2.7);
    ctx.restore();
  }

  ctx.textBaseline = 'alphabetic';
}

// ============================================================
// CG CONCEPT: 2D Scaling — Level-Up Text Animation
// When the level changes, large text zooms in (scale 0→1),
// holds, then fades out.  This uses ctx.translate + ctx.scale
// to create an in-place zoom centred on the canvas.
// ============================================================
function drawLevelUpAnim() {
  if (lvlUpTimer <= 0) return;
  const TOTAL = 2.2;
  const t     = 1 - lvlUpTimer / TOTAL; // 0 = just triggered, 1 = done
  let sc, alpha;
  if      (t < 0.15) { sc = t / 0.15;            alpha = t / 0.15; }
  else if (t < 0.72) { sc = 1;                    alpha = 1; }
  else               { sc = 1 + (t - 0.72) * 0.4; alpha = 1 - (t - 0.72) / 0.28; }

  ctx.save();
  ctx.globalAlpha  = clamp(alpha, 0, 1);
  ctx.translate(W / 2, H * 0.40);
  ctx.scale(sc, sc);                             // zoom in/out from centre
  ctx.font         = `bold ${Math.round(H * 0.082)}px Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = '#f1c40f';
  ctx.shadowBlur   = 35;
  ctx.fillStyle    = '#f1c40f';
  ctx.fillText(lvlUpText, 0, 0);
  ctx.restore();
}

// ============================================================
// CG CONCEPT: Screen Transition — Fade Overlay
// A black rectangle with decreasing alpha is drawn on top of
// every frame to create smooth fade-in/fade-out transitions
// between game screens.
// ============================================================
function drawFade() {
  if (fadeAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = clamp(fadeAlpha, 0, 1);
  ctx.fillStyle   = '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ============================================================
// SCREEN DRAW FUNCTIONS
// ============================================================

function drawStartScreen() {
  drawBg();
  objects.forEach(o => o.draw());  // decorative demo food

  // Dark translucent panel
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.beginPath();
  ctx.roundRect(W * 0.06, H * 0.10, W * 0.88, H * 0.78, 18);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';

  // Title
  ctx.shadowColor = '#f1c40f'; ctx.shadowBlur = 28;
  ctx.font      = `bold ${Math.round(H * 0.092)}px Arial, sans-serif`;
  ctx.fillStyle = '#f1c40f';
  ctx.fillText('MUNCH',  W / 2, H * 0.225);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('CATCH',  W / 2, H * 0.322);
  ctx.shadowBlur = 0;

  ctx.font      = `${Math.round(H * 0.028)}px Arial, sans-serif`;
  ctx.fillStyle = '#a8d8ea';
  ctx.fillText('Healthy vs Junk Food', W / 2, H * 0.41);

  // Instructions
  const lines = [
    ['🥗 Catch HEALTHY food   →  +10 pts', '#ffffff'],
    ['🍔 Catch junk / miss healthy  →  -1 ❤', '#ff8a80'],
    ['⬅ ➡  Arrow Keys or  A / D  to move', 'rgba(255,255,255,0.78)'],
    ['📱 Tap left / right half on mobile', 'rgba(255,255,255,0.68)'],
    ['⏸  P / ESC  pause    M  mute', 'rgba(255,255,255,0.68)'],
  ];
  ctx.font = `${Math.round(H * 0.025)}px Arial, sans-serif`;
  lines.forEach(([text, color], i) => {
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, H * 0.495 + i * H * 0.058);
  });

  // Pulsing start prompt
  const pulse = 0.72 + 0.28 * Math.sin(Date.now() / 420);
  ctx.globalAlpha = pulse;
  ctx.font        = `bold ${Math.round(H * 0.040)}px Arial, sans-serif`;
  ctx.fillStyle   = '#ffffff';
  ctx.fillText('▶  PRESS SPACE TO START', W / 2, H * 0.805);
  ctx.globalAlpha = 1;

  // High score
  if (highScore > 0) {
    ctx.font      = `${Math.round(H * 0.026)}px Arial, sans-serif`;
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`🏆 Best: ${highScore}`, W / 2, H * 0.866);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ============================================================
// CG CONCEPT: Mute Button — persistent UI overlay
// Drawn at the bottom-right corner in every game state so the
// player can toggle sound at any time.  The bounds are stored
// in `muteBtn` so click/touch handlers can hit-test against it.
// ============================================================
function drawMuteButton() {
  const size = Math.round(W * 0.072);
  const pad  = Math.round(W * 0.026);
  muteBtn.x = W - pad - size;
  muteBtn.y = H - pad - size;
  muteBtn.w = size;
  muteBtn.h = size;

  ctx.save();
  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(muteBtn.x, muteBtn.y, size, size, size * 0.22);
  ctx.fill();
  // Icon
  ctx.font         = `${Math.round(size * 0.60)}px Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(SoundManager.muted ? '🔇' : '🔊', muteBtn.x + size / 2, muteBtn.y + size / 2);
  ctx.restore();
}

function drawPlayingScreen() {
  drawBg();
  objects.forEach(o => o.draw());
  basket.draw();

  // ============================================================
  // CG CONCEPT: Bottom Flash — Translation-free feedback
  // A gradient rectangle drawn at the bottom of the canvas
  // pulses red when the player misses a healthy food item,
  // giving immediate spatial feedback about where the item fell.
  // ============================================================
  if (bottomFlashTimer > 0) {
    const alpha = Math.min(1, bottomFlashTimer / 0.15) * 0.60;
    ctx.save();
    ctx.globalAlpha = alpha;
    const flashH  = H * 0.18;
    const flashGr = ctx.createLinearGradient(0, H - flashH, 0, H);
    flashGr.addColorStop(0, 'rgba(255,0,0,0)');
    flashGr.addColorStop(1, 'rgba(255,0,0,1)');
    ctx.fillStyle = flashGr;
    ctx.fillRect(0, H - flashH, W, flashH);
    ctx.restore();
  }

  particles.forEach(p => p.draw());
  floatTexts.forEach(t => t.draw());
  drawHUD();
  drawLevelUpAnim();
}

function drawPauseOverlay() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.font        = `bold ${Math.round(H * 0.095)}px Arial, sans-serif`;
  ctx.shadowColor = '#3498db'; ctx.shadowBlur = 22;
  ctx.fillStyle   = '#ffffff';
  ctx.fillText('PAUSED', W / 2, H * 0.38);
  ctx.shadowBlur  = 0;

  ctx.font      = `${Math.round(H * 0.030)}px Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.fillText('Press P or ESC to resume', W / 2, H * 0.50);

  ctx.font      = `${Math.round(H * 0.028)}px Arial, sans-serif`;
  ctx.fillStyle = '#f1c40f';
  ctx.fillText(`Score: ${score}    Level: ${level}    Lives: ${'❤'.repeat(lives)}`, W / 2, H * 0.60);

  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawGameOverScreen() {
  drawBg();

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath();
  ctx.roundRect(W * 0.06, H * 0.13, W * 0.88, H * 0.72, 18);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';

  // GAME OVER title
  ctx.font        = `bold ${Math.round(H * 0.092)}px Arial, sans-serif`;
  ctx.shadowColor = '#e74c3c'; ctx.shadowBlur = 28;
  ctx.fillStyle   = '#e74c3c';
  ctx.fillText('GAME OVER', W / 2, H * 0.258);
  ctx.shadowBlur  = 0;

  // Final score value
  ctx.font      = `bold ${Math.round(H * 0.060)}px Arial, sans-serif`;
  ctx.fillStyle = '#f1c40f';
  ctx.fillText(`${score}`, W / 2, H * 0.400);

  ctx.font      = `${Math.round(H * 0.028)}px Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('FINAL SCORE', W / 2, H * 0.458);

  // High score line
  ctx.font      = `${Math.round(H * 0.026)}px Arial, sans-serif`;
  ctx.fillStyle = score >= highScore ? '#f1c40f' : 'rgba(255,255,255,0.58)';
  ctx.fillText(score >= highScore ? '🏆 NEW HIGH SCORE!' : `Best: ${highScore}`, W / 2, H * 0.518);

  // Letter grade
  let grade, gradeColor;
  if      (score >= 500) { grade = 'S'; gradeColor = '#f1c40f'; }
  else if (score >= 250) { grade = 'A'; gradeColor = '#2ecc71'; }
  else if (score >= 100) { grade = 'B'; gradeColor = '#3498db'; }
  else if (score >=  50) { grade = 'C'; gradeColor = '#ecf0f1'; }
  else                   { grade = 'D'; gradeColor = '#bdc3c7'; }
  ctx.font        = `bold ${Math.round(H * 0.068)}px Arial, sans-serif`;
  ctx.fillStyle   = gradeColor;
  ctx.shadowColor = gradeColor; ctx.shadowBlur = 16;
  ctx.fillText(`Grade: ${grade}`, W / 2, H * 0.608);
  ctx.shadowBlur  = 0;

  // Play again prompt (pulsing)
  const pulse = 0.78 + 0.22 * Math.sin(Date.now() / 370);
  ctx.globalAlpha = pulse;
  ctx.font        = `bold ${Math.round(H * 0.038)}px Arial, sans-serif`;
  ctx.fillStyle   = '#2ecc71';
  ctx.fillText('▶  PLAY AGAIN  (SPACE / CLICK)', W / 2, H * 0.748);
  ctx.globalAlpha = 1;

  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ============================================================
// UPDATE FUNCTIONS
// ============================================================

function updateStart(dt) {
  updateBg(dt);
  // Animate decorative falling food in background
  spawnTimer -= dt * 1000;
  if (spawnTimer <= 0) {
    const type = Math.random() < 0.6 ? rndEl(HEALTHY) : rndEl(JUNK);
    const s    = W * CFG.FOOD_RATIO;
    objects.push(new FallObj(type, rnd(s, W - s)));
    spawnTimer = 1500 * rnd(0.65, 1.35);
    // Keep demo object count low
    if (objects.length > 12) objects.splice(0, 3);
  }
  objects.forEach(o => o.update(dt));
  objects = objects.filter(o => !o.dead);
}

function updatePlaying(dt) {
  updateBg(dt);
  basket.update(dt);

  // Spawn new objects
  spawnTimer -= dt * 1000;
  if (spawnTimer <= 0) {
    spawnObject();
    spawnTimer = spawnMs * rnd(0.70, 1.30);
  }

  objects.forEach(o   => o.update(dt));
  particles.forEach(p => p.update(dt));
  floatTexts.forEach(t => t.update(dt));

  if (lvlUpTimer > 0) lvlUpTimer -= dt;

  // Collision check must run before missed detection so a caught object
  // is already flagged before we look for uncaught items past the bottom.
  checkCollisions();

  // ============================================================
  // NEW RULE: Missed healthy food costs 1 life.
  // Detect healthy, uncaught objects whose centre has passed the
  // bottom edge of the canvas (y > H).  A `missed` flag prevents
  // the penalty from firing more than once per object.
  // ============================================================
  objects.forEach(obj => {
    if (obj.caught || obj.missed) return;
    if (!FOOD_DATA[obj.type].healthy) return;
    if (obj.y - obj.size * 0.5 > H) {
      obj.missed = true;
      lives--;
      combo = 0;
      SoundManager.playHurt();
      floatTexts.push(new FloatText(
        clamp(obj.x, W * 0.10, W * 0.90),
        H - H * 0.07,
        '-1 ❤',
        '#ff4444'
      ));
      spawnParticles(obj.x, H, '#e74c3c');
      triggerShake(8, 0.38);
      bottomFlashTimer = 0.35;
      if (lives <= 0) { endGame(); return; }
    }
  });

  objects    = objects.filter(o   => !o.dead);
  particles  = particles.filter(p => !p.dead);
  floatTexts = floatTexts.filter(t => !t.dead);

  updateProgression(dt);
}

// ============================================================
// CG CONCEPT: requestAnimationFrame Game Loop
// requestAnimationFrame schedules the next frame to be drawn
// in sync with the display refresh rate (~60 fps).
// Delta time (dt = elapsed seconds since last frame) ensures
// all movement and physics are frame-rate independent — the
// game runs at the same real-world speed on 30 fps and 144 fps.
// ============================================================
let lastTimestamp = 0;

function gameLoop(timestamp) {
  const rawDt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  const dt = Math.min(rawDt, 0.10); // cap at 100 ms to avoid spiral on tab switch

  // Fade-in timer (decreases every frame after scene starts)
  if (fadeAlpha > 0) fadeAlpha = Math.max(0, fadeAlpha - dt * 2.2);

  // Glow timer
  if (glowTimer > 0) glowTimer = Math.max(0, glowTimer - dt);

  // Screen shake timer
  if (shakeDur > 0) {
    shakeDur -= dt;
    if (shakeDur <= 0) { shakeDur = 0; shakeAmt = 0; }
  }

  // Bottom flash timer (red edge flash on missed healthy food)
  if (bottomFlashTimer > 0) bottomFlashTimer = Math.max(0, bottomFlashTimer - dt);

  ctx.clearRect(0, 0, W, H);

  // ============================================================
  // CG CONCEPT: Screen Shake — Canvas Translation
  // Randomly translating the canvas origin by a small amount
  // each frame simulates the impact of losing a life.
  // ctx.save/restore keeps this displacement from accumulating.
  // ============================================================
  ctx.save();
  if (shakeAmt > 0 && shakeDur > 0) {
    ctx.translate(
      (Math.random() - 0.5) * 2 * shakeAmt,
      (Math.random() - 0.5) * 2 * shakeAmt
    );
  }

  // State-specific update + draw
  switch (state) {
    case S.START:
      updateStart(dt);
      drawStartScreen();
      break;
    case S.PLAYING:
      updatePlaying(dt);
      drawPlayingScreen();
      break;
    case S.PAUSED:
      // Draw frozen playing state, then overlay
      drawPlayingScreen();
      drawPauseOverlay();
      break;
    case S.OVER:
      drawGameOverScreen();
      break;
  }

  ctx.restore(); // undo shake displacement

  // Fade overlay is drawn outside shake so it covers cleanly
  drawFade();

  // Mute button is always visible, drawn above everything
  drawMuteButton();

  // Schedule next frame
  requestAnimationFrame(gameLoop);
}

// ============================================================
// INITIALISE
// ============================================================
resizeCanvas();
basket.reset();
initBg();

// Seed some demo objects for the start screen
for (let i = 0; i < 6; i++) {
  const type = Math.random() < 0.6 ? rndEl(HEALTHY) : rndEl(JUNK);
  const s    = W * CFG.FOOD_RATIO;
  const obj  = new FallObj(type, rnd(s, W - s));
  obj.y      = rnd(-H * 0.8, H * 0.6);   // scatter vertically
  objects.push(obj);
}

requestAnimationFrame(gameLoop);
