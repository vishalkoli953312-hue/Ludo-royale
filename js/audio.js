// Synthesised sound effects (Web Audio). No audio files, so nothing extra to download or cache.
// The AudioContext is created lazily on the first user gesture (required by iOS/Android).

export class AudioFX {
  constructor() { this.ctx = null; this.master = null; this.muted = false; }

  setMuted(m) { this.muted = !!m; if (this.master) this.master.gain.value = this.muted ? 0 : 0.7; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp); comp.connect(this.ctx.destination);
      } catch { return false; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  _tone(freq, dur, { type = 'sine', vol = 0.25, slide = 0, delay = 0, attack = 0.005 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, { vol = 0.2, freq = 2500, q = 0.8, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  click() { this._tone(620, 0.06, { type: 'triangle', vol: 0.12 }); }
  turn() { this._tone(520, 0.12, { type: 'sine', vol: 0.12 }); this._tone(780, 0.16, { type: 'sine', vol: 0.1, delay: 0.09 }); }
  rattle() {
    for (let i = 0; i < 9; i++) this._noise(0.05, { vol: 0.16, freq: 1800 + Math.random() * 2400, q: 2, delay: i * 0.09 + Math.random() * 0.03 });
    this._tone(110, 0.2, { type: 'sine', vol: 0.25, delay: 0.85 });
  }
  hop(i = 0) { this._tone(340 + Math.min(i, 8) * 28, 0.09, { type: 'triangle', vol: 0.16, slide: 60 }); }
  capture() {
    this._tone(420, 0.35, { type: 'sawtooth', vol: 0.16, slide: -330 });
    this._noise(0.25, { vol: 0.22, freq: 900, q: 0.6 });
  }
  home() { [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.22, { type: 'triangle', vol: 0.15, delay: i * 0.07 })); }
  coin() { this._tone(1320, 0.07, { type: 'square', vol: 0.06 }); this._tone(1980, 0.18, { type: 'square', vol: 0.06, delay: 0.06 }); }
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this._tone(f, 0.3, { type: 'triangle', vol: 0.17, delay: i * 0.11 })); }
  lose() { [392, 330, 262].forEach((f, i) => this._tone(f, 0.35, { type: 'sine', vol: 0.15, delay: i * 0.18 })); }
}
