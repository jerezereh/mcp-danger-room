/**
 * Option A — attack resolution as a frame stack.
 *
 * Suspended resolution is a plain data record: which step we are on, plus every
 * partial result accumulated so far. Serializing is free because the frame *is*
 * the continuation.
 *
 * The cost is visible below. Because one record must carry values that only
 * exist after certain steps, they are all nullable, and the type system cannot
 * tell you which are populated at any given step. Count the `| null` fields and
 * the `?? 0` reads — those are the tax, and each one is a place an ordering bug
 * can hide silently.
 */

import type { RngState } from '../rng.js';
import {
  boostFrom,
  rollPool,
  REROLL_COST,
  type Answer,
  type AttackContext,
  type AttackDriver,
  type AttackEvent,
  type AttackResult,
  type ResumeToken,
} from './shared.js';

type Step =
  | 'declare'
  | 'reactWhenTargeted'
  | 'boostAttack'
  | 'rollAttack'
  | 'rerollDefense'
  | 'rollDefense'
  | 'preventDamage'
  | 'applyDamage'
  | 'afterAttack';

/**
 * The frame. Every field after `step` is a partial result that exists only
 * after some particular step has run — hence the nullables.
 */
interface Frame {
  readonly step: Step;
  readonly rng: RngState;
  readonly events: readonly AttackEvent[];

  readonly bonusDice: number;
  readonly attackerPowerSpent: number;
  readonly targetPowerSpent: number;

  readonly attackSuccesses: number | null;
  readonly defenseSuccesses: number | null;
  readonly rawDamage: number | null;
  readonly prevented: number | null;
  readonly finalDamage: number | null;
}

const start = (rng: RngState): Frame => ({
  step: 'declare',
  rng,
  events: [],
  bonusDice: 0,
  attackerPowerSpent: 0,
  targetPowerSpent: 0,
  attackSuccesses: null,
  defenseSuccesses: null,
  rawDamage: null,
  prevented: null,
  finalDamage: null,
});

/**
 * Advance until the sequence needs a decision or finishes.
 *
 * Note how `pending` has to be checked and cleared by hand: an answer applies to
 * whichever step parked the prompt, and nothing in the types enforces that the
 * answer being consumed matches the step consuming it.
 */
