// 2D overlay effects drawn on a transparent <canvas> above the 3D scene.
//
// The signature effect is a wave-interference field: each event emits expanding ring waves and the
// canvas sums the overlapping waves per pixel, so where two rings cross you see constructive
// (bright) and destructive (dark) fringes. Particles, shock rings and floating text sit on top.

const TAU = Math.PI * 2;

export class FX2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.sources = []; this.parts = []; this.rings = []; this.texts = [];
    this.cs = 7;                      // interference grid cell size in CSS px (quality knob)
    this.field = document.createElement('canvas');
    this.fctx = this.field.getContext('2d');
    this.img = null; this.gw = 0; this.gh = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.dirty = false;
    this.shakeT = 0; this.onShake = null;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = Math.min(dpr || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this._grid();
  }

  /** 0 = lowest, 1 = highest. Larger cells = fewer pixels to evaluate per frame. */
  setQuality(q) { this.cs = q >= 1 ? 7 : q >= 0.5 ? 10 : 14; this._grid(); }

  _grid() {
    if (!this.w) return;
    this.gw = Math.max(1, Math.ceil(this.w / this.cs));
    this.gh = Math.max(1, Math.ceil(this.h / this.cs));
    this.field.width = this.gw; this.field.height = this.gh;
    this.img = this.fctx.createImageData(this.gw, this.gh);
  }

  get active() { return this.sources.length + this.parts.length + this.rings.length + this.texts.length > 0; }

  // ---- emitters -------------------------------------------------------------------------
  ripple(x, y, o = {}) {
    const k = this.reduced ? 0.5 : 1;
    if (this.sources.length >= 7) this.sources.shift();
    this.sources.push({
      x, y, age: 0, life: o.life ?? 1.8, speed: o.speed ?? 200, wl: o.wavelength ?? 34,
      amp: (o.amp ?? 1) * k, col: o.color || [255, 210, 120],
    });
  }

  burst(x, y, o = {}) {
    const n = Math.round((o.count ?? 24) * (this.reduced ? 0.4 : 1));
    const col = o.color || [255, 220, 140];
    for (let i = 0; i < n && this.parts.length < 420; i++) {
      const a = Math.random() * TAU, v = (o.speed ?? 220) * (0.35 + Math.random() * 0.75);
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.lift ?? 40), g: o.gravity ?? 380, drag: 1.6,
        life: 0, max: (o.life ?? 0.9) * (0.6 + Math.random() * 0.7), size: (o.size ?? 3) * (0.6 + Math.random()),
        col, kind: 'spark',
      });
    }
  }

  confetti(x, y, count = 60) {
    const cols = [[255, 110, 130], [90, 240, 160], [255, 215, 90], [110, 170, 255], [255, 255, 255]];
    const n = Math.round(count * (this.reduced ? 0.3 : 1));
    for (let i = 0; i < n && this.parts.length < 420; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 260 + Math.random() * 380;
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 520, drag: 1.1, life: 0, max: 1.8 + Math.random() * 1.2,
        size: 5 + Math.random() * 5, col: cols[i % cols.length], kind: 'confetti', rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  ring(x, y, col = [255, 255, 255], maxR = 120, life = 0.55) { this.rings.push({ x, y, age: 0, life, maxR, col }); }

  text(x, y, str, col = '#ffd36b') { this.texts.push({ x, y, str, age: 0, life: 1.3, col }); }

  shake(ms = 260) { if (!this.reduced) { this.shakeT = ms / 1000; } }

  // ---- composed effects -----------------------------------------------------------------
  landing(x, y, rgb) {
    this.ripple(x, y, { color: rgb, amp: 0.75, life: 1.1, speed: 190, wavelength: 28 });
    this.burst(x, y, { color: rgb, count: 6, speed: 90, gravity: 120, life: 0.45, size: 2.2 });
  }
  diceRoll(x, y, rgb) {
    this.ripple(x - 26, y + 6, { color: rgb, amp: 1, life: 1.9, speed: 230, wavelength: 30 });
    this.ripple(x + 26, y - 6, { color: [255, 235, 190], amp: 1, life: 1.9, speed: 230, wavelength: 30 });
    this.ring(x, y, rgb, 140, 0.7);
  }
  capture(x, y, rgb, victimRgb) {
    this.ripple(x, y, { color: rgb, amp: 1.1, life: 1.4, speed: 260, wavelength: 34 });
    this.ripple(x + 18, y - 10, { color: victimRgb || [255, 255, 255], amp: 1.1, life: 1.8, speed: 300, wavelength: 26 });
    this.ring(x, y, [255, 255, 255], 150, 0.6);
    this.burst(x, y, { color: victimRgb || rgb, count: 40, speed: 330, life: 1.0, size: 3.2 });
    this.shake(300);
  }
  homeArrive(x, y) {
    const gold = [255, 214, 110];
    this.ripple(x, y, { color: gold, amp: 1.2, life: 1.5, speed: 230, wavelength: 32 });
    this.ring(x, y, gold, 130, 0.7);
    this.burst(x, y, { color: gold, count: 48, speed: 300, life: 1.2, size: 3.4 });
  }
  celebrate() {
    const { w, h } = this;
    const cols = [[255, 110, 130], [90, 240, 160], [255, 215, 90], [110, 170, 255]];
    for (let i = 0; i < 4; i++) this.ripple(w * (0.2 + 0.2 * i), h * (0.35 + 0.1 * (i % 2)), { color: cols[i], amp: 1.1, life: 2.6, speed: 240, wavelength: 40 });
    this.confetti(w * 0.25, h * 0.75, 50); this.confetti(w * 0.75, h * 0.75, 50);
  }

  // ---- frame ----------------------------------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 0.05);
    for (let i = this.sources.length - 1; i >= 0; i--) { const s = this.sources[i]; s.age += dt; if (s.age >= s.life) this.sources.splice(i, 1); }
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.age += dt; if (r.age >= r.life) this.rings.splice(i, 1); }
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.age += dt; t.y -= 38 * dt; if (t.age >= t.life) this.texts.splice(i, 1); }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.life += dt;
      if (p.life >= p.max) { this.parts.splice(i, 1); continue; }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vy = p.vy * damp + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'confetti') p.rot += p.vr * dt;
    }
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      if (this.onShake) {
        const m = this.shakeT * 22;
        this.onShake(this.shakeT > 0 ? (Math.random() - 0.5) * m : 0, this.shakeT > 0 ? (Math.random() - 0.5) * m : 0);
      }
    }
  }

  render() {
    const ctx = this.ctx;
    if (!this.active) {
      if (this.dirty) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.dirty = false; }
      return;
    }
    this.dirty = true;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.sources.length) this._drawField();
    this._drawRings();
    this._drawParticles();
    this._drawTexts();
  }

  _drawField() {
    const { gw, gh, cs, img, sources } = this;
    const d = img.data, n = sources.length;
    const S = sources.map((s) => {
      const t = s.age / s.life, w = s.wl * 1.25, R = s.speed * s.age;
      return { x: s.x, y: s.y, R, w, w2: w * w, lim: w * 2.6, out2: (R + w * 2.6) * (R + w * 2.6), in2: R > w * 2.6 ? (R - w * 2.6) * (R - w * 2.6) : -1, k: TAU / s.wl, fade: s.amp * Math.pow(1 - t, 1.8) * Math.max(0, 1 - R / 300) * Math.min(1, s.age * 12), c: s.col };
    });
    for (let gy = 0; gy < gh; gy++) {
      const py = (gy + 0.5) * cs;
      for (let gx = 0; gx < gw; gx++) {
        const px = (gx + 0.5) * cs;
        let sum = 0, cr = 0, cg = 0, cb = 0, ws = 0;
        for (let i = 0; i < n; i++) {
          const s = S[i], dx = px - s.x, dy = py - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > s.out2 || d2 < s.in2) continue;
          const dr = Math.sqrt(d2) - s.R;
          if (dr > s.lim || dr < -s.lim) continue;
          const env = Math.exp(-(dr * dr) / s.w2) * s.fade;
          sum += Math.cos(s.k * dr) * env;
          cr += s.c[0] * env; cg += s.c[1] * env; cb += s.c[2] * env; ws += env;
        }
        const idx = (gy * gw + gx) * 4;
        if (ws < 0.004) { d[idx + 3] = 0; continue; }
        const I = Math.min(1, Math.abs(sum));
        const boost = I * I * I * 0.4;
        cr /= ws; cg /= ws; cb /= ws;
        d[idx] = Math.min(255, cr + (255 - cr) * boost);
        d[idx + 1] = Math.min(255, cg + (255 - cg) * boost);
        d[idx + 2] = Math.min(255, cb + (255 - cb) * boost);
        d[idx + 3] = Math.min(255, Math.pow(I, 1.1) * 150);
      }
    }
    this.fctx.putImageData(img, 0, 0);
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.field, 0, 0, gw * cs, gh * cs);
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawRings() {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const t = r.age / r.life, e = 1 - Math.pow(1 - t, 3);
      ctx.strokeStyle = `rgba(${r.col[0]},${r.col[1]},${r.col[2]},${(1 - t) * 0.9})`;
      ctx.lineWidth = Math.max(0.5, 7 * (1 - t));
      ctx.beginPath(); ctx.arc(r.x, r.y, r.maxR * e, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawParticles() {
    const ctx = this.ctx;
    for (const p of this.parts) {
      const a = Math.max(0, 1 - p.life / p.max);
      if (p.kind === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${Math.min(1, a * 1.6)})`;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  _drawTexts() {
    const ctx = this.ctx;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    for (const t of this.texts) {
      const k = t.age / t.life, a = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
      ctx.globalAlpha = Math.max(0, a);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,20,24,0.85)'; ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.col; ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
