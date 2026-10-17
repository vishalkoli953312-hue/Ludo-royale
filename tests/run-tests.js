// Run with:  node tests/run-tests.js   (Node 18+, no dependencies)
import assert from 'node:assert/strict';
import { LOOP, HOME_COLUMNS, START_INDEX, SAFE_LOOP, gridPos, LOOP_LEN } from '../js/config.js';
import { createGame, roll, applyMove, legalMoves, captureTargets, mulberry32, homeCount } from '../js/logic.js';
import { chooseMove } from '../js/ai.js';
import { Earnings, TIERS, tierById, prizeFor, bonusFor, START_BALANCE, DAILY_GIFT, STORE_KEY } from '../js/earnings.js';
import { MemoryStorage } from '../js/storage.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const seats4 = () => [0, 1, 2, 3].map((p) => ({ player: p, kind: p ? 'cpu' : 'human', name: 'P' + p }));
const rigged = (...vals) => { let i = 0; return () => (vals[i++ % vals.length] - 1 + 0.5) / 6; };

console.log('Board geometry');
test('loop has 52 unique cells', () => {
  assert.equal(LOOP.length, 52);
  assert.equal(new Set(LOOP.map((c) => c.join(','))).size, 52);
});
test('loop is a closed ring: orthogonal steps plus the 4 diagonal inner corners', () => {
  let diagonals = 0;
  for (let i = 0; i < 52; i++) {
    const a = LOOP[i], b = LOOP[(i + 1) % 52];
    const dc = Math.abs(a[0] - b[0]), dr = Math.abs(a[1] - b[1]);
    assert.ok(Math.max(dc, dr) === 1, `gap at ${i}`);
    if (dc === 1 && dr === 1) diagonals++;
  }
  assert.equal(diagonals, 4);
});
test('each home column joins the cell before the finish', () => {
  for (let p = 0; p < 4; p++) {
    const last = gridPos(p, 50, 0), first = HOME_COLUMNS[p][0];
    assert.equal(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]), 1);
    assert.equal(HOME_COLUMNS[p].length, 5);
  }
});
test('safe cells: 4 starts + 4 stars', () => {
  assert.equal(SAFE_LOOP.size, 8);
  START_INDEX.forEach((i) => assert.ok(SAFE_LOOP.has(i)));
});

console.log('Rules');
test('needs a six to leave base', () => {
  const s = createGame(seats4());
  assert.equal(legalMoves(s, 5).length, 0);
  assert.equal(legalMoves(s, 6).length, 4);
});
test('no legal move passes the turn', () => {
  const s = createGame(seats4());
  const r = roll(s, rigged(3));
  assert.ok(r.passed); assert.equal(s.turn, 1); assert.equal(s.phase, 'roll');
});
test('six gives an extra turn; token leaves base to start cell', () => {
  const s = createGame(seats4());
  const r = roll(s, rigged(6));
  assert.ok(!r.passed); assert.equal(s.phase, 'move');
  const m = applyMove(s, 0);
  assert.equal(m.to, 0); assert.ok(m.extra); assert.equal(s.turn, 0); assert.equal(s.phase, 'roll');
});
test('three sixes in a row forfeit the turn', () => {
  const s = createGame(seats4());
  const rng = rigged(6, 6, 6);
  roll(s, rng); applyMove(s, 0);
  roll(s, rng); applyMove(s, 0);
  const r = roll(s, rng);
  assert.ok(r.forfeit && r.passed); assert.equal(s.turn, 1);
});
test('capture on a normal cell sends the victim to base and grants an extra turn', () => {
  const s = createGame(seats4());
  s.seats[1].tokens[0] = 42;              // Emerald loop idx (13+42)%52 = 3
  s.seats[0].tokens[0] = 1;               // Ruby at loop idx 1, rolls 2 -> idx 3
  roll(s, rigged(2));                      // 1 -> 3
  const m = applyMove(s, 0);
  assert.equal(m.captured.length, 1);
  assert.equal(s.seats[1].tokens[0], -1);
  assert.ok(m.extra); assert.equal(s.turn, 0);
});
test('no capture on safe cells (stars and starts)', () => {
  const s = createGame(seats4());
  s.seats[0].tokens[0] = 5;                // loop idx 8 target after +3 = star
  s.seats[1].tokens[0] = 47;               // Emerald (13+47)%52 = 8
  assert.equal(captureTargets(s, 0, 8).length, 0);
  s.seats[2].tokens[0] = 0;                // Amber on its own start (26)
  assert.equal(captureTargets(s, 0, 26).length, 0);
});
test('exact roll needed to finish', () => {
  const s = createGame(seats4());
  s.seats[0].tokens = [54, -1, -1, -1];
  assert.deepEqual(legalMoves(s, 2).map((m) => m.to), [56]);
  assert.equal(legalMoves(s, 3).length, 0);
});
test('reaching home gives an extra turn; four home wins the game', () => {
  const s = createGame(seats4());
  s.seats[0].tokens = [56, 56, 56, 55];
  roll(s, rigged(1));
  const m = applyMove(s, 3);
  assert.ok(m.reachedHome && m.won); assert.equal(s.phase, 'over'); assert.equal(s.winner, 0);
  assert.equal(homeCount(s.seats[0]), 4);
});
test('finished token is never captured', () => {
  const s = createGame(seats4());
  s.seats[1].tokens = [56, -1, -1, -1];
  assert.equal(captureTargets(s, 0, 40).filter((v) => v.seat === 1).length, 0);
});
test('full CPU-vs-CPU games always terminate with a winner (200 seeded games)', () => {
  for (let g = 0; g < 200; g++) {
    const rng = mulberry32(g + 1);
    const n = [2, 3, 4][g % 3];
    const s = createGame(seats4().slice(0, n));
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 20000) {
      const r = roll(s, rng);
      if (r.passed) continue;
      applyMove(s, chooseMove(s, r.moves, g % 2 ? 'sharp' : 'casual', rng));
    }
    assert.equal(s.phase, 'over', `game ${g} did not finish`);
    assert.equal(s.seats[s.winner].tokens.every((p) => p === 56), true);
  }
});

