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

/**
 * The six symbols an MCP die can show.
 *
 * **Blank and Failure are different faces**, and the engine used to have only
 * one of them. Both do nothing on their own, but:
 *
 *  - A **Blank** is an ordinary miss and can be rerolled.
 *  - A **Failure** cannot be rerolled, and is a symbol effects refer to in its
 *    own right — 126 lines of corpus text mention `{FAIL}`, some as a trigger
 *    alongside Critical and Wild ("{CRIT} {WILD} {FAIL} Stagger: …"), and
 *    Dormammu counts Failures in his roll as successes.
 *
 * The distinction is printed on the cards too: Pierce reads "change 1 of the
 * defending character's {CRIT}, {WILD}, or {BLOCK} results to a {BLANK}" —
 * downgrading a success to something the defender may still reroll, which is a
 * materially weaker effect than turning it into a Failure.
 *
 * `packages/data/src/symbols.ts` has always had both keys. Only the engine
 * conflated them.
 */
export type DieFace = 'critical' | 'wild' | 'hit' | 'block' | 'blank' | 'failure';

/**
 * The eight faces of an MCP die.
 *
 * Verified: 1 Critical, 1 Wild, 2 Hit, 1 Block, 2 Blank, 1 Failure.
 *
 * Stored as a flat array rather than a weight table so that a roll is one
 * `nextInt` into it, and so that correcting the die stays a one-line change.
 */
export const DIE_FACES: readonly DieFace[] = [
  'critical',
  'wild',
  'hit',
  'hit',
  'block',
  'blank',
  'blank',
  'failure',
];

export type RollMode = 'attack' | 'defense';

export interface RollResult {
  readonly faces: readonly DieFace[];
  /** Faces added by resolving criticals. Kept separate for the UI's benefit. */
  readonly bonusFaces: readonly DieFace[];
  readonly successes: number;
  /** Carried for the effects that trigger on them, none of which read it yet. */
  readonly wilds: number;
  readonly criticals: number;
  readonly failures: number;
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
    case 'failure':
      // Neither counts by itself. Some characters — Dormammu — count their own
      // Failures as successes, but that is a superpower changing the rule, not
      // the rule.
      return false;
  }
}

/**
 * May this die be rerolled?
 *
 * A Failure may not; every other face may. Nothing rerolls anything yet —
 * `ReactionEffect` has no reroll variant — so this exists to be consulted the
 * first time something does, rather than discovered afterwards. Step 9 of the
 * attack sequence is entirely about rerolling and changing dice (#12).
 */
export function isRerollable(face: DieFace): boolean {
  return face !== 'failure';
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
      failures: all.filter(f => f === 'failure').length,
    },
  };
}
