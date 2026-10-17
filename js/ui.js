// DOM layer: lobby, in-game HUD, menus, result and stats sheets. No game rules in here.

import { TIERS, tierById, prizeFor, bonusFor, DAILY_GIFT } from './earnings.js';
import { COLORS } from './config.js';
import { homeCount } from './logic.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '\u2212' : '') + fmt(Math.abs(n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>',
};
const LEDGER_LABEL = { entry: 'Table entry', capture: 'Capture bonus', home: 'Token home', prize: 'Prize', daily: 'Daily gift' };

export class UI {
  constructor({ earnings, settings, saveSettings, audio }) {
    this.e = earnings; this.s = settings; this.saveSettings = saveSettings; this.audio = audio;
    this.h = {}; this.shown = earnings.balance; this.modalOpen = false; this.lastSeatsState = null;
    const ids = ['stage', 'gl', 'fx', 'hud', 'hud-head', 'hud-bottom', 'seats', 'status', 'btn-roll', 'btn-menu', 'prize', 'coins-hud', 'coins-lobby',
      'lobby', 'lobby-top', 'lobby-sheet', 'tables', 'seg-opp', 'seg-skill', 'btn-play', 'btn-resume', 'btn-daily', 'btn-stats', 'btn-sound-lobby',
      'btn-fs-lobby', 'modal-root', 'loading', 'load-bar', 'load-label', 'load-error', 'fps', 'toast'];
    this.el = {};
    ids.forEach((id) => { this.el[id] = $(id); });
    this._bind();
    this.e.subscribe(() => this.refreshWallet(false));
    this.refreshWallet(false);
    this.updateSoundIcons();
    this.updateFullscreenButtons();
  }

  on(name, fn) { this.h[name] = fn; return this; }
  emit(name, ...args) { if (this.h[name]) this.h[name](...args); }

