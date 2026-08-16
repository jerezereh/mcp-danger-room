/**
 * Shared vocabulary for the two `resolveAttack` prototypes.
 *
 * See issue #4. Both implementations resolve the *same* attack sequence with the
 * same four decision points, expose the same interface, and are exercised by the
 * same test suite. The only difference is how a suspended resolution is
 * represented — which is the thing being compared.
 *
 * Both satisfy the serializability constraint. That is the point: the choice is
 * not "serializable vs not", it is ergonomics at equal safety.
 */

import { roll, type DieFace, type RollMode } from '../dice.js';
import type { ModelId, PlayerId } from '../ids.js';
import type { RngState } from '../rng.js';

/** Everything an attack needs to resolve, fixed at declaration time. */
export interface AttackContext {
  readonly attackerId: ModelId;
  readonly attackerOwner: PlayerId;
  readonly targetId: ModelId;
  readonly targetOwner: PlayerId;
  readonly attackName: string;
  readonly attackDice: number;
  readonly defenseDice: number;
  /** Power available to each side, for the spend decisions. */
  readonly attackerPower: number;
  readonly targetPower: number;
}

/**
 * The four points where a human must decide. Realistic for MCP: the defender
 * gets a reaction window on being targeted and another before damage lands, and
 * both sides get a chance to spend power on their own roll.
 */
export type AttackPrompt =
  | { readonly kind: 'reactWhenTargeted'; readonly player: PlayerId; readonly power: number }
  | { readonly kind: 'boostAttack'; readonly player: PlayerId; readonly power: number }
  | { readonly kind: 'rerollDefense'; readonly player: PlayerId; readonly power: number }
  | { readonly kind: 'preventDamage'; readonly player: PlayerId; readonly incoming: number };

/** A player's answer to a prompt. Must be JSON — it goes in the resume token. */
export type Answer =
  | { readonly kind: 'pass' }
  | { readonly kind: 'react'; readonly superpower: string }
  | { readonly kind: 'spend'; readonly power: number };

export type AttackEvent =
  | { readonly type: 'declared'; readonly attackName: string }
  | { readonly type: 'reacted'; readonly modelId: ModelId; readonly superpower: string }
  | { readonly type: 'diceAdded'; readonly modelId: ModelId; readonly count: number }
  | {
      readonly type: 'rolled';
      readonly modelId: ModelId;
      readonly mode: RollMode;
      readonly faces: readonly DieFace[];
      readonly successes: number;
    }
  | { readonly type: 'rerolled'; readonly modelId: ModelId }
  | { readonly type: 'damage'; readonly modelId: ModelId; readonly amount: number }
  | { readonly type: 'prevented'; readonly modelId: ModelId; readonly amount: number }
  | { readonly type: 'powerGained'; readonly modelId: ModelId; readonly amount: number };

export interface AttackOutcome {
  readonly damage: number;
  readonly attackSuccesses: number;
  readonly defenseSuccesses: number;
  readonly attackerPowerSpent: number;
  readonly targetPowerSpent: number;
  readonly attackerPowerGained: number;
}

/**
 * A serializable handle on a suspended attack.
 *
 * The two implementations fill this differently — a stack of steps versus a log
 * of answers — and that difference is the entire subject of issue #4.
 */
export type ResumeToken =
  | { readonly kind: 'frames'; readonly frame: unknown }
  | { readonly kind: 'replay'; readonly answers: readonly Answer[] };

export type AttackResult =
  | {
      readonly status: 'awaiting';
      readonly prompt: AttackPrompt;
      readonly resume: ResumeToken;
      readonly events: readonly AttackEvent[];
    }
  | {
      readonly status: 'done';
      readonly outcome: AttackOutcome;
      readonly events: readonly AttackEvent[];
      readonly rng: RngState;
    };

/** Both prototypes implement exactly this. */
export interface AttackDriver {
  readonly name: string;
  begin(ctx: AttackContext, rng: RngState): AttackResult;
  resume(ctx: AttackContext, rng: RngState, token: ResumeToken, answer: Answer): AttackResult;
}

// ---------------------------------------------------------------------------
// Rules shared by both implementations, so neither can win on different maths.
// ---------------------------------------------------------------------------

/** Power buys dice at 1:1, capped at 3. TODO(verify) — placeholder. */
export const MAX_BOOST = 3;
/** Power spent to reroll the whole defense pool. TODO(verify). */
export const REROLL_COST = 2;

export const boostFrom = (answer: Answer, available: number): number =>
  answer.kind === 'spend' ? Math.max(0, Math.min(answer.power, available, MAX_BOOST)) : 0;

export const rollPool = (rng: RngState, dice: number, mode: RollMode) => roll(rng, dice, mode);
