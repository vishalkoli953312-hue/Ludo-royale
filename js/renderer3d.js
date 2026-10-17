// WebGL renderer built on Three.js r128 (global `THREE`, loaded by main.js).
// Responsibilities: scene, procedural high-resolution board textures, pawns, 3D dice, camera
// fitting for any screen shape, tween-based animation (hops, captures, dice toss) and tap picking.

import { COLORS, BASE_CENTER, SAFE_LOOP, START_INDEX, LOOP, HOME_COLUMNS, gridPos, worldPos } from './config.js';

const PI = Math.PI;
const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
};
const wrapAngle = (a) => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function star(g, cx, cy, R, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -PI / 2 + (i * PI) / 5, rad = i % 2 ? r : R;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
}
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const isArm = (c, r) => (c >= 6 && c <= 8) || (r >= 6 && r <= 8);
const isCenter = (c, r) => c >= 6 && c <= 8 && r >= 6 && r <= 8;

/** Colour map for the board top. Drawn once at S x S pixels (2048 on capable devices). */
function drawBoardColor(S) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), u = S / 15, rnd = lcg(7);
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#f8f0dd'); grd.addColorStop(1, '#e8dabd');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);

  g.globalAlpha = 0.06;
  for (let i = 0; i < 240; i++) {
    const y = rnd() * S;
    g.strokeStyle = rnd() < 0.5 ? '#8a6d3b' : '#ffffff'; g.lineWidth = 0.6 + rnd() * u * 0.05;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + (rnd() - 0.5) * u, S * 0.7, y + (rnd() - 0.5) * u, S, y + (rnd() - 0.5) * u * 0.6);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Bases
  const bxy = [[0, 0], [9, 0], [9, 9], [0, 9]];
  COLORS.forEach((c, p) => {
    const x = bxy[p][0] * u, y = bxy[p][1] * u, s = 6 * u;
    const gr = g.createLinearGradient(x, y, x + s, y + s); gr.addColorStop(0, c.css); gr.addColorStop(1, c.deep);
    g.fillStyle = gr; roundRect(g, x + u * 0.04, y + u * 0.04, s - u * 0.08, s - u * 0.08, u * 0.35); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.16)'; roundRect(g, x + u * 1.02, y + u * 1.08, 4 * u, 4 * u, u * 0.6); g.fill();
    g.fillStyle = '#fff8e8'; roundRect(g, x + u, y + u, 4 * u, 4 * u, u * 0.6); g.fill();
    g.strokeStyle = 'rgba(120,90,40,0.55)'; g.lineWidth = u * 0.05; g.stroke();
    const [bc, br] = BASE_CENTER[p];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ox, oy]) => {
      const cx = (bc + ox + 0.5) * u, cy = (br + oy + 0.5) * u;
      g.beginPath(); g.arc(cx, cy, u * 0.5, 0, PI * 2);
      g.fillStyle = c.css; g.globalAlpha = 0.28; g.fill(); g.globalAlpha = 1;
      g.lineWidth = u * 0.07; g.strokeStyle = c.deep; g.stroke();
    });
  });

  // Track tiles
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    if (!isArm(c, r) || isCenter(c, r)) continue;
    g.fillStyle = '#fffaf0'; roundRect(g, c * u + u * 0.04, r * u + u * 0.04, u * 0.92, u * 0.92, u * 0.12); g.fill();
    g.strokeStyle = 'rgba(130,100,45,0.62)'; g.lineWidth = u * 0.035; g.stroke();
  }
  COLORS.forEach((col, p) => {
    const paint = ([c, r], alpha) => {
      g.globalAlpha = alpha; g.fillStyle = col.css;
      roundRect(g, c * u + u * 0.04, r * u + u * 0.04, u * 0.92, u * 0.92, u * 0.12); g.fill();
      g.globalAlpha = 1; g.strokeStyle = col.deep; g.lineWidth = u * 0.035; g.stroke();
    };
    HOME_COLUMNS[p].forEach((cell) => paint(cell, 0.92));
    paint(LOOP[START_INDEX[p]], 1);
    const [sc, sr] = LOOP[START_INDEX[p]];
    g.beginPath(); g.arc((sc + 0.5) * u, (sr + 0.5) * u, u * 0.26, 0, PI * 2);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = u * 0.06; g.stroke();
  });
  SAFE_LOOP.forEach((idx) => {
    if (START_INDEX.includes(idx)) return;
    const [c, r] = LOOP[idx];
    star(g, (c + 0.5) * u, (r + 0.5) * u, u * 0.36, u * 0.16);
    g.fillStyle = '#c79a37'; g.fill(); g.strokeStyle = '#7a5a14'; g.lineWidth = u * 0.025; g.stroke();
  });

  // Centre home triangles
  const tri = [
    [[6, 6], [6, 9], [7.5, 7.5]], [[6, 6], [9, 6], [7.5, 7.5]],
    [[9, 6], [9, 9], [7.5, 7.5]], [[6, 9], [9, 9], [7.5, 7.5]],
  ];
  const order = [0, 1, 2, 3];
  order.forEach((p) => {
    const t = tri[p], col = COLORS[p];
    const gr = g.createLinearGradient(t[0][0] * u, t[0][1] * u, 7.5 * u, 7.5 * u);
    gr.addColorStop(0, col.css); gr.addColorStop(1, col.deep);
    g.beginPath(); g.moveTo(t[0][0] * u, t[0][1] * u); g.lineTo(t[1][0] * u, t[1][1] * u); g.lineTo(t[2][0] * u, t[2][1] * u); g.closePath();
    g.fillStyle = gr; g.fill(); g.strokeStyle = '#c9a24b'; g.lineWidth = u * 0.05; g.stroke();
  });
  g.beginPath(); g.arc(7.5 * u, 7.5 * u, u * 0.2, 0, PI * 2); g.fillStyle = '#f4e3b0'; g.fill();
  g.strokeStyle = '#a77f26'; g.lineWidth = u * 0.04; g.stroke();

  // Speckle + gold inlay frame
  g.globalAlpha = 0.05;
  for (let i = 0; i < 3500; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
  g.globalAlpha = 1;
  g.strokeStyle = '#c9a24b'; g.lineWidth = u * 0.1; g.strokeRect(u * 0.05, u * 0.05, S - u * 0.1, S - u * 0.1);
  return cv;
}

