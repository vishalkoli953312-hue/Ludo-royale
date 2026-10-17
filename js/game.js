// Match controller: connects the rules engine to rendering, effects, audio, UI and earnings.

import { COLORS, SEAT_LAYOUTS } from './config.js';
import { createGame, roll, applyMove } from './logic.js';
import { chooseMove } from './ai.js';
import { tierById, prizeFor } from './earnings.js';
import { readJSON, writeJSON } from './storage.js';

const SESSION_KEY = 'ludo-royale:session:v1';
const PLAYER_YAW = -Math.PI / 2;               // Ruby base sits bottom-left from the player's seat
const SPEED = Number(window.__LUDO_SPEED__) || 1; // test hook: compress waiting time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));

export class GameController {
  constructor({ renderer, fx, audio, ui, earnings, settings, storage }) {
    Object.assign(this, { renderer, fx, audio, ui, earnings, settings, storage });
    this.gen = 0; this.state = null; this.meta = null; this.tier = null;
    this.paused = false; this.resumeFns = []; this.rollWaiter = null; this.tokenWaiter = null;
    this.rng = Math.random;
  }

  // ---- session persistence -------------------------------------------------------------
  hasSession() {
    const s = readJSON(this.storage, SESSION_KEY, null), m = this.earnings.match;
    return !!(s && s.state && s.meta && m && s.meta.matchId === m.id && s.state.phase === 'roll');
  }
  _save() { if (this.state && this.state.phase === 'roll') writeJSON(this.storage, SESSION_KEY, { state: this.state, meta: this.meta }); }
  _clearSession() { this.storage.remove(SESSION_KEY); }

  // ---- lifecycle -----------------------------------------------------------------------
  newMatch({ tierId, opponents, skill }) {
    const tier = tierById(tierId), players = opponents + 1;
    const seats = SEAT_LAYOUTS[opponents].map((player, i) => ({ player, kind: i === 0 ? 'human' : 'cpu', name: i === 0 ? 'You' : COLORS[player].name }));
    const match = this.earnings.startMatch(tier, players); // throws if the player cannot afford it
    this._begin(createGame(seats), { tierId, opponents, skill, matchId: match.id });
  }

  resume() {
    const s = readJSON(this.storage, SESSION_KEY, null);
    if (!this.hasSession()) { this._clearSession(); return false; }
    this._begin(s.state, s.meta); return true;
  }

  _begin(state, meta) {
    this.cancel();
    this.state = state; this.meta = meta; this.tier = tierById(meta.tierId);
    const { renderer, ui } = this;
    renderer.setTokens(state);
    renderer.setMode('play', { yaw: PLAYER_YAW, view: this.settings.view });
    renderer.setMovable([]); renderer.setAwaitRoll(false);
    ui.hideLobby(); ui.showHud();
    ui.setPrize(prizeFor(this.tier, state.seats.length), !this.tier.entry);
    ui.setSeats(state); ui.setRoll(false, 'Roll dice'); ui.setStatus('');
    this._save();
    this._loop(this.gen);
  }

  cancel() {
    this.gen++;
    this.paused = false; this.resumeFns.splice(0).forEach((f) => f());
    if (this.rollWaiter) { this.rollWaiter(); this.rollWaiter = null; }
    if (this.tokenWaiter) { this.tokenWaiter.resolve(null); this.tokenWaiter = null; }
  }

  toLobby() {
    this.cancel(); this.state = null;
    const { renderer, ui } = this;
    renderer.setMovable([]); renderer.setAwaitRoll(false); renderer.setTurn(null);
    renderer.setTokens(null); renderer.setMode('attract');
    ui.hideHud(); ui.showLobby(false);
  }

  quit() { this.earnings.forfeit(); this._clearSession(); this.toLobby(); }

  setPaused(p) {
    this.paused = p;
    if (!p) this.resumeFns.splice(0).forEach((f) => f());
  }
  _gate() { return this.paused ? new Promise((r) => this.resumeFns.push(r)) : Promise.resolve(); }

  // ---- input ---------------------------------------------------------------------------
  requestRoll() { if (this.rollWaiter) { const f = this.rollWaiter; this.rollWaiter = null; f(); } }
  requestToken(pick) {
    const w = this.tokenWaiter;
    if (!w || pick.seat !== this.state.turn || !w.moves.some((m) => m.token === pick.token)) return;
    this.tokenWaiter = null; w.resolve(pick.token);
  }
  _waitRoll() { return new Promise((r) => { this.rollWaiter = r; }); }
  _waitToken(moves) { return new Promise((resolve) => { this.tokenWaiter = { moves, resolve }; }); }

