// CPU move selection. 'casual' is noisy and ignores danger, 'sharp' evaluates threats.

import { SAFE_LOOP, LAST_LOOP_P, LOOP_LEN, HOME_P } from './config.js';
import { captureTargets, loopIndex } from './logic.js';

/** Is a token at loop index `li` (owned by seatIdx) exposed to an opponent 1-6 cells behind it? */
function threatened(state, seatIdx, li) {
  if (li < 0 || SAFE_LOOP.has(li)) return false;
  for (let oi = 0; oi < state.seats.length; oi++) {
    if (oi === seatIdx) continue;
    const o = state.seats[oi];
    for (const p of o.tokens) {
      if (p < 0 || p > LAST_LOOP_P) continue;
      const d = (li - loopIndex(o, p) + LOOP_LEN) % LOOP_LEN;
      if (d >= 1 && d <= 6 && p + d <= LAST_LOOP_P) return true;
    }
  }
  return false;
}

export function chooseMove(state, moves, skill = 'sharp', rng = Math.random) {
  if (moves.length === 1) return moves[0].token;
  const seatIdx = state.turn;
  const seat = state.seats[seatIdx];
  const sharp = skill === 'sharp';
  let best = null, bestScore = -Infinity;

  for (const m of moves) {
    let s = 0;
    if (m.from === -1) s += 42;
    const victims = captureTargets(state, seatIdx, m.to);
    for (const v of victims) s += 60 + v.from * 0.6;
    if (m.to === HOME_P) s += 70;
    else if (m.to > LAST_LOOP_P && m.from <= LAST_LOOP_P) s += 34;
    const toLi = loopIndex(seat, m.to);
    if (toLi >= 0 && SAFE_LOOP.has(toLi)) s += 22;
    if (sharp) {
      const fromLi = loopIndex(seat, m.from);
      if (fromLi >= 0 && threatened(state, seatIdx, fromLi)) s += 28 + m.from * 0.2;
      if (toLi >= 0 && !victims.length && threatened(state, seatIdx, toLi)) s -= 30 + m.to * 0.3;
    }
    s += m.to * 0.3 + (m.from > 0 ? m.from * 0.12 : 0);
    s += (rng() - 0.5) * (sharp ? 8 : 60);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best.token;
}
