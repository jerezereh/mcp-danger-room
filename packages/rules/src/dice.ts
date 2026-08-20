/**
 * MCP dice.
 *
 * The face distribution is *data*, not branching logic, so that correcting it
 * against the real die is a one-line change and so that the AI can reason about
 * expected values without re-deriving them.
 *
 * Rolling is split into `rollPool`, `resolveCriticals` and `countSuccesses`
 * because the attack sequence interleaves the two sides — steps 6, 7, 8 and 10
 * of the rulebook happen in that order across both players, not as two
 * independent rolls. See issue #5.
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
  /** Faces added by resolving criticals. Kept separate for the UI's benefit. */
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
 * Step 10 — count successes.
 *
 * "The attacker counts each Critical, Wild, and Hit result on their dice,
 * while the defender counts each Critical, Wild, and Block result."
 */
export function countSuccesses(faces: readonly DieFace[], mode: RollMode): number {
  return faces.filter(f => isSuccess(f, mode)).length;
}

/**
 * Steps 6 and 7 — roll a pool. No criticals are resolved here.
 *
 * Separate from `resolveCriticals` because the sequence interleaves the two
 * sides: *both* initial pools are rolled before *either* side's criticals are
 * resolved, and criticals are then resolved beginning with the attacker.
 * Rolling a pool and its criticals in one call cannot express that order.
 */
export function rollPool(rng: RngState, count: number): { faces: DieFace[]; rng: RngState } {
  const drawn = nextInts(rng, DIE_FACES.length, Math.max(0, count));
  return {
    faces: drawn.values.map(i => DIE_FACES[i % DIE_FACES.length] as DieFace),
    rng: drawn.state,
  };
}

/**
 * Step 8 — resolve criticals.
 *
 * "Beginning with the attacker, each character rolls an additional die for
 * each Critical result in their initial roll. Criticals rolled in this step
 * are not part of the initial roll and do not add further dice to the roll."
 *
 * So this is exactly one additional round, and it does **not** cascade. The
 * engine used to reroll criticals repeatedly until none appeared, which
 * inflated every pool containing one — a 5-dice attack could roll eight.
 */
export function resolveCriticals(
  rng: RngState,
  initialFaces: readonly DieFace[],
): { bonusFaces: DieFace[]; rng: RngState } {
  const criticals = initialFaces.filter(f => f === 'critical').length;
  if (criticals === 0) return { bonusFaces: [], rng };

  const drawn = rollPool(rng, criticals);
  return { bonusFaces: drawn.faces, rng: drawn.rng };
}

/**
 * Roll a pool and resolve its criticals in one call — steps 6 and 8, or 7 and
 * 8, for one side in isolation.
 *
 * Convenient for tests and for anything that does not care about the
 * interleaving. The engine does care, and uses the two primitives directly.
 */
export function roll(
  rng: RngState,
  count: number,
  mode: RollMode,
): { result: RollResult; rng: RngState } {
  const initial = rollPool(rng, count);
  const bonus = resolveCriticals(initial.rng, initial.faces);
  const all = [...initial.faces, ...bonus.bonusFaces];

  return {
    rng: bonus.rng,
    result: {
      faces: initial.faces,
      bonusFaces: bonus.bonusFaces,
      successes: countSuccesses(all, mode),
      wilds: all.filter(f => f === 'wild').length,
      criticals: all.filter(f => f === 'critical').length,
    },
  };
}
