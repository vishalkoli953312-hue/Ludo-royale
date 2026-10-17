// Test-only stand-in for Renderer3D so the UI, controller, earnings and 2D effects can be tested
// in headless Chromium without Three.js. Never shipped in index.html.
(() => {
  const SPEED = window.__LUDO_SPEED__ || 1;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
  window.__LUDO_RENDERER__ = class MockRenderer {
    constructor(canvas) { this.canvas = canvas; this.pr = 2; this.q = { maxPR: 2 }; this.tokens = []; this.W = 0; this.H = 0; this.log = []; }
    async init(cb) { cb(0.5, 'mock'); cb(1, 'ready'); }
    start() { const loop = (t) => { this.raf = requestAnimationFrame(loop); const dt = Math.min(0.05, ((t - (this.last || t)) / 1000)); this.last = t; if (this.onFrame) this.onFrame(dt, t); }; this.raf = requestAnimationFrame(loop); }
    stop() { cancelAnimationFrame(this.raf); this.last = 0; }
    resize(w, h) { this.W = w; this.H = h; this.canvas.width = w; this.canvas.height = h; }
    setInsets(i) { this.insets = i; this.log.push(['insets', i]); }
    setMode(m, o) { this.mode = m; this.log.push(['mode', m, o]); }
    setView(v) { this.view = v; }
    setPixelRatio(p) { this.pr = p; }
    setTokens(s) { this.tokens = []; (s ? s.seats : [0, 1, 2, 3].map((p) => ({ tokens: [-1, -1, -1, -1] }))).forEach((seat, si) => seat.tokens.forEach((p, t) => this.tokens.push({ seat: si, token: t, p }))); }
    setMovable(l) { this.movable = l; }
    setAwaitRoll(b) { this.awaitRoll = b; }
    setTurn(p) { this.turn = p; }
    tokenWorld(seat, token) { const tk = this.tokens.find((t) => t.seat === seat && t.token === token); return { x: ((tk ? tk.p : 0) % 15) - 7, y: 0.45, z: (seat * 3) - 4 }; }
    async rollDice() { await wait(300); }
    async hop(seat, token, from, path, onStep) {
      const tk = this.tokens.find((t) => t.seat === seat && t.token === token);
      for (let i = 0; i < path.length; i++) { await wait(60); if (tk) tk.p = path[i]; onStep(i, path[i], this.tokenWorld(seat, token)); }
    }
    async sendToBase(seat, token) { await wait(200); const tk = this.tokens.find((t) => t.seat === seat && t.token === token); if (tk) tk.p = -1; }
    project(x, y, z) { return { x: this.W / 2 + x * (this.W / 17), y: this.H / 2 + z * (this.W / 17) }; }
    pick() { return null; }
  };
})();