  // ---- turn loop -----------------------------------------------------------------------
  async _loop(gen) {
    const alive = () => gen === this.gen;
    const { state, renderer, ui, audio } = this;
    while (alive() && state.phase !== 'over') {
      await this._gate(); if (!alive()) return;
      const seatIdx = state.turn, seat = state.seats[seatIdx], human = seat.kind === 'human';
      ui.setActive(seatIdx); renderer.setTurn(seat.player);

      if (human) {
        audio.turn(); ui.setStatus('Your turn. Roll the dice.'); ui.setRoll(true, 'Roll dice');
        renderer.setAwaitRoll(true);
        await this._waitRoll();
        renderer.setAwaitRoll(false); ui.setRoll(false, 'Rolling');
        if (!alive()) return;
      } else {
        ui.setStatus(`${seat.name} is rolling`); ui.setRoll(false, `${seat.name}\u2019s turn`);
        await sleep(750); if (!alive()) return;
      }
      await this._gate(); if (!alive()) return;

      const res = roll(state, this.rng);
      await this._playRoll(res, seat);
      if (!alive()) return;

      if (res.passed) {
        ui.setStatus(res.forfeit ? 'Three sixes in a row. Turn lost.' : `${seat.name} rolled ${res.value}. No move possible.`);
        ui.setActive(state.turn);
        await sleep(1000); this._save(); continue;
      }

      let token;
      const moves = res.moves;
      const same = moves.every((m) => m.from === moves[0].from && m.to === moves[0].to);
      if (!human) { await sleep(520); token = chooseMove(state, moves, this.meta.skill, this.rng); }
      else if (this.settings.assist && (moves.length === 1 || same)) { ui.setStatus(`You rolled ${res.value}`); await sleep(380); token = moves[0].token; }
      else {
        renderer.setMovable(moves.map((m) => ({ seat: seatIdx, token: m.token })));
        ui.setStatus(`You rolled ${res.value}. Tap a pawn to move it.`);
        token = await this._waitToken(moves);
        renderer.setMovable([]);
        if (token == null || !alive()) return;
      }
      await this._gate(); if (!alive()) return;

      const move = applyMove(state, token);
      await this._playMove(move, human);
      if (!alive()) return;
      ui.setSeats(state);
      if (move.won) { await this._finish(move.seat); return; }
      this._save();
    }
  }

  async _playRoll(res, seat) {
    const { renderer, fx, audio, ui } = this, col = COLORS[seat.player].rgb;
    audio.rattle();
    await renderer.rollDice(res.value, seat.player);
    const p = renderer.project(0, 0.5, 0);
    fx.diceRoll(p.x, p.y, col);
    ui.setStatus(`${seat.name} rolled ${res.value}`);
  }

  async _playMove(m, human) {
    const { renderer, fx, audio, state } = this;
    const col = COLORS[state.seats[m.seat].player].rgb;
    const last = m.path.length - 1;
    await renderer.hop(m.seat, m.token, m.from, m.path, (i, p, pos) => {
      audio.hop(i);
      if (i === last || i % 3 === 0) { const s = renderer.project(pos.x, pos.y, pos.z); fx.landing(s.x, s.y, col); }
    });
    if (m.captured.length) {
      for (const v of m.captured) {
        const pos = renderer.tokenWorld(v.seat, v.token);
        if (!pos) continue;
        const s = renderer.project(pos.x, pos.y, pos.z);
        fx.capture(s.x, s.y, col, COLORS[state.seats[v.seat].player].rgb);
        audio.capture();
        if (human) this._award('capture', s);
      }
      await Promise.all(m.captured.map((v) => renderer.sendToBase(v.seat, v.token)));
    }
    if (m.reachedHome) {
      const pos = renderer.tokenWorld(m.seat, m.token);
      if (pos) {
        const s = renderer.project(pos.x, pos.y, pos.z);
        fx.homeArrive(s.x, s.y); audio.home();
        if (human) this._award('home', s);
      }
    }
  }

  _award(kind, screen) {
    const amount = this.earnings.bonus(kind);
    if (amount) { this.fx.text(screen.x, screen.y - 34, `+${amount}`); this.audio.coin(); this.ui.refreshWallet(true); }
  }

  async _finish(winnerSeat) {
    const { state, ui, audio, fx, earnings, tier } = this;
    const winner = state.seats[winnerSeat], won = winner.kind === 'human';
    this._clearSession();
    this.renderer.setMovable([]); this.renderer.setAwaitRoll(false);
    const summary = earnings.settle(won);
    ui.setStatus(won ? 'You win!' : `${winner.name} wins`);
    if (won) { audio.win(); fx.celebrate(); } else audio.lose();
    ui.refreshWallet(true);
    const gen = this.gen;
    await sleep(won ? 2000 : 1100);
    if (gen !== this.gen) return;
    ui.openResult({ won, winnerName: winner.name, winnerRgb: COLORS[winner.player].rgb, summary, tier });
  }
}
