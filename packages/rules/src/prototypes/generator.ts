/**
 * Option B — attack resolution as a generator, resumed by deterministic replay.
 *
 * The sequence below reads top to bottom, in the order the rulebook describes
 * it. Partial results are ordinary local variables, so they are non-nullable and
 * the compiler knows exactly what exists at each point. There is no `?? 0`
 * anywhere in this file, and adding a decision point is one `yield`.
 *
 * A suspended generator cannot be serialized — so it is not serialized. What
 * persists is the *answer log*. To resume, the flow is re-run from the start
 * with the recorded answers fed back in; because the engine is deterministic and
 * the RNG is seeded, it lands on exactly the same state and then asks for the
 * next answer. This is how durable-execution systems such as Temporal work.
 *
 * Two disciplines this demands, both enforced by the driver rather than by
 * convention:
 *
 *   1. The flow must be deterministic. All randomness arrives through `yield`,
 *      never from `Math.random` or a clock.
 *   2. Side effects must not accumulate across replays. Events are *rebuilt*
 *      by the driver on each run rather than appended to durable state, so a
 *      replay reproduces the same list instead of doubling it.
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
  type AttackOutcome,
  type AttackPrompt,
  type AttackResult,
  type ResumeToken,
} from './shared.js';

/** What the flow can ask the driver for. */
type Request =
  | { readonly kind: 'roll'; readonly modelId: AttackContext['attackerId']; readonly dice: number; readonly mode: 'attack' | 'defense' }
  | { readonly kind: 'ask'; readonly prompt: AttackPrompt }
  | { readonly kind: 'emit'; readonly event: AttackEvent };

/** What the driver hands back. `void` for emits, successes for rolls. */
type Reply = number | Answer | void;

type Flow = Generator<Request, AttackOutcome, Reply>;

/**
 * The entire attack sequence, in order.
 *
 * Compare against frames.ts: same rules, same four decision points, no state
 * machine, no nullable partial results, no manual answer routing.
 */
function* attackFlow(ctx: AttackContext): Flow {
  yield { kind: 'emit', event: { type: 'declared', attackName: ctx.attackName } };

  // --- Defender may react on being targeted -------------------------------
  const reaction = (yield {
    kind: 'ask',
    prompt: { kind: 'reactWhenTargeted', player: ctx.targetOwner, power: ctx.targetPower },
  }) as Answer;

  let targetPowerSpent = 0;
  if (reaction.kind === 'react') {
    targetPowerSpent += 1;
    yield {
      kind: 'emit',
      event: { type: 'reacted', modelId: ctx.targetId, superpower: reaction.superpower },
    };
  }

  // --- Attacker may spend power for extra dice ----------------------------
  const boostAnswer = (yield {
    kind: 'ask',
    prompt: { kind: 'boostAttack', player: ctx.attackerOwner, power: ctx.attackerPower },
  }) as Answer;

  const bonusDice = boostFrom(boostAnswer, ctx.attackerPower);
  if (bonusDice > 0) {
    yield { kind: 'emit', event: { type: 'diceAdded', modelId: ctx.attackerId, count: bonusDice } };
  }

  // --- Attack roll --------------------------------------------------------
  // `attackSuccesses` is a plain number. It cannot be null, and no later step
  // can read it before it exists — the compiler guarantees both.
  const attackSuccesses = (yield {
    kind: 'roll',
    modelId: ctx.attackerId,
    dice: ctx.attackDice + bonusDice,
    mode: 'attack',
  }) as number;

  // --- Defender may pay to reroll -----------------------------------------
  const rerollAnswer = (yield {
    kind: 'ask',
    prompt: { kind: 'rerollDefense', player: ctx.targetOwner, power: ctx.targetPower },
  }) as Answer;

  if (
    rerollAnswer.kind === 'spend' &&
    rerollAnswer.power >= REROLL_COST &&
    ctx.targetPower >= REROLL_COST
  ) {
    targetPowerSpent += REROLL_COST;
    yield { kind: 'emit', event: { type: 'rerolled', modelId: ctx.targetId } };
  }

  // --- Defense roll -------------------------------------------------------
  const defenseSuccesses = (yield {
    kind: 'roll',
    modelId: ctx.targetId,
    dice: ctx.defenseDice,
    mode: 'defense',
  }) as number;

  const rawDamage = Math.max(0, attackSuccesses - defenseSuccesses);

  // --- Defender may prevent damage ----------------------------------------
  let prevented = 0;
  if (rawDamage > 0) {
    const preventAnswer = (yield {
      kind: 'ask',
      prompt: { kind: 'preventDamage', player: ctx.targetOwner, incoming: rawDamage },
    }) as Answer;

    if (preventAnswer.kind === 'spend') {
      const affordable = Math.min(preventAnswer.power, ctx.targetPower - targetPowerSpent);
      prevented = Math.max(0, Math.min(affordable, rawDamage));
      targetPowerSpent += prevented;
      if (prevented > 0) {
        yield {
          kind: 'emit',
          event: { type: 'prevented', modelId: ctx.targetId, amount: prevented },
        };
      }
    }
  }

  // --- Apply, then after-attack effects -----------------------------------
  const damage = rawDamage - prevented;
  if (damage > 0) {
    yield { kind: 'emit', event: { type: 'damage', modelId: ctx.targetId, amount: damage } };
    yield {
      kind: 'emit',
      event: { type: 'powerGained', modelId: ctx.attackerId, amount: damage },
    };
  }

  return {
    damage,
    attackSuccesses,
    defenseSuccesses,
    attackerPowerSpent: bonusDice,
    targetPowerSpent,
    attackerPowerGained: damage,
  };
}