function advance(ctx: AttackContext, frame: Frame, pending: Answer | null): AttackResult {
  let f = frame;
  let answer = pending;

  // Guard against a step that fails to advance — the frame stack's characteristic
  // failure mode, since nothing structurally prevents a step returning itself.
  for (let guard = 0; guard < 64; guard++) {
    switch (f.step) {
      case 'declare': {
        f = {
          ...f,
          step: 'reactWhenTargeted',
          events: [...f.events, { type: 'declared', attackName: ctx.attackName }],
        };
        continue;
      }

      case 'reactWhenTargeted': {
        if (!answer) {
          return {
            status: 'awaiting',
            prompt: { kind: 'reactWhenTargeted', player: ctx.targetOwner, power: ctx.targetPower },
            resume: { kind: 'frames', frame: f },
            events: f.events,
          };
        }
        // Narrowing has to happen inline. `const used = answer.kind === 'react'`
        // does not narrow `answer` here, because `answer` is a mutable binding
        // reassigned across iterations — the manual answer-routing this design
        // requires is exactly what defeats the analysis.
        f = {
          ...f,
          step: 'boostAttack',
          targetPowerSpent: f.targetPowerSpent + (answer.kind === 'react' ? 1 : 0),
          events:
            answer.kind === 'react'
              ? [
                  ...f.events,
                  { type: 'reacted', modelId: ctx.targetId, superpower: answer.superpower },
                ]
              : f.events,
        };
        answer = null;
        continue;
      }

      case 'boostAttack': {
        if (!answer) {
          return {
            status: 'awaiting',
            prompt: { kind: 'boostAttack', player: ctx.attackerOwner, power: ctx.attackerPower },
            resume: { kind: 'frames', frame: f },
            events: f.events,
          };
        }
        const boost = boostFrom(answer, ctx.attackerPower);
        f = {
          ...f,
          step: 'rollAttack',
          bonusDice: boost,
          attackerPowerSpent: f.attackerPowerSpent + boost,
          events:
            boost > 0
              ? [...f.events, { type: 'diceAdded', modelId: ctx.attackerId, count: boost }]
              : f.events,
        };
        answer = null;
        continue;
      }

      case 'rollAttack': {
        const { result, rng } = rollPool(f.rng, ctx.attackDice + f.bonusDice, 'attack');
        f = {
          ...f,
          step: 'rerollDefense',
          rng,
          attackSuccesses: result.successes,
          events: [
            ...f.events,
            {
              type: 'rolled',
              modelId: ctx.attackerId,
              mode: 'attack',
              faces: [...result.faces, ...result.bonusFaces],
              successes: result.successes,
            },
          ],
        };
        continue;
      }

      case 'rerollDefense': {
        if (!answer) {
          return {
            status: 'awaiting',
            prompt: { kind: 'rerollDefense', player: ctx.targetOwner, power: ctx.targetPower },
            resume: { kind: 'frames', frame: f },
            events: f.events,
          };
        }
        const paying =
          answer.kind === 'spend' && answer.power >= REROLL_COST && ctx.targetPower >= REROLL_COST;
        f = {
          ...f,
          step: 'rollDefense',
          targetPowerSpent: f.targetPowerSpent + (paying ? REROLL_COST : 0),
          events: paying
            ? [...f.events, { type: 'rerolled', modelId: ctx.targetId }]
            : f.events,
        };
        answer = null;
        continue;
      }

      case 'rollDefense': {
        const { result, rng } = rollPool(f.rng, ctx.defenseDice, 'defense');
        // `?? 0` — the tax. attackSuccesses is non-null by construction here,
        // but nothing in the type says so, and a reordering would silently
        // read zero instead of failing.
        const raw = Math.max(0, (f.attackSuccesses ?? 0) - result.successes);
        f = {
          ...f,
          step: 'preventDamage',
          rng,
          defenseSuccesses: result.successes,
          rawDamage: raw,
          events: [
            ...f.events,
            {
              type: 'rolled',
              modelId: ctx.targetId,
              mode: 'defense',
              faces: [...result.faces, ...result.bonusFaces],
              successes: result.successes,
            },
          ],
        };
        continue;
      }

      case 'preventDamage': {
        if ((f.rawDamage ?? 0) === 0) {
          f = { ...f, step: 'applyDamage', prevented: 0, finalDamage: 0 };
          continue;
        }
        if (!answer) {
          return {
            status: 'awaiting',
            prompt: {
              kind: 'preventDamage',
              player: ctx.targetOwner,
              incoming: f.rawDamage ?? 0,
            },
            resume: { kind: 'frames', frame: f },
            events: f.events,
          };
        }
        const spend =
          answer.kind === 'spend'
            ? Math.min(answer.power, ctx.targetPower - f.targetPowerSpent)
            : 0;
        const prevented = Math.max(0, Math.min(spend, f.rawDamage ?? 0));
        f = {
          ...f,
          step: 'applyDamage',
          prevented,
          finalDamage: (f.rawDamage ?? 0) - prevented,
          targetPowerSpent: f.targetPowerSpent + prevented,
          events:
            prevented > 0
              ? [...f.events, { type: 'prevented', modelId: ctx.targetId, amount: prevented }]
              : f.events,
        };
        answer = null;
        continue;
      }

      case 'applyDamage': {
        const dealt = f.finalDamage ?? 0;
        f = {
          ...f,
          step: 'afterAttack',
          events:
            dealt > 0
              ? [...f.events, { type: 'damage', modelId: ctx.targetId, amount: dealt }]
              : f.events,
        };
        continue;
      }

      case 'afterAttack': {
        const dealt = f.finalDamage ?? 0;
        return {
          status: 'done',
          rng: f.rng,
          events:
            dealt > 0
              ? [...f.events, { type: 'powerGained', modelId: ctx.attackerId, amount: dealt }]
              : f.events,
          outcome: {
            damage: dealt,
            attackSuccesses: f.attackSuccesses ?? 0,
            defenseSuccesses: f.defenseSuccesses ?? 0,
            attackerPowerSpent: f.attackerPowerSpent,
            targetPowerSpent: f.targetPowerSpent,
            attackerPowerGained: dealt,
          },
        };
      }
    }
  }

  throw new Error('Frame sequence did not converge.');
}

export const frameDriver: AttackDriver = {
  name: 'frames',

  begin(ctx, rng) {
    return advance(ctx, start(rng), null);
  },

  resume(ctx, _rng, token: ResumeToken, answer) {
    if (token.kind !== 'frames') throw new Error('Wrong resume token for the frame driver.');
    // The frame carries its own RNG position, so the caller's rng is ignored.
    return advance(ctx, token.frame as Frame, answer);
  },
};
