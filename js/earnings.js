// Virtual-coin economy: entry fees, bonuses, prizes, daily gift, lifetime stats, ledger.
// All amounts are integers. Persisted through an injected storage (localStorage in the browser).
// Coins are an in-app currency only: they have no cash value and cannot be withdrawn.

import { readJSON, writeJSON } from './storage.js';

export const STORE_KEY = 'ludo-royale:wallet:v1';
export const START_BALANCE = 1000;
export const DAILY_GIFT = 250;
export const LEDGER_MAX = 100;

export const TIERS = [
  { id: 'practice', name: 'Practice table', entry: 0 },
  { id: 'bronze',   name: 'Bronze table',   entry: 100 },
  { id: 'silver',   name: 'Silver table',   entry: 500 },
  { id: 'gold',     name: 'Gold table',     entry: 2000 },
];

export const tierById = (id) => TIERS.find((t) => t.id === id) || TIERS[0];
export const prizeFor = (tier, players) => tier.entry * players;
export function bonusFor(tier) {
  if (!tier.entry) return { capture: 0, home: 0 };
  return {
    capture: Math.max(5, Math.round(tier.entry * 0.05)),
    home: Math.max(10, Math.round(tier.entry * 0.1)),
  };
}

const int = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);

function defaults() {
  return {
    v: 1, balance: START_BALANCE, earned: 0, spent: 0, games: 0, wins: 0, bestWin: 0,
    captures: 0, tokensHome: 0, lastDaily: '', ledger: [], match: null,
  };
}

function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const s = {
    v: 1,
    balance: int(raw.balance, d.balance), earned: int(raw.earned), spent: int(raw.spent),
    games: int(raw.games), wins: int(raw.wins), bestWin: int(raw.bestWin),
    captures: int(raw.captures), tokensHome: int(raw.tokensHome),
    lastDaily: typeof raw.lastDaily === 'string' ? raw.lastDaily : '',
    ledger: Array.isArray(raw.ledger) ? raw.ledger.slice(-LEDGER_MAX).filter((e) => e && Number.isFinite(e.amount)) : [],
    match: null,
  };
  const m = raw.match;
  if (m && typeof m === 'object' && TIERS.some((t) => t.id === m.tierId) && int(m.players, 0) >= 2) {
    s.match = {
      id: String(m.id || ''), tierId: m.tierId, entry: int(m.entry), players: int(m.players),
      bonus: int(m.bonus), captures: int(m.captures), home: int(m.home),
    };
  }
  return s;
}

export class Earnings {
  constructor(storage, now = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.listeners = new Set();
    this.s = sanitize(readJSON(storage, STORE_KEY, null));
  }

  get state() { return JSON.parse(JSON.stringify(this.s)); }
  get balance() { return this.s.balance; }
  get match() { return this.s.match ? { ...this.s.match } : null; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _save() {
    writeJSON(this.storage, STORE_KEY, this.s);
    this.listeners.forEach((fn) => fn(this.state));
  }

  _log(type, amount, note = '') {
    this.s.ledger.push({ t: this.now().getTime(), type, amount, balance: this.s.balance, note });
    if (this.s.ledger.length > LEDGER_MAX) this.s.ledger.splice(0, this.s.ledger.length - LEDGER_MAX);
  }

  canAfford(entry) { return this.s.balance >= entry; }

  /** Deducts the entry fee up-front. An unfinished match counts as a loss. */
  startMatch(tier, players) {
    if (this.s.match) this.forfeit(); // never leave an orphaned match behind
    if (!this.canAfford(tier.entry)) throw new Error('Not enough coins');
    this.s.balance -= tier.entry;
    this.s.spent += tier.entry;
    this.s.match = { id: `m${this.now().getTime()}`, tierId: tier.id, entry: tier.entry, players, bonus: 0, captures: 0, home: 0 };
    if (tier.entry) this._log('entry', -tier.entry, tier.name);
    this._save();
    return this.match;
  }

  /** kind: 'capture' | 'home'. Always counts towards stats; pays coins only on paid tables. */
  bonus(kind) {
    const m = this.s.match;
    if (!m) return 0;
    if (kind === 'capture') { m.captures++; this.s.captures++; } else { m.home++; this.s.tokensHome++; }
    const amount = bonusFor(tierById(m.tierId))[kind] || 0;
    if (amount) {
      this.s.balance += amount; this.s.earned += amount; m.bonus += amount;
      this._log(kind === 'capture' ? 'capture' : 'home', amount);
    }
    this._save();
    return amount;
  }

  /** Finish the active match. Returns the settlement summary. */
  settle(won) {
    const m = this.s.match;
    if (!m) return null;
    const prize = won ? prizeFor(tierById(m.tierId), m.players) : 0;
    if (prize) { this.s.balance += prize; this.s.earned += prize; this._log('prize', prize, 'Match won'); }
    this.s.games++;
    const net = prize + m.bonus - m.entry;
    if (won) { this.s.wins++; this.s.bestWin = Math.max(this.s.bestWin, Math.max(0, net)); }
    const summary = { tierId: m.tierId, entry: m.entry, prize, bonus: m.bonus, captures: m.captures, home: m.home, net, won: !!won };
    this.s.match = null;
    this._save();
    return summary;
  }

  forfeit() { return this.settle(false); }

  today() {
    const d = this.now();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  dailyAvailable() { return this.s.lastDaily !== this.today(); }
  claimDaily() {
    if (!this.dailyAvailable()) return 0;
    this.s.lastDaily = this.today();
    this.s.balance += DAILY_GIFT; this.s.earned += DAILY_GIFT;
    this._log('daily', DAILY_GIFT, 'Daily gift');
    this._save();
    return DAILY_GIFT;
  }

  reset() { this.s = defaults(); this._save(); }
}