  // ---------------------------------------------------------------- binding
  _bind() {
    const el = this.el;
    el['tables'].addEventListener('click', (ev) => {
      const b = ev.target.closest('.table-row'); if (!b) return;
      if (b.getAttribute('aria-disabled') === 'true') { this.toast('Not enough coins for that table'); return; }
      this.audio.click(); this.s.tier = b.dataset.id; this.saveSettings(); this.renderLobby();
    });
    el['seg-opp'].addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      this.audio.click(); this.s.opponents = Number(b.dataset.v); this.saveSettings(); this.renderLobby();
    });
    el['seg-skill'].addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      this.audio.click(); this.s.skill = b.dataset.v; this.saveSettings(); this.renderLobby();
    });
    el['btn-play'].addEventListener('click', () => { this.audio.click(); this.emit('play', { tierId: this.s.tier, opponents: this.s.opponents, skill: this.s.skill }); });
    el['btn-resume'].addEventListener('click', () => { this.audio.click(); this.emit('resume'); });
    el['btn-daily'].addEventListener('click', () => { this.emit('daily'); });
    el['btn-stats'].addEventListener('click', () => { this.audio.click(); this.openStats(); });
    el['btn-menu'].addEventListener('click', () => { this.audio.click(); this.openMenu(); });
    el['btn-roll'].addEventListener('click', () => this.emit('roll'));
    el['btn-sound-lobby'].addEventListener('click', () => this.toggleSound());
    el['btn-fs-lobby'].addEventListener('click', () => this.toggleFullscreen());
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((n) => document.addEventListener(n, () => { this.updateFullscreenButtons(); this.emit('layout'); }));
  }

  // ---------------------------------------------------------------- loading
  setLoading(p, label) {
    this.el['load-bar'].style.transform = `scaleX(${Math.max(0.03, p)})`;
    if (label) this.el['load-label'].textContent = label;
  }
  hideLoading() { this.el['loading'].classList.add('done'); setTimeout(() => { this.el['loading'].hidden = true; }, 500); }
  showFatal(html) {
    this.el['loading'].hidden = false; this.el['loading'].classList.remove('done');
    this.el['load-label'].textContent = '';
    const box = this.el['load-error']; box.hidden = false;
    box.innerHTML = `${html}<button class="primary" id="btn-retry">Try again</button>`;
    $('btn-retry').addEventListener('click', () => location.reload());
  }

  // ---------------------------------------------------------------- lobby
  showLobby(hasSession) { this.el['hud'].hidden = true; this.el['lobby'].hidden = false; this.renderLobby(hasSession); this.emit('layout'); }
  hideLobby() { this.el['lobby'].hidden = true; }

  renderLobby(hasSession) {
    if (hasSession !== undefined) this._hasSession = hasSession;
    const e = this.e, s = this.s;
    if (!e.canAfford(tierById(s.tier).entry)) s.tier = 'practice';
    const players = s.opponents + 1;
    this.el['tables'].innerHTML = TIERS.map((t) => {
      const ok = e.canAfford(t.entry), on = t.id === s.tier;
      const sub = t.entry ? `Entry ${fmt(t.entry)} coins` : 'No entry fee';
      const win = t.entry ? `Win ${fmt(prizeFor(t, players))}` : 'For fun';
      return `<button class="table-row" role="radio" data-id="${t.id}" aria-checked="${on}" aria-disabled="${!ok}">
        <span><span class="name">${t.name}</span><span class="sub">${ok ? sub : 'Not enough coins'}</span></span>
        <span class="win">${win}</span></button>`;
    }).join('');
    const mark = (seg, val) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(val))));
    mark(this.el['seg-opp'], s.opponents); mark(this.el['seg-skill'], s.skill);
    const t = tierById(s.tier);
    this.el['btn-play'].textContent = t.entry ? `Play for ${fmt(t.entry)} coins` : 'Play practice';
    this.el['btn-daily'].hidden = !e.dailyAvailable();
    this.el['btn-daily'].textContent = `Free ${DAILY_GIFT} coins`;
    this.el['btn-resume'].hidden = !this._hasSession;
    this.refreshWallet(false);
  }

  // ---------------------------------------------------------------- HUD
  showHud() { this.el['lobby'].hidden = true; this.el['hud'].hidden = false; this.emit('layout'); }
  hideHud() { this.el['hud'].hidden = true; }
  setStatus(t) { this.el['status'].textContent = t; }
  setRoll(enabled, label) { const b = this.el['btn-roll']; b.disabled = !enabled; if (label) b.textContent = label; }
  setPrize(n, free) { this.el['prize'].textContent = free ? 'Practice' : fmt(n); this.el['prize'].parentElement.classList.toggle('free', !!free); }

  setSeats(state) {
    this.lastSeatsState = state;
    this.el['seats'].innerHTML = state.seats.map((seat, i) => {
      const c = COLORS[seat.player], n = homeCount(seat);
      const pips = [0, 1, 2, 3].map((k) => `<i class="pip${k < n ? ' on' : ''}"></i>`).join('');
      return `<li class="seat${i === state.turn ? ' active' : ''}" style="--c:${c.css}" data-i="${i}" aria-label="${esc(seat.name)}, ${n} of 4 pawns home">
        <span class="who"><i class="dot"></i>${esc(seat.name)}</span><span class="pips">${pips}</span></li>`;
    }).join('');
  }
  setActive(idx) { this.el['seats'].querySelectorAll('.seat').forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === idx)); }

  // ---------------------------------------------------------------- wallet
  refreshWallet(animate) {
    const to = this.e.balance, els = [this.el['coins-hud'], this.el['coins-lobby']];
    if (!animate || to === this.shown) { els.forEach((x) => { x.textContent = fmt(to); }); this.shown = to; return; }
    const from = this.shown, t0 = performance.now();
    this.shown = to;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 650), v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      els.forEach((x) => { x.textContent = fmt(v); });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  toast(msg) {
    const t = this.el['toast']; t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- sound / fullscreen
  toggleSound() {
    this.s.sound = !this.s.sound; this.saveSettings(); this.audio.setMuted(!this.s.sound);
    this.audio.unlock(); this.audio.click(); this.updateSoundIcons();
  }
  updateSoundIcons() { const b = this.el['btn-sound-lobby']; b.innerHTML = this.s.sound ? ICON.soundOn : ICON.soundOff; b.setAttribute('aria-label', this.s.sound ? 'Mute sound' : 'Turn sound on'); }

  get fsSupported() { const d = document.documentElement; return !!(d.requestFullscreen || d.webkitRequestFullscreen); }
  get standalone() { return (window.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) || window.navigator.standalone === true; }
  get isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  toggleFullscreen() {
    const d = document.documentElement;
    try {
      if (this.isFullscreen) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (this.fsSupported) {
        const p = (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => this.toast('Full screen was blocked by the browser'));
      } else this.toast('On iPhone: tap Share, then Add to Home Screen for full screen');
    } catch { this.toast('Full screen is not available here'); }
  }
  updateFullscreenButtons() { this.el['btn-fs-lobby'].hidden = this.standalone; this.el['btn-fs-lobby'].setAttribute('aria-pressed', String(this.isFullscreen)); }

  // ---------------------------------------------------------------- layout insets for the 3D camera
  getInsets() {
    const W = innerWidth, H = innerHeight, ins = { top: 0, bottom: 0, left: 0, right: 0 };
    const add = (node) => {
      if (!node || node.closest('[hidden]')) return;
      const r = node.getBoundingClientRect(); if (!r.width || !r.height) return;
      if (r.width > W * 0.6) { if (r.top + r.height / 2 < H / 2) ins.top = Math.max(ins.top, r.bottom); else ins.bottom = Math.max(ins.bottom, H - r.top); }
      else if (r.left + r.width / 2 < W / 2) ins.left = Math.max(ins.left, r.right); else ins.right = Math.max(ins.right, W - r.left);
    };
    if (!this.el['lobby'].hidden) { add(this.el['lobby-top']); add(this.el['lobby-sheet']); }
    if (!this.el['hud'].hidden) { add(this.el['hud-head']); add(this.el['hud-bottom']); }
    return ins;
  }

  // ---------------------------------------------------------------- modals
  _modal(html, { dismiss = true, onClose } = {}) {
    const root = this.el['modal-root'];
    root.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    const scrim = root.firstElementChild;
    this.modalOpen = true; this._onClose = onClose;
    if (dismiss) scrim.addEventListener('pointerdown', (ev) => { if (ev.target === scrim) this.closeModal(); });
    const first = root.querySelector('button'); if (first) first.focus({ preventScroll: true });
    return root.querySelector('.sheet');
  }
  closeModal(silent) {
    this.el['modal-root'].innerHTML = ''; this.modalOpen = false;
    const f = this._onClose; this._onClose = null; if (f && !silent) f();
  }

  openMenu() {
    this.emit('pause', true);
    const draw = () => {
      const s = this.s, fs = this.fsSupported && !this.standalone;
      const sheet = this._modal(`
        <h2>Paused</h2>
        <button class="row-btn" data-a="resume"><span>Back to the game</span></button>
        <button class="row-btn" data-a="sound"><span>Sound</span><span class="val">${s.sound ? 'On' : 'Off'}</span></button>
        <button class="row-btn" data-a="view"><span>Camera</span><span class="val">${s.view === 'top' ? 'Top-down' : 'Tilted'}</span></button>
        <button class="row-btn" data-a="assist"><span>Auto-move when there is one choice</span><span class="val">${s.assist ? 'On' : 'Off'}</span></button>
        ${fs ? `<button class="row-btn" data-a="fs"><span>Full screen</span><span class="val">${this.isFullscreen ? 'On' : 'Off'}</span></button>` : ''}
        ${!this.fsSupported && !this.standalone ? '<p class="hint">iPhone tip: tap Share, then Add to Home Screen, to play in full screen.</p>' : ''}
        <button class="row-btn" data-a="fps"><span>Show frame rate</span><span class="val">${s.fps ? 'On' : 'Off'}</span></button>
        <button class="row-btn danger" data-a="quit"><span>Leave match</span></button>`,
      { onClose: () => this.emit('pause', false) });
      sheet.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a; this.audio.click();
        if (a === 'resume') this.closeModal();
        else if (a === 'sound') { this.toggleSound(); draw(); }
        else if (a === 'view') { s.view = s.view === 'top' ? 'tilt' : 'top'; this.saveSettings(); this.emit('view', s.view); draw(); }
        else if (a === 'assist') { s.assist = !s.assist; this.saveSettings(); draw(); }
        else if (a === 'fs') { this.toggleFullscreen(); setTimeout(draw, 250); }
        else if (a === 'fps') { s.fps = !s.fps; this.saveSettings(); this.el['fps'].hidden = !s.fps; draw(); }
        else if (a === 'quit') {
          const m = this.e.match, loses = m && m.entry > 0;
          const ok = await this.confirm('Leave this match?', loses ? `You will lose your ${fmt(m.entry)} coin entry.` : 'Your progress in this practice game will be lost.', 'Leave match');
          if (ok) { this.closeModal(true); this.emit('pause', false); this.emit('quit'); } else draw();
        }
      });
    };
    draw();
  }

  confirm(title, text, okLabel = 'Yes') {
    return new Promise((resolve) => {
      const sheet = this._modal(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p>
        <div class="btn-row"><button class="ghost" data-a="no">Keep playing</button><button class="primary danger-fill" data-a="yes">${esc(okLabel)}</button></div>`, { dismiss: false });
      sheet.addEventListener('click', (ev) => { const b = ev.target.closest('[data-a]'); if (b) resolve(b.dataset.a === 'yes'); });
    });
  }

  openResult({ won, winnerName, winnerRgb, summary, tier }) {
    const rows = [];
    const row = (label, val, cls = '') => rows.push(`<div class="brk ${cls}"><span>${label}</span><b>${val}</b></div>`);
    const paid = summary && (summary.entry > 0 || summary.prize > 0 || summary.bonus > 0);
    if (paid) {
      if (summary.entry) row('Table entry', signed(-summary.entry), 'neg');
      if (summary.captures) row(`Captures (${summary.captures})`, summary.bonus ? signed(summary.captures * bonusFor(tier).capture) : '0');
      if (summary.home) row(`Pawns home (${summary.home})`, signed(summary.home * bonusFor(tier).home));
      if (summary.prize) row('Prize', signed(summary.prize), 'pos');
      row('Net result', signed(summary.net), 'net ' + (summary.net >= 0 ? 'pos' : 'neg'));
    }
    const canAgain = this.e.canAfford(tier.entry);
    const sheet = this._modal(`
      <h2 class="result-title" style="--c:rgb(${winnerRgb.join(',')})">${won ? 'You won' : `${esc(winnerName)} won`}</h2>
      <p class="lead">${won ? (summary.prize ? `The pot of ${fmt(summary.prize)} coins is yours.` : 'Nice game. Try a paid table when you are ready.')
        : (summary.entry ? 'Better luck next game. Your entry went into the pot.' : 'Good game. Practice tables are free, so go again.')}</p>
      ${rows.length ? `<div class="breakdown">${rows.join('')}</div>` : ''}
      <div class="btn-row"><button class="ghost" data-a="lobby">Tables</button>
      <button class="primary" data-a="again" ${canAgain ? '' : 'disabled'}>${canAgain ? 'Play again' : 'Not enough coins'}</button></div>`, { dismiss: false });
    sheet.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-a]'); if (!b || b.disabled) return;
      this.audio.click(); this.closeModal(true); this.emit(b.dataset.a === 'again' ? 'again' : 'lobby');
    });
  }

  openStats() {
    const st = this.e.state, rate = st.games ? Math.round((st.wins / st.games) * 100) : 0, net = st.earned - st.spent;
    const tile = (label, val) => `<div class="stat"><b>${val}</b><span>${label}</span></div>`;
    const when = (t) => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
    const ledger = st.ledger.slice().reverse().slice(0, 40).map((l) =>
      `<li><span><b>${LEDGER_LABEL[l.type] || esc(l.type)}</b><small>${esc(when(l.t))}</small></span><span class="amt ${l.amount >= 0 ? 'pos' : 'neg'}">${signed(l.amount)}<small>${fmt(l.balance)}</small></span></li>`).join('');
    const sheet = this._modal(`
      <h2>Your coins</h2>
      <div class="stats">${tile('Balance', fmt(st.balance))}${tile('Net profit', signed(net))}${tile('Games', fmt(st.games))}
        ${tile('Win rate', rate + '%')}${tile('Best win', fmt(st.bestWin))}${tile('Captures', fmt(st.captures))}
        ${tile('Pawns home', fmt(st.tokensHome))}${tile('Total earned', fmt(st.earned))}${tile('Total spent', fmt(st.spent))}</div>
      <h3>Recent activity</h3>
      ${ledger ? `<ul class="ledger">${ledger}</ul>` : '<p class="hint">Nothing yet. Play a match and it shows up here.</p>'}
      <p class="hint">Coins are an in-app currency with no cash value. They are saved on this device only.</p>
      <div class="btn-row"><button class="ghost danger" data-a="reset">Reset coins</button><button class="primary" data-a="close">Close</button></div>`);
    sheet.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      this.audio.click();
      if (b.dataset.a === 'close') this.closeModal();
      else if (b.dataset.a === 'reset') {
        const ok = await this.confirm('Reset your coins?', `Balance returns to 1,000 and all statistics are cleared.`, 'Reset');
        if (ok) { this.emit('reset'); this.closeModal(); this.renderLobby(); } else this.openStats();
      }
    });
  }
}
