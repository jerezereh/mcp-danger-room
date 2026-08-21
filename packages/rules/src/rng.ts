/**
 * Deterministic RNG.
 *
 * Dice rolls must be reproducible: the same seed and the same sequence of
 * actions must always produce the same game. That is what makes replays,
 * server-side verification, and AI search possible.
 *
 * The RNG state lives *inside* GameState as a plain number, so it serializes
 * over the wire and snapshots like everything else. No hidden module state.
 */

export interface RngState {
  /** Current position in the stream. Advances on every draw. */
  readonly seed: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

/**
 * mulberry32 — small, fast, good enough for dice. Returns the drawn float in
 * [0, 1) alongside the advanced state.
 */
export function next(state: RngState): { value: number; state: RngState } {
  const t = (state.seed + 0x6d2b79f5) >>> 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, state: { seed: t } };
}

/** Draw an integer in [0, bound). */
export function nextInt(state: RngState, bound: number): { value: number; state: RngState } {
  const drawn = next(state);
  return { value: Math.floor(drawn.value * bound), state: drawn.state };
}

/** Draw `count` integers in [0, bound). */
export function nextInts(
  state: RngState,
  bound: number,
  count: number,
): { values: number[]; state: RngState } {
  const values: number[] = [];
  let cursor = state;
  for (let i = 0; i < count; i++) {
    const drawn = nextInt(cursor, bound);
    values.push(drawn.value);
    cursor = drawn.state;
  }
  return { values, state: cursor };
}