console.log('Earnings');
const clock = (iso) => { let d = new Date(iso); const f = () => d; f.set = (x) => { d = new Date(x); }; return f; };
const mk = (iso = '2026-10-16T10:00:00') => { const st = new MemoryStorage(); const c = clock(iso); return { st, c, e: new Earnings(st, c) }; };

test('tier maths', () => {
  assert.equal(prizeFor(tierById('bronze'), 2), 200);
  assert.equal(prizeFor(tierById('gold'), 4), 8000);
  assert.deepEqual(bonusFor(tierById('bronze')), { capture: 5, home: 10 });
  assert.deepEqual(bonusFor(tierById('silver')), { capture: 25, home: 50 });
  assert.deepEqual(bonusFor(tierById('gold')), { capture: 100, home: 200 });
  assert.deepEqual(bonusFor(tierById('practice')), { capture: 0, home: 0 });
});
test('winning a paid match: entry, bonuses, prize and net add up', () => {
  const { e } = mk();
  e.startMatch(tierById('silver'), 4);
  assert.equal(e.balance, START_BALANCE - 500);
  assert.equal(e.bonus('capture'), 25); assert.equal(e.bonus('capture'), 25); assert.equal(e.bonus('home'), 50);
  const s = e.settle(true);
  assert.equal(s.prize, 2000); assert.equal(s.bonus, 100); assert.equal(s.net, 2000 + 100 - 500);
  assert.equal(e.balance, START_BALANCE + s.net);
  const st = e.state;
  assert.equal(st.games, 1); assert.equal(st.wins, 1); assert.equal(st.captures, 2); assert.equal(st.tokensHome, 1);
  assert.equal(st.bestWin, s.net); assert.equal(st.match, null);
});
test('losing keeps bonuses but no prize', () => {
  const { e } = mk();
  e.startMatch(tierById('bronze'), 2); e.bonus('capture');
  const s = e.settle(false);
  assert.equal(s.prize, 0); assert.equal(s.net, 5 - 100); assert.equal(e.balance, START_BALANCE - 95);
  assert.equal(e.state.wins, 0);
});
test('practice table is free and pays nothing but still counts stats', () => {
  const { e } = mk();
  e.startMatch(tierById('practice'), 2); assert.equal(e.bonus('capture'), 0);
  const s = e.settle(true);
  assert.equal(s.net, 0); assert.equal(e.balance, START_BALANCE); assert.equal(e.state.captures, 1);
});
test('cannot join a table you cannot afford; balance never negative', () => {
  const { e } = mk();
  e.s.balance = 50;
  assert.throws(() => e.startMatch(tierById('bronze'), 2), /Not enough coins/);
  assert.equal(e.balance, 50); assert.equal(e.match, null);
  assert.doesNotThrow(() => { e.startMatch(tierById('practice'), 2); e.settle(false); });
});
test('abandoned match is forfeited when a new one starts', () => {
  const { e } = mk();
  e.startMatch(tierById('bronze'), 2);
  e.startMatch(tierById('bronze'), 2);
  assert.equal(e.state.games, 1); assert.equal(e.balance, START_BALANCE - 200);
});
test('state persists across reloads, including an active match', () => {
  const { st, c, e } = mk();
  e.startMatch(tierById('bronze'), 3); e.bonus('home');
  const e2 = new Earnings(st, c);
  assert.equal(e2.balance, START_BALANCE - 90);
  assert.equal(e2.match.home, 1); assert.equal(e2.match.bonus, 10);
  const s = e2.settle(true);
  assert.equal(s.prize, 300);
});
test('corrupt or tampered storage falls back safely', () => {
  const st = new MemoryStorage();
  st.set(STORE_KEY, '{not json');
  assert.equal(new Earnings(st).balance, START_BALANCE);
  st.set(STORE_KEY, JSON.stringify({ balance: -50, earned: 'x', games: NaN, ledger: 'no', match: { tierId: 'nope' } }));
  const e = new Earnings(st);
  assert.equal(e.balance, START_BALANCE); assert.equal(e.state.games, 0); assert.deepEqual(e.state.ledger, []); assert.equal(e.match, null);
});
test('daily gift can be claimed once per calendar day', () => {
  const { e, c } = mk('2026-10-16T09:00:00');
  assert.ok(e.dailyAvailable());
  assert.equal(e.claimDaily(), DAILY_GIFT);
  assert.equal(e.claimDaily(), 0);
  c.set('2026-10-16T23:59:00'); assert.equal(e.claimDaily(), 0);
  c.set('2026-10-17T00:01:00'); assert.equal(e.claimDaily(), DAILY_GIFT);
  assert.equal(e.balance, START_BALANCE + 2 * DAILY_GIFT);
});
test('ledger is capped and every entry carries the running balance', () => {
  const { e } = mk();
  for (let i = 0; i < 130; i++) { e.s.balance += 1; e._log('test', 1); }
  e._save();
  assert.equal(e.state.ledger.length, 100);
  assert.equal(e.state.ledger.at(-1).balance, e.balance);
});
test('listeners are notified on every change', () => {
  const { e } = mk(); let n = 0; e.subscribe(() => n++);
  e.startMatch(tierById('bronze'), 2); e.bonus('capture'); e.settle(false);
  assert.equal(n, 3);
});

console.log(`\nAll ${passed} tests passed.`);