/** Height map: raised tiles with grooves, recessed token seats. */
function drawBoardBump(S) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), u = S / 15, rnd = lcg(21);
  g.fillStyle = '#7c7c7c'; g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 160; i++) {
    const y = rnd() * S; g.strokeStyle = rnd() < 0.5 ? '#444' : '#bbb'; g.lineWidth = 0.6 + rnd() * 1.2;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + (rnd() - 0.5) * u, S * 0.7, y + (rnd() - 0.5) * u, S, y + (rnd() - 0.5) * u * 0.6); g.stroke();
  }
  g.globalAlpha = 1;
  const bxy = [[0, 0], [9, 0], [9, 9], [0, 9]];
  COLORS.forEach((c, p) => {
    const x = bxy[p][0] * u, y = bxy[p][1] * u;
    g.fillStyle = '#868686'; roundRect(g, x + u * 0.04, y + u * 0.04, 6 * u - u * 0.08, 6 * u - u * 0.08, u * 0.35); g.fill();
    g.fillStyle = '#6e6e6e'; roundRect(g, x + u, y + u, 4 * u, 4 * u, u * 0.6); g.fill();
    const [bc, br] = BASE_CENTER[p];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ox, oy]) => {
      g.beginPath(); g.arc((bc + ox + 0.5) * u, (br + oy + 0.5) * u, u * 0.5, 0, PI * 2); g.fillStyle = '#4a4a4a'; g.fill();
    });
  });
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    if (!isArm(c, r) || isCenter(c, r)) continue;
    g.fillStyle = '#9a9a9a'; roundRect(g, c * u + u * 0.05, r * u + u * 0.05, u * 0.9, u * 0.9, u * 0.12); g.fill();
    g.strokeStyle = '#3c3c3c'; g.lineWidth = u * 0.06; g.stroke();
  }
  g.fillStyle = '#8a8a8a'; g.fillRect(6 * u, 6 * u, 3 * u, 3 * u);
  return cv;
}

const PIPS = {
  1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};
