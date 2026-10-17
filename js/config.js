// Board geometry, colours and shared constants. Pure data, no DOM access.

export const COLORS = [
  { id: 'red',    name: 'Ruby',     hex: 0xd8243a, css: '#e23a50', deep: '#8f1426', soft: '#ff8d9b', rgb: [255, 110, 130] },
  { id: 'green',  name: 'Emerald',  hex: 0x14a35a, css: '#20b868', deep: '#0b6b38', soft: '#7ee8ad', rgb: [90, 240, 160] },
  { id: 'yellow', name: 'Amber',    hex: 0xf4b01c, css: '#f6b92d', deep: '#b27a05', soft: '#ffe08a', rgb: [255, 215, 90] },
  { id: 'blue',   name: 'Sapphire', hex: 0x2b6fe0, css: '#3d83f2', deep: '#173f94', soft: '#8fbaff', rgb: [110, 170, 255] },
];

export const LOOP_LEN = 52;          // shared track cells
export const START_INDEX = [0, 13, 26, 39]; // loop index where each colour enters
export const LAST_LOOP_P = 50;       // last progress value that sits on the shared track
export const HOME_P = 56;            // progress value of a finished token
export const SAFE_LOOP = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // starts + stars

function line(c0, r0, c1, r1) {
  const out = [];
  const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
  let c = c0, r = r0;
  out.push([c, r]);
  while (c !== c1 || r !== r1) { c += dc; r += dr; out.push([c, r]); }
  return out;
}

// 52-cell clockwise loop on a 15x15 grid, [col,row], row 0 = top. Index 0 = Ruby start.
export const LOOP = [
  ...line(1, 6, 5, 6), ...line(6, 5, 6, 0), [7, 0], [8, 0],
  ...line(8, 1, 8, 5), ...line(9, 6, 14, 6), [14, 7], [14, 8],
  ...line(13, 8, 9, 8), ...line(8, 9, 8, 14), [7, 14], [6, 14],
  ...line(6, 13, 6, 9), ...line(5, 8, 0, 8), [0, 7], [0, 6],
];

export const HOME_COLUMNS = [
  line(1, 7, 5, 7), line(7, 1, 7, 5), line(13, 7, 9, 7), line(7, 13, 7, 9),
];

export const BASE_CENTER = [[2.5, 2.5], [11.5, 2.5], [11.5, 11.5], [2.5, 11.5]];
const SLOT = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const FIN_DIR = [[-1, 0], [0, -1], [1, 0], [0, 1]];

/** Grid position [col,row] (floats allowed) of a token with progress p. */
export function gridPos(player, p, token) {
  if (p < 0) {
    const b = BASE_CENTER[player], o = SLOT[token];
    return [b[0] + o[0], b[1] + o[1]];
  }
  if (p <= LAST_LOOP_P) return LOOP[(START_INDEX[player] + p) % LOOP_LEN];
  if (p < HOME_P) return HOME_COLUMNS[player][p - 51];
  const d = FIN_DIR[player], perp = [-d[1], d[0]], k = (token - 1.5) * 0.34;
  return [7 + d[0] * 1.15 + perp[0] * k, 7 + d[1] * 1.15 + perp[1] * k];
}

/** World position on the 3D board (board centre = origin, 1 unit per cell). */
export function worldPos(player, p, token) {
  const [c, r] = gridPos(player, p, token);
  return { x: c - 7, z: r - 7 };
}

export const SEAT_LAYOUTS = {
  1: [0, 2],
  2: [0, 1, 2],
  3: [0, 1, 2, 3],
};
