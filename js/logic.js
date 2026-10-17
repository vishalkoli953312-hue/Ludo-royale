// Pure Ludo rules engine. No DOM, no rendering. State is plain JSON (serialisable).
//
// Progress values per token:  -1 = in base, 0..50 = shared track (0 is its start cell),
// 51..55 = own home column, 56 = finished.  An exact roll is needed to finish.

import { START_INDEX, LOOP_LEN, LAST_LOOP_P, HOME_P, SAFE_LOOP } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seats: [{player:0-3, kind:'human'|'cpu', name}] in turn order. */
export function createGame(seats) {
  return {
    seats: seats.map((s) => ({ player: s.player, kind: s.kind, name: s.name, tokens: [-1, -1, -1, -1] })),
    turn: 0,
    dice: 0,
    sixes: 0,
    phase: 'roll',   // 'roll' | 'move' | 'over'
    winner: null,
    moves: 0,
  };
}

export function loopIndex(seat, p) {
  return p >= 0 && p <= LAST_LOOP_P ? (START_INDEX[seat.player] + p) % LOOP_LEN : -1;
}

export function legalMoves(state, dice = state.dice, seatIdx = state.turn) {
  const seat = state.seats[seatIdx];
  const out = [];
  seat.tokens.forEach((p, token) => {
    if (p === -1) { if (dice === 6) out.push({ token, from: -1, to: 0 }); }
    else if (p < HOME_P && p + dice <= HOME_P) out.push({ token, from: p, to: p + dice });
  });
  return out;
}

/** Opponent tokens that a mover (seatIdx) landing on progress `to` would capture. */
export function captureTargets(state, seatIdx, to) {
  if (to < 0 || to > LAST_LOOP_P) return [];
  const seat = state.seats[seatIdx];
  const li = loopIndex(seat, to);
  if (SAFE_LOOP.has(li)) return [];
  const victims = [];
  state.seats.forEach((o, oi) => {
    if (oi === seatIdx) return;
    o.tokens.forEach((p, token) => {
      if (p >= 0 && p <= LAST_LOOP_P && loopIndex(o, p) === li) victims.push({ seat: oi, token, from: p });
    });
  });
  return victims;
}

function advance(state) {
  state.turn = (state.turn + 1) % state.seats.length;
  state.sixes = 0;
  state.phase = 'roll';
}

/** Roll the dice for the current seat. Auto-passes the turn when nothing can move. */
export function roll(state, rng = Math.random) {
  if (state.phase !== 'roll') throw new Error('Cannot roll now');
  const value = 1 + Math.floor(rng() * 6);
  const seat = state.turn;
  state.dice = value;
  state.sixes = value === 6 ? state.sixes + 1 : 0;
  if (state.sixes >= 3) {
    advance(state);
    return { seat, value, moves: [], passed: true, forfeit: true };
  }
  const moves = legalMoves(state, value, seat);
  if (!moves.length) {
    advance(state);
    return { seat, value, moves, passed: true, forfeit: false };
  }
  state.phase = 'move';
  return { seat, value, moves, passed: false, forfeit: false };
}

export function applyMove(state, token) {
  if (state.phase !== 'move') throw new Error('Cannot move now');
  const seatIdx = state.turn;
  const seat = state.seats[seatIdx];
  const mv = legalMoves(state).find((m) => m.token === token);
  if (!mv) throw new Error('Illegal move');

  const path = [];
  if (mv.from === -1) path.push(0);
  else for (let p = mv.from + 1; p <= mv.to; p++) path.push(p);

  seat.tokens[token] = mv.to;
  state.moves++;

  const captured = captureTargets(state, seatIdx, mv.to);
  captured.forEach((v) => { state.seats[v.seat].tokens[v.token] = -1; });

  const reachedHome = mv.to === HOME_P;
  const won = seat.tokens.every((p) => p === HOME_P);
  const extra = !won && (state.dice === 6 || captured.length > 0 || reachedHome);

  if (won) { state.phase = 'over'; state.winner = seatIdx; }
  else if (extra) state.phase = 'roll';
  else advance(state);

  return { seat: seatIdx, token, from: mv.from, to: mv.to, path, captured, reachedHome, won, extra, dice: state.dice };
}

export function homeCount(seat) { return seat.tokens.filter((p) => p === HOME_P).length; }