/**
 * Drive the flow, feeding it recorded answers until it needs a new one.
 *
 * Events are accumulated locally and returned fresh each run — that is the
 * mitigation for replay double-firing. Nothing outside this function observes
 * an effect until the run completes.
 */
function drive(ctx: AttackContext, rng: RngState, answers: readonly Answer[]): AttackResult {
  const flow = attackFlow(ctx);
  const events: AttackEvent[] = [];

  let cursor = rng;
  let consumed = 0;
  let reply: Reply = undefined;

  for (let guard = 0; guard < 256; guard++) {
    const step = flow.next(reply);

    if (step.done) {
      return { status: 'done', outcome: step.value, events, rng: cursor };
    }

    const request = step.value;
    switch (request.kind) {
      case 'emit': {
        events.push(request.event);
        reply = undefined;
        break;
      }

      case 'roll': {
        const { result, rng: advanced } = rollPool(cursor, request.dice, request.mode);
        cursor = advanced;
        events.push({
          type: 'rolled',
          modelId: request.modelId,
          mode: request.mode,
          faces: [...result.faces, ...result.bonusFaces],
          successes: result.successes,
        });
        reply = result.successes;
        break;
      }

      case 'ask': {
        const recorded = answers[consumed];
        if (recorded === undefined) {
          // Out of recorded answers — this is where the caller takes over.
          return {
            status: 'awaiting',
            prompt: request.prompt,
            resume: { kind: 'replay', answers: [...answers] },
            events,
          };
        }
        consumed++;
        reply = recorded;
        break;
      }
    }
  }

  throw new Error('Generator flow did not converge.');
}

export const generatorDriver: AttackDriver = {
  name: 'generator',

  begin(ctx, rng) {
    return drive(ctx, rng, []);
  },

  resume(ctx, rng, token: ResumeToken, answer) {
    if (token.kind !== 'replay') throw new Error('Wrong resume token for the generator driver.');
    // Re-run from the top with one more answer. The RNG is the *original* seed,
    // not an advanced one — determinism is what makes that correct.
    return drive(ctx, rng, [...token.answers, answer]);
  },
};