function drawDiceFace(v) {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#d9cdb2'; g.fillRect(0, 0, S, S);
  const gr = g.createLinearGradient(0, 0, S, S); gr.addColorStop(0, '#fffbf0'); gr.addColorStop(1, '#efe3c6');
  g.fillStyle = gr; roundRect(g, 8, 8, S - 16, S - 16, 34); g.fill();
  PIPS[v].forEach(([x, y]) => {
    const one = v === 1, rad = one ? 36 : 24;
    g.beginPath(); g.arc(x * S, y * S, rad, 0, PI * 2);
    g.fillStyle = one ? '#c4132e' : '#1b1b24'; g.fill();
    g.beginPath(); g.arc(x * S - rad * 0.28, y * S - rad * 0.28, rad * 0.3, 0, PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
  });
  return cv;
}
// BoxGeometry face order: +x, -x, +y, -y, +z, -z
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.T = window.THREE;
    this.tweens = []; this.tokens = []; this.time = 0;
    this.W = 0; this.H = 0;
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.mode = 'attract'; this.view = 'tilt'; this.playYaw = -PI / 2;
    this.cam = { yaw: PI / 4, tilt: 0.95, dist: 30 };
    this.goal = { yaw: PI / 4, tilt: 0.95, dist: 30 };
    this.diceIdle = true; this.awaitRoll = false;
    this.onFrame = null; this.onContextLost = null;
    this.running = false; this.lost = false;
  }

  async init(onProgress = () => {}) {
    const T = this.T;
    if (!T) throw new Error('THREE is not loaded');
    const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
    const low = mem <= 2 || cores <= 2;
    this.q = { tex: low ? 1024 : 2048, shadow: low ? 1024 : 2048, maxPR: low ? 1.5 : 2, physical: !low };

    const r = this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.12;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    this.pr = Math.min(window.devicePixelRatio || 1, this.q.maxPR);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; if (this.onContextLost) this.onContextLost(); });

    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(32, 1, 0.5, 220);
    this._v = new T.Vector3();

    // Lights: soft sky/ground, one shadow-casting key, one cool rim.
    this.scene.add(new T.HemisphereLight(0xfff1dc, 0x1b2a33, 0.5));
    const key = this.key = new T.DirectionalLight(0xffffff, 1.0);
    key.position.set(-7, 16, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 45 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new T.DirectionalLight(0x9fd0ff, 0.35); rim.position.set(9, 6, -11); this.scene.add(rim);

    onProgress(0.1, 'Preparing table');
    await nextFrame();
    this._buildBoard(onProgress);
    await nextFrame();
    onProgress(0.55, 'Lighting');
    this._buildEnv();
    await nextFrame();
    onProgress(0.75, 'Rolling the dice');
    this._buildDice();
    this._buildPawnParts();
    onProgress(0.9, 'Setting pieces');
    this.setTokens(null);
    onProgress(1, 'Ready');
  }

  // ---- scene construction ---------------------------------------------------------------
  _buildBoard(onProgress) {
    const T = this.T, S = this.q.tex;
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const map = new T.CanvasTexture(drawBoardColor(S));
    map.encoding = T.sRGBEncoding; map.anisotropy = aniso;
    onProgress(0.35, 'Painting board');
    const bump = new T.CanvasTexture(drawBoardBump(S >> 1));
    bump.anisotropy = aniso;
    const Mat = this.q.physical ? T.MeshPhysicalMaterial : T.MeshStandardMaterial;
    const opts = { map, bumpMap: bump, bumpScale: 0.6, roughness: 0.4, metalness: 0, envMapIntensity: 0.35 };
    if (this.q.physical) { opts.clearcoat = 0.7; opts.clearcoatRoughness = 0.18; }
    const top = new T.Mesh(new T.PlaneGeometry(15, 15), new Mat(opts));
    top.rotation.x = -PI / 2; top.position.y = 0.002; top.receiveShadow = true;
    this.scene.add(top);
    this.boardTop = top;

    const slab = new T.Mesh(new T.BoxGeometry(15.5, 0.6, 15.5), new T.MeshStandardMaterial({ color: 0x2b1b13, roughness: 0.55, metalness: 0.1 }));
    slab.position.y = -0.302; slab.receiveShadow = true; this.scene.add(slab);

    const brass = new T.MeshStandardMaterial({ color: 0xc9a24b, metalness: 1, roughness: 0.28, envMapIntensity: 1 });
    [[0, 7.6, 15.7, 0.2], [0, -7.6, 15.7, 0.2]].forEach(([x, z, w, d]) => {
      const m = new T.Mesh(new T.BoxGeometry(w, 0.18, d), brass); m.position.set(x, 0.09, z); m.castShadow = true; this.scene.add(m);
    });
    [[7.6, 0], [-7.6, 0]].forEach(([x, z]) => {
      const m = new T.Mesh(new T.BoxGeometry(0.2, 0.18, 15.4), brass); m.position.set(x, 0.09, z); m.castShadow = true; this.scene.add(m);
    });

    const catcher = new T.Mesh(new T.PlaneGeometry(70, 70), new T.ShadowMaterial({ opacity: 0.34 }));
    catcher.rotation.x = -PI / 2; catcher.position.y = -0.62; catcher.receiveShadow = true; this.scene.add(catcher);
  }

  _buildEnv() {
    const T = this.T;
    const pm = new T.PMREMGenerator(this.renderer);
    const s = new T.Scene();
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
    const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#cfe6ff'); gr.addColorStop(0.45, '#55727c'); gr.addColorStop(1, '#0c1a1f');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
    s.add(new T.Mesh(new T.SphereGeometry(50, 32, 16), new T.MeshBasicMaterial({ map: tex, side: T.BackSide })));
    [[-12, 30, 12, 30, 14], [18, 22, -10, 16, 8], [0, 8, 26, 24, 5]].forEach(([x, y, z, w, h]) => {
      const m = new T.MeshBasicMaterial({ side: T.DoubleSide }); m.color.setRGB(6, 6, 6);
      const p = new T.Mesh(new T.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.lookAt(0, 0, 0); s.add(p);
    });
    this.scene.environment = pm.fromScene(s, 0.04).texture;
    pm.dispose(); tex.dispose();
  }

  _buildPawnParts() {
    const T = this.T;
    const prof = [[0, 0], [0.34, 0], [0.37, 0.03], [0.36, 0.08], [0.30, 0.13], [0.22, 0.18], [0.16, 0.30], [0.13, 0.46], [0.19, 0.52], [0.21, 0.56], [0.15, 0.60], [0.10, 0.64]]
      .map(([x, y]) => new T.Vector2(x, y));
    this.pawnGeo = new T.LatheGeometry(prof, 32);
    this.headGeo = new T.SphereGeometry(0.2, 24, 16);
    this.ringGeo = new T.RingGeometry(0.42, 0.56, 40);
  }

  _buildDice() {
    const T = this.T;
    const aniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const mats = FACE_VALUES.map((v) => {
      const t = new T.CanvasTexture(drawDiceFace(v)); t.encoding = T.sRGBEncoding; t.anisotropy = aniso;
      return new T.MeshStandardMaterial({ map: t, roughness: 0.32, metalness: 0, envMapIntensity: 0.6 });
    });
    const dice = this.dice = new T.Mesh(new T.BoxGeometry(1, 1, 1), mats);
    dice.castShadow = true; dice.position.set(0, 0.5, 0);
    dice.quaternion.copy(this._faceQuat(1, 0.3));
    this.scene.add(dice);
    const ring = this.turnRing = new T.Mesh(new T.RingGeometry(0.82, 1.02, 56),
      new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    ring.rotation.x = -PI / 2; ring.position.y = 0.03; ring.visible = false; this.scene.add(ring);
  }

  _faceQuat(value, yaw) {
    const T = this.T, e = new T.Euler();
    switch (value) {
      case 6: e.set(PI, 0, 0); break;
      case 3: e.set(0, 0, PI / 2); break;
      case 4: e.set(0, 0, -PI / 2); break;
      case 2: e.set(-PI / 2, 0, 0); break;
      case 5: e.set(PI / 2, 0, 0); break;
      default: e.set(0, 0, 0);
    }
    const q = new T.Quaternion().setFromEuler(e);
    return new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw).multiply(q);
  }

  // ---- tokens ---------------------------------------------------------------------------
  _clearTokens() {
    this.tokens.forEach((tk) => { this.scene.remove(tk.group); tk.mat.dispose(); tk.ring.material.dispose(); });
    this.tokens = [];
  }

  /** state = game state, or null for the lobby showcase (all four colours in base). */
  setTokens(state) {
    const T = this.T;
    this._clearTokens();
    const seats = state ? state.seats.map((s) => ({ player: s.player, tokens: s.tokens }))
      : [0, 1, 2, 3].map((p) => ({ player: p, tokens: [-1, -1, -1, -1] }));
    seats.forEach((s, seat) => {
      s.tokens.forEach((p, token) => {
        const col = COLORS[s.player];
        const mopts = { color: col.hex, roughness: 0.3, metalness: 0.05, emissive: col.hex, emissiveIntensity: 0 };
        let mat;
        if (this.q.physical) mat = new T.MeshPhysicalMaterial({ ...mopts, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
        else mat = new T.MeshStandardMaterial({ ...mopts, envMapIntensity: 1.0 });
        const body = new T.Mesh(this.pawnGeo, mat), head = new T.Mesh(this.headGeo, mat);
        head.position.y = 0.74; body.castShadow = head.castShadow = true;
        const pawn = new T.Group(); pawn.add(body, head);
        const ring = new T.Mesh(this.ringGeo, new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
        ring.rotation.x = -PI / 2; ring.position.y = 0.03; ring.visible = false;
        const group = new T.Group(); group.add(pawn, ring); this.scene.add(group);
        const w = worldPos(s.player, p, token);
        const tk = { seat, token, player: s.player, group, pawn, ring, mat, p, cur: { x: w.x, z: w.z }, lift: 0, scale: 1, movable: false, phase: Math.random() * 6 };
        this._apply(tk);
        this.tokens.push(tk);
      });
    });
    this.relayout(false);
  }

  _find(seat, token) { return this.tokens.find((t) => t.seat === seat && t.token === token); }
  _apply(tk) { tk.group.position.set(tk.cur.x, tk.lift, tk.cur.z); tk.group.scale.setScalar(tk.scale); }

  /** Re-spread tokens that share a cell so none hides another. */
  relayout(animate = true) {
    const map = new Map();
    for (const tk of this.tokens) {
      const [c, r] = gridPos(tk.player, tk.p, tk.token);
      const key = tk.p < 0 || tk.p >= 56 ? `u${tk.seat}-${tk.token}` : `${c},${r}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tk);
    }
    for (const list of map.values()) {
      const n = list.length;
      list.forEach((tk, i) => {
        let ox = 0, oz = 0, s = 1;
        if (n > 1) {
          const rad = n === 2 ? 0.2 : 0.27, a = (i / n) * PI * 2 + PI / 4;
          ox = Math.cos(a) * rad; oz = Math.sin(a) * rad; s = n === 2 ? 0.86 : 0.78;
        }
        const w = worldPos(tk.player, tk.p, tk.token);
        this._moveTo(tk, w.x + ox, w.z + oz, s, animate);
      });
    }
  }

  _moveTo(tk, x, z, s, animate) {
    if (!animate) { tk.cur.x = x; tk.cur.z = z; tk.scale = s; this._apply(tk); return; }
    const sx = tk.cur.x, sz = tk.cur.z, ss = tk.scale;
    this.tween(0.18, (k) => { tk.cur.x = sx + (x - sx) * k; tk.cur.z = sz + (z - sz) * k; tk.scale = ss + (s - ss) * k; this._apply(tk); });
  }

  async hop(seat, token, from, path, onStep) {
    const tk = this._find(seat, token);
    if (!tk) return;
    for (let i = 0; i < path.length; i++) {
      const p = path[i], w = worldPos(tk.player, p, token);
      const sx = tk.cur.x, sz = tk.cur.z, s0 = tk.scale;
      const leave = from === -1 && i === 0;
      const h = leave ? 0.95 : 0.42, dur = leave ? 0.45 : 0.17;
      await this.tween(dur, (k) => {
        tk.cur.x = sx + (w.x - sx) * k; tk.cur.z = sz + (w.z - sz) * k;
        tk.lift = Math.sin(PI * k) * h; tk.scale = s0 + (1 - s0) * k; this._apply(tk);
      }, ease.linear);
      tk.lift = 0; tk.p = p; tk.cur.x = w.x; tk.cur.z = w.z; tk.scale = 1; this._apply(tk);
      if (onStep) onStep(i, p, { x: w.x, y: 0.45, z: w.z });
    }
    this.relayout(true);
  }

  async sendToBase(seat, token) {
    const tk = this._find(seat, token);
    if (!tk) return;
    const w = worldPos(tk.player, -1, token), sx = tk.cur.x, sz = tk.cur.z;
    await this.tween(0.8, (k, raw) => {
      tk.cur.x = sx + (w.x - sx) * k; tk.cur.z = sz + (w.z - sz) * k;
      tk.lift = Math.sin(PI * raw) * 2.8; tk.pawn.rotation.y = raw * PI * 4; this._apply(tk);
    }, ease.inOut);
    tk.pawn.rotation.y = 0; tk.lift = 0; tk.p = -1; tk.scale = 1; tk.cur.x = w.x; tk.cur.z = w.z; this._apply(tk);
    this.relayout(true);
  }

  /** list = [{seat, token}] pulsing and tappable. */
  setMovable(list = []) {
    const keys = new Set(list.map((m) => `${m.seat}:${m.token}`));
    for (const tk of this.tokens) {
      const on = keys.has(`${tk.seat}:${tk.token}`);
      tk.movable = on;
      if (!on) { tk.pawn.position.y = 0; tk.ring.visible = false; tk.mat.emissiveIntensity = 0; }
      else tk.ring.visible = true;
    }
  }

  tokenWorld(seat, token) { const tk = this._find(seat, token); return tk ? { x: tk.cur.x, y: 0.45, z: tk.cur.z } : null; }

  // ---- dice -----------------------------------------------------------------------------
  setTurn(player) {
    if (player == null) { this.turnRing.visible = false; return; }
    this.turnRing.visible = true; this.turnRing.material.color.setHex(COLORS[player].hex);
  }
  setAwaitRoll(on) { this.awaitRoll = !!on; }

  async rollDice(value, player) {
    const T = this.T, dice = this.dice;
    this.diceIdle = false;
    const bc = BASE_CENTER[player];
    const from = { x: (bc[0] - 7) * 0.8, y: 3.4, z: (bc[1] - 7) * 0.8 };
    const qFinal = this._faceQuat(value, (Math.random() - 0.5) * 0.9);
    const qStart = new T.Quaternion().setFromEuler(new T.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const axis = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const qSpin = new T.Quaternion(), turns = 3.2 * PI * 2;
    let mid = null;
    await this.tween(1.2, (e, raw) => {
      dice.position.x = from.x * (1 - e); dice.position.z = from.z * (1 - e);
      dice.position.y = 0.5 + (from.y - 0.5) * Math.pow(1 - raw, 2.2) + Math.abs(Math.sin(raw * PI * 3)) * Math.pow(1 - raw, 1.5) * 0.9;
      if (raw < 0.72) {
        qSpin.setFromAxisAngle(axis, (raw / 0.72) * turns);
        dice.quaternion.copy(qStart).premultiply(qSpin);
      } else {
        if (!mid) mid = dice.quaternion.clone();
        dice.quaternion.copy(mid).slerp(qFinal, ease.inOut((raw - 0.72) / 0.28));
      }
    }, ease.outCubic);
    dice.position.set(0, 0.5, 0); dice.quaternion.copy(qFinal);
    this.diceIdle = true;
  }

  // ---- animation core -------------------------------------------------------------------
  tween(dur, fn, easing = ease.inOut) {
    return new Promise((resolve) => { this.tweens.push({ t: 0, dur, fn, easing, resolve }); });
  }

  update(dt) {
    this.time += dt;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const raw = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.easing(raw), raw);
      if (raw >= 1) { this.tweens.splice(i, 1); tw.resolve(); }
    }
    const t = this.time;
    for (const tk of this.tokens) {
      if (!tk.movable) continue;
      tk.pawn.position.y = Math.abs(Math.sin(t * 5 + tk.phase)) * 0.14;
      tk.ring.scale.setScalar(1 + 0.12 * Math.sin(t * 5));
      tk.mat.emissiveIntensity = 0.2 + 0.18 * Math.sin(t * 5 + tk.phase);
    }
    if (this.turnRing.visible) {
      const k = this.awaitRoll ? 7 : 2.5;
      this.turnRing.scale.setScalar(1 + 0.08 * Math.sin(t * k));
      this.turnRing.material.opacity = this.awaitRoll ? 0.7 + 0.3 * Math.sin(t * k) : 0.45;
    }
    if (this.diceIdle && this.awaitRoll) this.dice.position.y = 0.5 + 0.09 * (1 + Math.sin(t * 4));
    else if (this.diceIdle) this.dice.position.y = 0.5;

    // camera easing
    const k = 1 - Math.exp(-dt * 3.5);
    if (this.mode === 'attract') { this.cam.yaw += dt * 0.16; this.goal.yaw = this.cam.yaw; }
    else this.cam.yaw += wrapAngle(this.goal.yaw - this.cam.yaw) * k;
    this.cam.tilt += (this.goal.tilt - this.cam.tilt) * k;
    this.cam.dist += (this.goal.dist - this.cam.dist) * k;
    this._placeCamera(this.cam.yaw, this.cam.tilt, this.cam.dist);
  }

  // ---- camera ---------------------------------------------------------------------------
  _placeCamera(yaw, tilt, dist) {
    const c = this.camera;
    c.position.set(Math.sin(yaw) * Math.cos(tilt) * dist, Math.sin(tilt) * dist, Math.cos(yaw) * Math.cos(tilt) * dist);
    c.lookAt(0, 0, 0);
  }

  /** Smallest camera distance at which the whole board fits inside the free screen area. */
  _fitDist(yaw, tilt) {
    const { W, H, insets: n } = this, c = this.camera;
    if (!W || !H) return 30;
    c.clearViewOffset(); c.aspect = W / H; c.updateProjectionMatrix();
    const fw = Math.max(80, W - n.left - n.right), fh = Math.max(80, H - n.top - n.bottom);
    const padX = Math.max(8, fw * 0.015), padY = Math.max(8, fh * 0.015);
    const pts = [[-7.8, 0, -7.8], [7.8, 0, -7.8], [7.8, 0, 7.8], [-7.8, 0, 7.8], [-7.8, 1, -7.8], [7.8, 1, -7.8], [7.8, 1, 7.8], [-7.8, 1, 7.8]];
    let lo = 8, hi = 120;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      this._placeCamera(yaw, tilt, mid); c.updateMatrixWorld(true);
      let ok = true;
      for (const p of pts) {
        const v = this._v.set(p[0], p[1], p[2]).project(c);
        if (Math.abs(v.x * W / 2) > fw / 2 - padX || Math.abs(v.y * H / 2) > fh / 2 - padY) { ok = false; break; }
      }
      if (ok) hi = mid; else lo = mid;
    }
    return hi;
  }

  _applyViewOffset() {
    const { W, H, insets: n } = this;
    if (!W || !H) return;
    this.camera.setViewOffset(W, H, -(n.left - n.right) / 2, -(n.top - n.bottom) / 2, W, H);
  }

  _refit(snap = false) {
    const tilt = this.view === 'top' ? 1.36 : 0.95;
    const yaw = this.mode === 'attract' ? PI / 4 : this.playYaw;
    this.goal.tilt = tilt; this.goal.dist = this._fitDist(yaw, tilt);
    if (this.mode !== 'attract') this.goal.yaw = this.playYaw;
    if (snap) { this.cam.tilt = this.goal.tilt; this.cam.dist = this.goal.dist; if (this.mode !== 'attract') this.cam.yaw = this.goal.yaw; }
    this._applyViewOffset();
  }

  setInsets(ins) { this.insets = { top: 0, bottom: 0, left: 0, right: 0, ...ins }; this._refit(); }
  setMode(mode, { yaw, view } = {}) {
    this.mode = mode;
    if (yaw != null) this.playYaw = yaw;
    if (view) this.view = view;
    this._refit();
  }
  setView(view) { this.view = view; this._refit(); }

  resize(w, h) {
    this.W = w; this.H = h;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._refit(true);
  }

  setPixelRatio(pr) { this.pr = Math.max(1, Math.min(pr, this.q.maxPR)); this.renderer.setPixelRatio(this.pr); this.renderer.setSize(this.W, this.H, false); }

  project(x, y, z) {
    const v = this._v.set(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.W, y: (-v.y * 0.5 + 0.5) * this.H };
  }

  /** Tap picking in canvas CSS pixels. Generous radii: fingers are bigger than pawns. */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best = null, bd = 54;
    for (const tk of this.tokens) {
      if (!tk.movable) continue;
      const p = this.project(tk.cur.x, 0.45, tk.cur.z), d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = { type: 'token', seat: tk.seat, token: tk.token }; }
    }
    if (!best && this.awaitRoll) {
      const p = this.project(0, 0.5, 0);
      if (Math.hypot(p.x - x, p.y - y) < 70) best = { type: 'dice' };
    }
    return best;
  }

  // ---- loop -----------------------------------------------------------------------------
  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (this.lost) return;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      if (this.onFrame) this.onFrame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
}
