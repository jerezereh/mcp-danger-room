/**
 * MCP dice.
 *
 * The face distribution is *data*, not branching logic, so that correcting it
 * against the real die is a one-line change and so that the AI can reason about
 * expected values without re-deriving them.
 */

import { nextInts, type RngState } from './rng.js';

export type DieFace = 'critical' | 'wild' | 'hit' | 'block' | 'blank';

/**
 * The eight faces of an MCP die.
 *
 * TODO(verify): placeholder distribution. Check against a physical die before
 * trusting any probability the app reports.
 */
export const DIE_FACES: readonly DieFace[] = [
  'critical',
  'wild',
  'hit',
  'hit',
  'hit',
  'block',
  'block',
  'blank',
];

export type RollMode = 'attack' | 'defense';

export interface RollResult {
  readonly faces: readonly DieFace[];
  /** Faces added by criticals rerolling. Kept separate for the UI's benefit. */
  readonly bonusFaces: readonly DieFace[];
  readonly successes: number;
  readonly wilds: number;
  readonly criticals: number;
}

/** Which faces count as successes depends on whether you're hitting or blocking. */
function isSuccess(face: DieFace, mode: RollMode): boolean {
  switch (face) {
    case 'critical':
    case 'wild':
      return true;
    case 'hit':
      return mode === 'attack';
    case 'block':
      return mode === 'defense';
    case 'blank':
      return false;
  }
}

/**
 * Roll `count` dice. Criticals count as successes *and* generate an additional
 * die, which can itself crit — so the loop continues until no new criticals
 * appear. Bounded by `maxCascades` purely as a runaway guard.
 *
 * TODO(verify): confirm criticals cascade rather than rerolling exactly once.
 */
export function roll(
  rng: RngState,
  count: number,
  mode: RollMode,
  maxCascades = 10,
): { result: RollResult; rng: RngState } {
  const faces: DieFace[] = [];
  const bonusFaces: DieFace[] = [];

  let cursor = rng;
  let toRoll = count;
  let cascades = 0;
  let isBonusRound = false;

  while (toRoll > 0 && cascades <= maxCascades) {
    const drawn = nextInts(cursor, DIE_FACES.length, toRoll);
    cursor = drawn.state;

    const rolled = drawn.values.map(i => DIE_FACES[i % DIE_FACES.length] as DieFace);
    (isBonusRound ? bonusFaces : faces).push(...rolled);

    toRoll = rolled.filter(f => f === 'critical').length;
    isBonusRound = true;
    cascades++;
  }

  const all = [...faces, ...bonusFaces];
  return {
    rng: cursor,
    result: {
      faces,
      bonusFaces,
      successes: all.filter(f => isSuccess(f, mode)).length,
      wilds: all.filter(f => f === 'wild').length,
      criticals: all.filter(f => f === 'critical').length,
    },
  };
}
