/**
 * The engine.
 *
 * One entry point: `applyAction(state, action) -> Result`. Pure, deterministic,
 * and total — it never throws for game-rule reasons, it returns a Rejection.
 *
 * Resolution is a loop over the continuation stack (`state.stack`). An action
 * pushes frames; the loop pops and advances them until either the stack empties
 * or a frame needs input, at which point it parks a `prompt` and returns. The
 * next action resumes from exactly that point.
 *
 * Status: the round loop, the action budget, the move path, and stat lookups
 * against real card profiles are real. Attack resolution shows the intended
 * shape but stops short of the full sequence — no dice modification steps, no
 * reaction windows, no power. See issues #5 and #6.
 */

import type { Action, ActionType, Rejection } from './actions.js';
import { countSuccesses, resolveCriticals, rollPool } from './dice.js';
import type { GameEvent, GameEventInput } from './events.js';
import { hasLineOfSight } from './geometry/los.js';
import { edgeDistance, type Footprint } from './geometry/measure.js';
import { distanceHorizontal, type Vec3 } from './geometry/vec.js';
import {
  MAX_ROUNDS,
  MOVEMENT_INCHES,
  POWER_PER_ROUND,
  RANGE_INCHES,
  TABLE_SIZE,
  type MovementTemplate,
} from './constants.js';
import type { ModelId, PlayerId } from './ids.js';
import {
  findAttack,
  findSuperpower,
  reactionsFor,
  statsAt,
  type DamageType,
  type ReactionEffect,
  type ReactionTiming,
} from './profile.js';
import {
  activatableModels,
  getModel,
  mayPassTurn,
  getStats,
  type AttackFrame,
  type Frame,
  type GameState,
  type Model,
  type Prompt,
} from './state.js';

export interface Success {
  readonly ok: true;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface Failure {
  readonly ok: false;
  readonly rejection: Rejection;
}

export type Result = Success | Failure;

const reject = (code: Rejection['code'], message: string): Failure => ({
  ok: false,
  rejection: { code, message },
});

/** Mutable working copy used inside a single applyAction call. */
interface Draft {
  state: GameState;
  events: GameEvent[];
}

function emit(draft: Draft, event: GameEventInput): void {
  const sequence = draft.state.sequence + 1;
  draft.state = { ...draft.state, sequence };
  draft.events.push({ ...event, sequence } as GameEvent);
}

function putModel(draft: Draft, model: Model): void {
  draft.state = {
    ...draft.state,
    models: { ...draft.state.models, [model.id]: model },
  };
}

function pushFrame(draft: Draft, frame: Frame): void {
  draft.state = { ...draft.state, stack: [...draft.state.stack, frame] };
}

function popFrame(draft: Draft): Frame | undefined {
  const stack = draft.state.stack;
  const top = stack[stack.length - 1];
  if (top === undefined) return undefined;
  draft.state = { ...draft.state, stack: stack.slice(0, -1) };
  return top;
}

const footprintOf = (m: Model): Footprint => ({ pos: m.pos, radius: m.radius, height: m.height });

/**
 * Actions a character gets per activation.
 *
 * Verified: "Each character may make two actions when it Activates."
 *
 * Note that actions *granted* by an effect do not count against this — "If an
 * action is granted by an effect, it doesn't count as one of the character's
 * two actions" — which nothing yet does.
 */
export const ACTIONS_PER_ACTIVATION = 2;

/** Movement templates in ascending order, for comparing one against another. */
const TEMPLATE_ORDER: readonly MovementTemplate[] = ['S', 'M', 'L'];

const longerThan = (a: MovementTemplate, b: MovementTemplate): boolean =>
  TEMPLATE_ORDER.indexOf(a) > TEMPLATE_ORDER.indexOf(b);

/**
 * The activation in progress, if there is one.
 *
 * Only ever the top frame: an activation is the outermost thing on the stack,
 * and anything above it is mid-resolution and answers to a prompt of its own.
 *
 * Callers must check the acting model against `modelId` themselves. The
 * `chooseAction` prompt gate does that too, but only while a prompt is parked
 * — and a snapshot, a crafted save, or a bug can present a stack with no
 * prompt. The rule belongs to the engine, not to the fact that somebody
 * happens to be being asked something.
 */
function activationFrame(state: GameState): Extract<Frame, { kind: 'activation' }> | null {
  const top = state.stack[state.stack.length - 1];
  return top?.kind === 'activation' ? top : null;
}

/**
 * "If a character is Dazed during their Activation, their Activation
 * immediately ends."
 *
 * Implemented by spending the rest of its actions rather than by unwinding the
 * stack, so that whatever is mid-flight — an attack two steps from resolving,
 * a reaction window somebody is being asked about — finishes rather than being
 * discarded. `resolve()` ends the activation as soon as it is reached.
 *
 * TODO(verify): whether "immediately" is meant to abort an in-flight effect.
 * Unreachable today: nothing damages the active character during its own
 * activation, so this cannot yet be triggered.
 */
function endActivationOf(draft: Draft, modelId: ModelId): void {
  const stack = draft.state.stack;
  const index = stack.findIndex(f => f.kind === 'activation' && f.modelId === modelId);
  if (index < 0) return;

  const frame = stack[index];
  if (frame?.kind !== 'activation' || frame.actionsRemaining <= 0) return;

  const next = [...stack];
  next[index] = { ...frame, actionsRemaining: 0 };
  draft.state = { ...draft.state, stack: next };
}

/**
 * Charge one action to the activation in progress.
 *
 * The budget was carried on the frame from the start and never decremented, so
 * a model could move and attack without limit until its owner volunteered to
 * stop. `resolve()` ends the activation once this reaches zero.
 */
function spendAction(draft: Draft): void {
  const frame = activationFrame(draft.state);
  if (!frame) return;

  popFrame(draft);
  pushFrame(draft, { ...frame, actionsRemaining: frame.actionsRemaining - 1 });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action): Result {
  const draft: Draft = { state, events: [] };

  // A finished game accepts nothing. Without this the round loop would happily
  // keep taking activations past the last round, since every other check is
  // about the individual model rather than the game.
  if (state.phase === 'finished') {
    return reject('GAME_OVER', 'The game has finished.');
  }

  // A pending prompt narrows what is legal: only the prompted player may act,
  // and only with an action that answers the prompt.
  if (state.prompt !== null) {
    const gate = checkPrompt(state, action);
    if (gate) return gate;
  }

  switch (action.type) {
    case 'ACTIVATE': {
      const model = getModel(state, action.modelId);
      if (!model) return reject('UNKNOWN_MODEL', `No model ${action.modelId}.`);
      if (model.owner !== action.player)
        return reject('NOT_YOUR_TURN', 'That model belongs to your opponent.');
      if (model.health === 'ko') return reject('MODEL_KO', 'That model is KO’d.');
      if (model.activatedThisRound)
        return reject('MODEL_ALREADY_ACTIVATED', 'That model has already activated this round.');
      if (state.phase !== 'activation')
        return reject('WRONG_PHASE', `Cannot activate during the ${state.phase} phase.`);
      // Alternating activation. The prompt gate catches this too, but only
      // while a prompt is parked — the rule belongs to the engine, not to the
      // fact that somebody happens to be being asked something.
      if (state.activePlayer !== action.player)
        return reject('NOT_YOUR_TURN', 'It is your opponent’s turn to activate.');

      if (model.dazed) return reject('MODEL_DAZED', 'That character is Dazed.');

      putModel(draft, { ...model, activatedThisRound: true, usedThisTurn: [] });
      draft.state = { ...draft.state, lastActivatedBy: action.player };
      emit(draft, { type: 'ACTIVATION_STARTED', modelId: model.id });

      pushFrame(draft, {
        kind: 'activation',
        modelId: model.id,
        actionsRemaining: ACTIONS_PER_ACTIVATION,
      });
      return resolve(draft);
    }

    case 'MOVE': {
      const model = getModel(state, action.modelId);
      if (!model) return reject('UNKNOWN_MODEL', `No model ${action.modelId}.`);
      if (model.owner !== action.player)
        return reject('NOT_YOUR_TURN', 'That model belongs to your opponent.');

      // "A character with a Dazed token can't move or be moved for any reason."
      //
      // TODO(#24): the "or be moved" half needs Push, Throw and Place, which
      // do not exist. When they do, they have to consult this too — a Dazed
      // character is immovable, not merely unable to choose to move.
      if (model.dazed) return reject('MODEL_DAZED', 'That character is Dazed and cannot move.');

      const activation = activationFrame(state);
      if (!activation) return reject('UNEXPECTED_ACTION', 'No activation in progress.');
      if (activation.modelId !== model.id) {
        return reject('UNEXPECTED_ACTION', 'Another character is mid-activation.');
      }

      const destination = action.path[action.path.length - 1];
      if (!destination) return reject('ILLEGAL_MOVE', 'Move path is empty.');

      // A character moves with the template printed on its card. Reaching for
      // a longer one is the difference between a 3" and a 5" move, which is
      // most of what positioning in this game is.
      //
      // Verified: "A character may use a shorter Movement Tool than what is
      // listed on its card." Longer is what is forbidden.
      const printed = getStats(state, model)?.movement;
      if (printed && longerThan(action.template, printed)) {
        return reject(
          'ILLEGAL_MOVE',
          `${action.template} is longer than this character's printed ${printed} move.`,
        );
      }

      // Measure from where the model actually is, not from wherever the client
      // chose to start the path. Without this a one-point path measures zero
      // and the server happily teleports the model anywhere on the table — on
      // the authoritative path, which is precisely what it exists to prevent.
      const budget = MOVEMENT_INCHES[action.template];
      const travelled = pathLength([model.pos, ...action.path]);
      if (travelled > budget + 1e-6) {
        return reject(
          'ILLEGAL_MOVE',
          `Path is ${travelled.toFixed(2)}" but a ${action.template} move allows ${budget}".`,
        );
      }

      if (!onTable(destination)) {
        return reject('ILLEGAL_MOVE', 'Destination is off the table.');
      }

      const blocker = findOverlap(draft.state, model, destination);
      if (blocker) return reject('ILLEGAL_MOVE', `Destination overlaps ${blocker}.`);

      putModel(draft, { ...model, pos: destination });
      emit(draft, {
        type: 'MODEL_MOVED',
        modelId: model.id,
        from: model.pos,
        to: destination,
      });
      spendAction(draft);
      return resolve(draft);
    }

    case 'ATTACK': {
      const attacker = getModel(state, action.attackerId);
      const target = getModel(state, action.targetId);
      if (!attacker || !target) return reject('UNKNOWN_MODEL', 'Attacker or target not found.');
      if (attacker.owner !== action.player)
        return reject('NOT_YOUR_TURN', 'That model belongs to your opponent.');
      if (target.health === 'ko') return reject('MODEL_KO', 'Target is already KO’d.');
      // "A character with a Dazed token ... can't be targeted by attacks or be
      // affected by special rules or superpowers."
      if (target.dazed) {
        return reject('MODEL_DAZED', 'That character is Dazed and cannot be targeted.');
      }
      // "A character can never make an attack without a target and can never
      // choose an allied character to be the target of its attack." Nothing
      // checked this, so a squad could shoot itself.
      if (target.owner === attacker.owner) {
        return reject('ILLEGAL_TARGET', 'That character is allied; attacks must target an enemy.');
      }

      const activation = activationFrame(state);
      if (!activation) return reject('UNEXPECTED_ACTION', 'No activation in progress.');
      if (activation.modelId !== attacker.id) {
        return reject('UNEXPECTED_ACTION', 'Another character is mid-activation.');
      }

      // Every number below used to be a constant in this file — 5 attack dice,
      // 3 defense, range 5, whoever the characters were. They now come off the
      // attacker's card, which is what makes an attack mean something.
      const attackerStats = getStats(state, attacker);
      const targetStats = getStats(state, target);
      if (!attackerStats || !targetStats) {
        return reject('UNKNOWN_MODEL', 'A model on the table has no profile.');
      }

      const attack = findAttack(attackerStats, action.attackName);
      if (!attack) {
        return reject(
          'UNKNOWN_ATTACK',
          `${attacker.characterId} has no attack named “${action.attackName}” on its ${attacker.health} face.`,
        );
      }

      if (attack.shape !== 'range') {
        return reject('NOT_IMPLEMENTED', `${attack.shape} attacks are not implemented yet.`);
      }
      if (attack.range === '*') {
        return reject(
          'NOT_IMPLEMENTED',
          'Attacks whose range their own text defines are not implemented yet.',
        );
      }
      if (attack.cost === 'X') {
        return reject(
          'NOT_IMPLEMENTED',
          'Attacks with a variable Power cost are not implemented yet.',
        );
      }

      // Step 1 — choose an attack. "If the character doesn't have sufficient
      // Power to pay for the attack, it can't select that attack to use." So
      // this is a condition on declaring, not a failure partway through; the
      // attack never starts and no frame is pushed.
      if (attacker.power < attack.cost) {
        return reject(
          'INSUFFICIENT_POWER',
          `${attack.name} costs ${attack.cost} Power and this character has ${attacker.power}.`,
        );
      }

      const attackRange = RANGE_INCHES[attack.range];
      if (edgeDistance(footprintOf(attacker), footprintOf(target)) > attackRange) {
        return reject(
          'OUT_OF_RANGE',
          `${attack.name} reaches Range ${attack.range} (${attackRange}") and the target is further.`,
        );
      }

      const los = hasLineOfSight(footprintOf(attacker), footprintOf(target), draft.state.terrain);
      if (!los.clear) return reject('NO_LINE_OF_SIGHT', 'Terrain blocks line of sight.');

      emit(draft, {
        type: 'ATTACK_DECLARED',
        attackerId: attacker.id,
        targetId: target.id,
        attackName: action.attackName,
      });

      spendAction(draft);
      pushFrame(draft, {
        kind: 'attack',
        step: 'declareTarget',
        attackerId: attacker.id,
        targetId: target.id,
        attackName: action.attackName,
        damageType: attack.type,
        cost: attack.cost,
        attackDice: attack.dice,
        // Which of the three defense stats applies is decided by the attack's
        // damage type. Rolling everything against one number was the single
        // biggest way the placeholder engine misrepresented a character.
        defenseDice: targetStats.defense[attack.type],
        attackFaces: null,
        defenseFaces: null,
        attackBonusFaces: null,
        defenseBonusFaces: null,
        attackSuccesses: null,
        defenseSuccesses: null,
        damage: null,
      });
      return resolve(draft);
    }

    case 'END_ACTIVATION': {
      const top = draft.state.stack[draft.state.stack.length - 1];
      if (top?.kind !== 'activation')
        return reject('UNEXPECTED_ACTION', 'No activation in progress.');
      popFrame(draft);
      emit(draft, { type: 'ACTIVATION_ENDED', modelId: top.modelId });
      return resolve(draft);
    }

    case 'PASS_TURN': {
      if (state.phase !== 'activation')
        return reject('WRONG_PHASE', `Cannot pass during the ${state.phase} phase.`);
      if (state.activePlayer !== action.player)
        return reject('NOT_YOUR_TURN', 'It is your opponent’s turn.');
      if (!mayPassTurn(state, action.player)) {
        return reject(
          'CANNOT_PASS',
          'You may only pass while you have fewer characters left to activate than your opponent.',
        );
      }

      emit(draft, { type: 'TURN_PASSED', player: action.player });
      draft.state = { ...draft.state, prompt: null };
      return resolve(draft);
    }

    case 'PASS_REACTION': {
      const top = draft.state.stack[draft.state.stack.length - 1];
      if (top?.kind !== 'reactionWindow')
        return reject('NO_PROMPT_PENDING', 'No reaction window is open.');

      popFrame(draft);
      pushFrame(draft, {
        ...top,
        pendingPlayers: top.pendingPlayers.filter(p => p !== action.player),
      });
      draft.state = { ...draft.state, prompt: null };
      return resolve(draft);
    }

    case 'DECLARE_REACTION': {
      const top = draft.state.stack[draft.state.stack.length - 1];
      if (top?.kind !== 'reactionWindow')
        return reject('NO_PROMPT_PENDING', 'No reaction window is open.');

      const model = getModel(state, action.modelId);
      if (!model) return reject('UNKNOWN_MODEL', `No model ${action.modelId}.`);
      if (model.owner !== action.player)
        return reject('NOT_YOUR_TURN', 'That model belongs to your opponent.');

      // Checked against the same enumeration the prompt was built from, rather
      // than re-deriving the conditions here. A client that offers a stale
      // option gets the same answer as one that invents a new one.
      const offered = eligibleReactions(state, top, action.player).find(
        option => option.modelId === action.modelId && option.superpower === action.superpower,
      );
      if (!offered) {
        return reject(
          'UNEXPECTED_ACTION',
          `${action.superpower} cannot be used here by that character.`,
        );
      }

      const stats = getStats(state, model);
      const power = stats ? findSuperpower(stats, action.superpower) : undefined;
      const reaction = power?.reaction;
      if (!reaction) return reject('UNEXPECTED_ACTION', `${action.superpower} has no reaction.`);

      putModel(draft, { ...model, power: model.power - offered.cost });

      // Recorded on the window, not on the model. See `ReactionWindowFrame`.
      popFrame(draft);
      pushFrame(draft, {
        ...top,
        used: [...top.used, reactionKey(action.modelId, action.superpower)],
      });
      if (offered.cost > 0) {
        emit(draft, { type: 'POWER_SPENT', modelId: model.id, amount: offered.cost });
      }
      emit(draft, {
        type: 'REACTION_USED',
        modelId: model.id,
        superpower: action.superpower,
        timing: top.timing,
      });

      applyReactionEffect(draft, reaction.effect);

      // The player keeps their place in the queue: the book lets a character
      // use more than one effect in a window, and `usedThisTurn` now excludes
      // this one, so the options shrink and the loop terminates.
      draft.state = { ...draft.state, prompt: null };
      return resolve(draft);
    }

    case 'USE_SUPERPOWER':
    case 'PLAY_TACTIC':
    case 'ROLL_PRIORITY':
      return reject('NOT_IMPLEMENTED', `${action.type} is not implemented yet.`);
  }
}

// ---------------------------------------------------------------------------
// Resolution loop
// ---------------------------------------------------------------------------

/**
 * Advance the continuation stack until it empties or something needs input.
 *
 * `guard` exists because a rules bug that pushes frames forever should surface
 * as a loud error in a test, not as a hung server.
 */
function resolve(draft: Draft, guard = 1000): Result {
  let steps = 0;

  while (draft.state.stack.length > 0 && steps++ < guard) {
    const top = draft.state.stack[draft.state.stack.length - 1];
    if (!top) break;

    switch (top.kind) {
      case 'activation': {
        // Out of actions is the end of the activation, whether or not the
        // player says so. Parking a chooseAction prompt here instead would
        // offer moves that can no longer legally be taken.
        if (top.actionsRemaining <= 0) {
          popFrame(draft);
          emit(draft, { type: 'ACTIVATION_ENDED', modelId: top.modelId });
          continue;
        }

        // Otherwise an activation parks waiting for the player's next action
        // rather than resolving itself. This is the normal "engine is idle
        // mid-activation" resting state.
        draft.state = {
          ...draft.state,
          prompt: {
            kind: 'chooseAction',
            player: mustOwner(draft.state, top.modelId),
            modelId: top.modelId,
          },
        };
        return { ok: true, state: draft.state, events: draft.events };
      }

      case 'reactionWindow': {
        const player = top.pendingPlayers[0];
        if (player === undefined) {
          popFrame(draft);
          continue;
        }

        // Re-enumerated on every pass rather than captured when the window
        // opened, because using one reaction changes what is still available:
        // the Power is spent and the superpower is used up.
        const options = eligibleReactions(draft.state, top, player);
        if (options.length === 0) {
          popFrame(draft);
          pushFrame(draft, { ...top, pendingPlayers: top.pendingPlayers.slice(1) });
          continue;
        }

        draft.state = {
          ...draft.state,
          prompt: { kind: 'declareReaction', player, timing: top.timing, options },
        };
        return { ok: true, state: draft.state, events: draft.events };
      }

      case 'attack': {
        popFrame(draft);
        advanceAttack(draft, top);
        continue;
      }

      case 'applyDamage': {
        popFrame(draft);
        const model = getModel(draft.state, top.modelId);
        if (!model) continue;

        // "A character can only suffer damage equal to its remaining Stamina;
        // any excess damage is ignored." Without the cap, an overkill hit
        // spilled its excess across the flip to the injured face and could
        // take a character from healthy to KO'd in one attack.
        const stats = getStats(draft.state, model);
        const remaining = stats ? Math.max(0, stats.stamina - model.damage) : top.amount;
        const suffered = Math.min(top.amount, remaining);
        if (suffered <= 0) continue;

        // "Whenever a character suffers Damage as a result of an enemy
        // effect, that character gains Power equal to the amount of Damage
        // suffered."
        //
        // Equal to what was *suffered*, so the step 12 cap applies first:
        // damage that was ignored as excess pays for nothing. Dormammu's
        // innate quotes the baseline while replacing it — "it gains 1 {PWR}
        // instead of {PWR} equal to the {DMG} suffered" — which is as close to
        // a citation as the corpus offers.
        const gained = sufferedFromEnemy(draft.state, model, top.source) ? suffered : 0;

        putModel(draft, {
          ...model,
          damage: model.damage + suffered,
          power: model.power + gained,
        });
        emit(draft, { type: 'DAMAGE_DEALT', modelId: model.id, amount: suffered });
        if (gained > 0) {
          emit(draft, { type: 'POWER_GAINED', modelId: model.id, amount: gained });
        }
        pushFrame(draft, { kind: 'checkDazed', modelId: model.id });
        continue;
      }

      case 'checkDazed': {
        popFrame(draft);
        const model = getModel(draft.state, top.modelId);
        if (!model || model.dazed || model.health === 'ko') continue;

        // Stamina is per health state — the injured face of a card routinely
        // prints a different number from the healthy one, and a few print a
        // higher one.
        const profile = draft.state.profiles[model.characterId];
        if (!profile) continue;

        const threshold = statsAt(profile, model.health).stamina;
        if (model.damage < threshold) continue;

        if (model.health === 'healthy') {
          // Dazed, not flipped. The character keeps its damage and its healthy
          // stat card until the Cleanup Phase; it is simply out for the round.
          // Flipping here handed it the injured card's Stamina and attacks for
          // the rest of the round.
          putModel(draft, { ...model, dazed: true });
          emit(draft, { type: 'MODEL_DAZED', modelId: model.id });
          endActivationOf(draft, model.id);
        } else {
          // TODO(verify): the excerpt covering the Cleanup Phase describes
          // Dazed and the flip, but not what happens to a character that would
          // be Dazed while already Injured. Treated as a KO, which is what the
          // engine has always done.
          putModel(draft, { ...model, health: 'ko' });
          emit(draft, { type: 'MODEL_KO', modelId: model.id });
        }
        continue;
      }
    }
  }

  if (steps >= guard) {
    throw new Error('Resolution did not converge — a frame is pushing itself forever.');
  }

  // Nothing is mid-flight, so it is somebody's turn to activate — or the round
  // is over, or the game is. An empty stack used to mean `prompt: null`, which
  // told the client nothing and left the round loop with nowhere to live.
  advanceTurn(draft);
  return { ok: true, state: draft.state, events: draft.events };
}

// ---------------------------------------------------------------------------
// The round loop
// ---------------------------------------------------------------------------

/**
 * Decide who acts next, now that the stack is empty.
 *
 * "Players alternate turns until there are no more characters that can
 * activate." Turns alternate strictly — a player who is behind on models does
 * not lose their turn, they pass it. The Activation Phase ends when a player
 * ends their turn and neither player can activate, at which point neither can
 * pass either, and Cleanup follows.
 */
function advanceTurn(draft: Draft): void {
  // Bounded rather than `while (true)`. Each pass either parks a prompt, moves
  // a turn on, or ends a round, so the worst case is every model passing in
  // every round.
  const guard = (Object.keys(draft.state.models).length + 2) * (MAX_ROUNDS + 2);

  for (let step = 0; step <= guard; step++) {
    if (draft.state.phase === 'finished') {
      draft.state = { ...draft.state, prompt: null };
      return;
    }

    const next = successorOf(draft.state, draft.state.activePlayer);
    if (next === null) return;

    const options = activatableModels(draft.state, next);
    const mayPass = mayPassTurn(draft.state, next);

    // Nobody can act and nobody may pass: the Activation Phase is over.
    if (options.length === 0 && !mayPass) {
      cleanupPhase(draft);
      continue;
    }

    // Nothing to activate, so the turn can only be passed. Taken automatically
    // rather than parked, since there is no decision in it.
    //
    // TODO(rules): "A player who passes can still play Team Tactic Cards
    // before declaring the end of their turn" — so once tactic cards exist,
    // this has to become a real prompt.
    if (options.length === 0) {
      draft.state = { ...draft.state, activePlayer: next };
      emit(draft, { type: 'TURN_PASSED', player: next });
      continue;
    }

    draft.state = {
      ...draft.state,
      activePlayer: next,
      prompt: { kind: 'chooseActivation', player: next, options, mayPass },
    };
    return;
  }

  throw new Error('The round loop did not converge.');
}

/** The player after `player` in turn order. With two players, the opponent. */
function successorOf(state: GameState, player: PlayerId | null): PlayerId | null {
  const order = state.turnOrder;
  if (order.length === 0) return null;
  if (player === null) return order[0] ?? null;

  const index = order.indexOf(player);
  if (index < 0) return order[0] ?? null;
  return order[(index + 1) % order.length] ?? null;
}

/**
 * The Cleanup Phase, then the next round's Power Phase.
 *
 * The printed order is followed exactly, because two of the steps depend on
 * it: priority passes based on who activated last, and it passes *before* the
 * Activated tokens that identify them are removed.
 *
 *   1. Score Victory Points from Crisis Cards.
 *   2. Resolve player effects.
 *   3. Resolve non-player effects.
 *   4. Dazed characters clear damage and conditions, and flip to Injured.
 *   5. If the player who activated last has priority, they pass it on.
 *   6. Remove all Activated tokens.
 *   7. Move to the next Round, starting with a Power Phase.
 */
function cleanupPhase(draft: Draft): void {
  draft.state = { ...draft.state, phase: 'cleanup' };

  // TODO(#7): steps 1–3. Scoring needs Crisis Cards and objectives; there are
  // no player or non-player effects to resolve yet.

  // Step 4 — "Characters with a Dazed token remove all Damage tokens, special
  // conditions, and their Dazed token. They then flip their Stat Cards over to
  // the Injured side."
  for (const model of Object.values(draft.state.models)) {
    if (!model.dazed) continue;
    putModel(draft, {
      ...model,
      dazed: false,
      damage: 0,
      conditions: [],
      health: 'injured',
    });
    emit(draft, { type: 'MODEL_INJURED', modelId: model.id });
  }

  // Step 5 — priority.
  passPriority(draft);

  // Step 6 — remove Activated tokens. `usedThisTurn` goes with them: it is
  // per-turn bookkeeping and no turn survives the round.
  const models = Object.fromEntries(
    Object.values(draft.state.models).map(m => [
      m.id,
      { ...m, activatedThisRound: false, usedThisTurn: [] },
    ]),
  );
  draft.state = { ...draft.state, models, lastActivatedBy: null };

  // Step 7 — the next Round, or the end of the game.
  const round = draft.state.round + 1;
  if (round > MAX_ROUNDS) {
    draft.state = { ...draft.state, phase: 'finished' };
    // TODO(#7): the winner is whoever has the most Victory Points, which are
    // not scored yet.
    emit(draft, { type: 'GAME_ENDED', winner: null });
    return;
  }

  draft.state = { ...draft.state, round };
  emit(draft, { type: 'ROUND_STARTED', round });
  powerPhase(draft);
}

/**
 * Priority, which is passed rather than rolled for.
 *
 * "If the player that activated the last character of the Activation Phase has
 * the Priority token, they pass it to their opponent." So it is deterministic,
 * and it *stays put* when the last activating player did not hold it — which
 * is the half that a roll-off gets wrong half the time. An earlier version of
 * this function drew the holder at random every round.
 */
function passPriority(draft: Draft): void {
  const last = draft.state.lastActivatedBy;
  if (last === null) return;

  const holder = Object.values(draft.state.players).find(p => p.hasPriority);
  if (!holder || holder.id !== last) return;

  const next = successorOf(draft.state, last);
  if (next === null || next === last) return;

  const players = Object.fromEntries(
    Object.values(draft.state.players).map(p => [p.id, { ...p, hasPriority: p.id === next }]),
  );
  draft.state = { ...draft.state, players };
  emit(draft, { type: 'PRIORITY_ASSIGNED', player: next });
}

/**
 * The Power Phase, at the start of every Round.
 *
 * "At the beginning of the Power Phase, all characters gain 1 Power. Then
 * players resolve any player effects that occur during the Power Phase, then
 * resolve all non-player effects that occur during the Power Phase."
 *
 * Leaves `activePlayer` set to the player *before* whoever holds priority, so
 * that `advanceTurn`'s strict alternation hands the first turn to the priority
 * holder: "The player who has priority takes the first turn."
 */
function powerPhase(draft: Draft): void {
  draft.state = { ...draft.state, phase: 'power' };

  // Step 1 — every character on the battlefield. A KO'd character is not on it.
  for (const model of Object.values(draft.state.models)) {
    if (model.health === 'ko') continue;
    putModel(draft, { ...model, power: model.power + POWER_PER_ROUND });
    emit(draft, { type: 'POWER_GAINED', modelId: model.id, amount: POWER_PER_ROUND });
  }

  // TODO(rules): steps 2 and 3 — player effects then non-player effects,
  // starting with the player who has priority. 106 superpowers in the corpus
  // reference this phase, and none of them can fire yet.

  const holder = Object.values(draft.state.players).find(p => p.hasPriority);
  const first = holder?.id ?? draft.state.turnOrder[0] ?? null;

  draft.state = {
    ...draft.state,
    phase: 'activation',
    activePlayer: seatBefore(draft.state, first),
  };
}

/**
 * The seat before this one in turn order.
 *
 * `advanceTurn` always moves to the *successor* of `activePlayer`, so seating
 * the round one place back is how "the player who has priority takes the first
 * turn" is expressed without giving the turn loop a special first case.
 */
function seatBefore(state: GameState, player: PlayerId | null): PlayerId | null {
  const order = state.turnOrder;
  if (player === null || order.length === 0) return null;
  const index = order.indexOf(player);
  if (index < 0) return null;
  return order[(index - 1 + order.length) % order.length] ?? null;
}

/**
 * One step of the attack sequence — the rulebook's 14 steps, in order.
 *
 * Each step does its work and pushes the next. Steps that the book describes
 * as "beginning with the attacker, players resolve any superpowers or effects
 * that trigger..." push their successor *first* and then a reaction window on
 * top of it, so the window resolves before the attack continues. That is the
 * whole reason resolution is a stack rather than a function.
 *
 * See issue #5 for the sequence as printed.
 */
function advanceAttack(draft: Draft, frame: AttackFrame): void {
  switch (frame.step) {
    // Step 2 — the target is already validated; this is the reaction window
    // that comes with declaring it.
    case 'declareTarget': {
      pushFrame(draft, { ...frame, step: 'payPower' });
      openReactionWindow(draft, 'targeted', frame);
      return;
    }

    // Step 3 — "If it cannot, the attack ends."
    case 'payPower': {
      const attacker = getModel(draft.state, frame.attackerId);
      if (!attacker) return;

      if (frame.cost > 0) {
        if (attacker.power < frame.cost) {
          // Affordable at declaration, unaffordable now — something in the
          // targeted window drained it. The attack ends here rather than
          // continuing for free, and nothing further is pushed.
          //
          // TODO(#5): this ends the attack silently. The log shows
          // ATTACK_DECLARED and then nothing, because there is no event for an
          // attack that fizzles. Unreachable today — nothing yet takes Power
          // away from an opponent — so the event is not invented in advance.
          return;
        }
        putModel(draft, { ...attacker, power: attacker.power - frame.cost });
        emit(draft, { type: 'POWER_SPENT', modelId: attacker.id, amount: frame.cost });
      }

      pushFrame(draft, { ...frame, step: 'createAttackPool' });
      return;
    }

    // Step 4 — "an attack pool can never be reduced to fewer than one die."
    case 'createAttackPool': {
      pushFrame(draft, {
        ...frame,
        step: 'createDefensePool',
        attackDice: Math.max(1, frame.attackDice),
      });
      return;
    }

    // Step 5 — same floor, on the defense pool.
    case 'createDefensePool': {
      pushFrame(draft, {
        ...frame,
        step: 'rollAttack',
        defenseDice: Math.max(1, frame.defenseDice),
      });
      return;
    }

    // Step 6 — the initial attack roll.
    case 'rollAttack': {
      const rolled = rollPool(draft.state.rng, frame.attackDice);
      draft.state = { ...draft.state, rng: rolled.rng };
      pushFrame(draft, { ...frame, step: 'rollDefense', attackFaces: rolled.faces });
      return;
    }

    // Step 7 — the initial defense roll. Both pools are rolled before either
    // side's criticals are resolved, which is why rolling is split from
    // resolving criticals in `dice.ts`.
    case 'rollDefense': {
      const rolled = rollPool(draft.state.rng, frame.defenseDice);
      draft.state = { ...draft.state, rng: rolled.rng };
      pushFrame(draft, { ...frame, step: 'resolveCriticals', defenseFaces: rolled.faces });
      return;
    }

    // Step 8 — one extra die per Critical in each *initial* roll, beginning
    // with the attacker. Criticals rolled here add nothing further.
    case 'resolveCriticals': {
      const attackFaces = frame.attackFaces ?? [];
      const defenseFaces = frame.defenseFaces ?? [];

      const attackBonus = resolveCriticals(draft.state.rng, attackFaces);
      const defenseBonus = resolveCriticals(attackBonus.rng, defenseFaces);
      draft.state = { ...draft.state, rng: defenseBonus.rng };

      emit(draft, {
        type: 'DICE_ROLLED',
        modelId: frame.attackerId,
        mode: 'attack',
        faces: [...attackFaces, ...attackBonus.bonusFaces],
        successes: countSuccesses([...attackFaces, ...attackBonus.bonusFaces], 'attack'),
      });
      emit(draft, {
        type: 'DICE_ROLLED',
        modelId: frame.targetId,
        mode: 'defense',
        faces: [...defenseFaces, ...defenseBonus.bonusFaces],
        successes: countSuccesses([...defenseFaces, ...defenseBonus.bonusFaces], 'defense'),
      });

      pushFrame(draft, {
        ...frame,
        step: 'modifyDice',
        attackBonusFaces: attackBonus.bonusFaces,
        defenseBonusFaces: defenseBonus.bonusFaces,
      });
      return;
    }

    // Step 9 — rerolls and changes.
    //
    // TODO(#12): the book splits this into modifying your own dice and then
    // forcing your opponent to modify theirs, each beginning with the
    // attacker. One window covers both, which gets the order wrong the moment
    // two powers meet in it. Unobservable today — no `ReactionEffect` does
    // anything useful after the dice are rolled.
    case 'modifyDice': {
      pushFrame(draft, { ...frame, step: 'compareResults' });
      openReactionWindow(draft, 'modifyDice', frame);
      return;
    }

    // Step 10 — count and subtract.
    case 'compareResults': {
      const attackSuccesses = countSuccesses(
        [...(frame.attackFaces ?? []), ...(frame.attackBonusFaces ?? [])],
        'attack',
      );
      const defenseSuccesses = countSuccesses(
        [...(frame.defenseFaces ?? []), ...(frame.defenseBonusFaces ?? [])],
        'defense',
      );

      pushFrame(draft, {
        ...frame,
        step: 'beforeDamage',
        attackSuccesses,
        defenseSuccesses,
        // "If the defender's total is greater than or equal to the attacker's,
        // the targeted character suffers no Damage."
        damage: Math.max(0, attackSuccesses - defenseSuccesses),
      });
      return;
    }

    // Step 11 — effects that trigger before Damage is dealt.
    case 'beforeDamage': {
      pushFrame(draft, { ...frame, step: 'applyDamage' });
      openReactionWindow(draft, 'beforeDamage', frame);
      return;
    }

    // Step 12 — apply it. The cap at remaining Stamina lives in the
    // `applyDamage` frame, since damage from any source is capped the same way.
    case 'applyDamage': {
      pushFrame(draft, { ...frame, step: 'attackResolved' });
      if ((frame.damage ?? 0) > 0) {
        pushFrame(draft, {
          kind: 'applyDamage',
          modelId: frame.targetId,
          amount: frame.damage ?? 0,
          source: frame.attackerId,
        });
      }
      return;
    }

    // Step 13 — the attack is resolved. A step of its own in the book because
    // step 14 triggers on it having happened, not on damage having been dealt.
    case 'attackResolved': {
      pushFrame(draft, { ...frame, step: 'afterAttack' });
      return;
    }

    // Step 14 — effects that trigger after an attack has been resolved.
    case 'afterAttack': {
      openReactionWindow(draft, 'afterAttack', frame);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/**
 * Open a window, if anybody can actually use it.
 *
 * A window with no eligible reactions is not pushed at all. Prompting a player
 * to decline something they could never have done turns every attack into four
 * pointless questions, and makes the log unreadable.
 *
 * `pendingPlayers` is ordered attacker-first, because every window in the
 * sequence is worded "beginning with the attacker".
 */
function openReactionWindow(draft: Draft, timing: ReactionTiming, frame: AttackFrame): void {
  const attacker = getModel(draft.state, frame.attackerId);
  const target = getModel(draft.state, frame.targetId);
  if (!attacker || !target) return;

  const context: ReactionContext = {
    timing,
    attackerId: frame.attackerId,
    targetId: frame.targetId,
    damageType: frame.damageType,
    used: [],
  };

  const order = [attacker.owner, target.owner].filter(
    (player, index, all) => all.indexOf(player) === index,
  );
  const pendingPlayers = order.filter(
    player => eligibleReactions(draft.state, context, player).length > 0,
  );
  if (pendingPlayers.length === 0) return;

  emit(draft, { type: 'REACTION_WINDOW_OPENED', timing });
  pushFrame(draft, { kind: 'reactionWindow', ...context, pendingPlayers });
}

interface ReactionContext {
  readonly timing: ReactionTiming;
  readonly attackerId: ModelId;
  readonly targetId: ModelId;
  readonly damageType: DamageType;
  /** Reactions already spent in this window — see `ReactionWindowFrame`. */
  readonly used: readonly string[];
}

/** How a used reaction is recorded on the window. */
const reactionKey = (modelId: ModelId, superpower: string): string => `${modelId}::${superpower}`;

export interface ReactionOption {
  readonly modelId: ModelId;
  readonly superpower: string;
  readonly cost: number;
}

/**
 * Reactions this player could genuinely use right now.
 *
 * Four filters, and all four are rules rather than conveniences: the trigger
 * has to match the window, the model has to be the right side of the attack,
 * the damage type has to match where the printed text gates on it, and the
 * model has to be able to pay.
 *
 * TODO(#5): only the attacker and the target are considered. A large family of
 * printed reactions triggers on an *allied character within Range n* being
 * targeted, which needs a measurement from a third model and a range band the
 * structured trigger does not yet carry.
 */
function eligibleReactions(
  state: GameState,
  context: ReactionContext,
  player: PlayerId,
): ReactionOption[] {
  const options: ReactionOption[] = [];

  for (const modelId of [context.attackerId, context.targetId]) {
    const model = getModel(state, modelId);
    if (!model || model.owner !== player || model.health === 'ko') continue;
    // "Dazed characters ... don't have superpowers." Not merely unable to pay
    // for one — they do not have it to use.
    if (model.dazed) continue;

    const stats = getStats(state, model);
    if (!stats) continue;

    const role = modelId === context.targetId ? 'target' : 'attacker';
    for (const power of reactionsFor(stats, context.timing, role, context.damageType)) {
      // A variable cost has no number to check against.
      if (power.cost === 'X') continue;
      if (model.power < power.cost) continue;
      // Already used in *this window*. A once-per-Turn restriction is a
      // different thing, printed on some superpowers and not on others, and
      // `SuperpowerProfile` has nowhere to record it yet — so no reaction is
      // currently restricted beyond the window it is used in.
      if (context.used.includes(reactionKey(modelId, power.name))) continue;

      options.push({ modelId, superpower: power.name, cost: power.cost });
    }
  }

  return options;
}

/**
 * Apply a reaction's effect to the attack it is interrupting.
 *
 * The attack frame sits *below* the reaction window on the stack, so this
 * rewrites in place rather than popping. Searching from the top finds the
 * innermost attack, which is the one this window belongs to.
 */
function modifyAttackInFlight(draft: Draft, change: (frame: AttackFrame) => AttackFrame): void {
  const stack = draft.state.stack;
  for (let i = stack.length - 1; i >= 0; i--) {
    const found = stack[i];
    if (found?.kind !== 'attack') continue;

    const next = [...stack];
    next[i] = change(found);
    draft.state = { ...draft.state, stack: next };
    return;
  }
}

function applyReactionEffect(draft: Draft, effect: ReactionEffect): void {
  switch (effect.kind) {
    case 'addDefenseDice':
      modifyAttackInFlight(draft, frame => ({
        ...frame,
        defenseDice: frame.defenseDice + effect.count,
      }));
      return;

    case 'addAttackDice':
      modifyAttackInFlight(draft, frame => ({
        ...frame,
        attackDice: frame.attackDice + effect.count,
      }));
      return;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Which actions are legal answers to each kind of prompt.
 *
 * Checking only the player is not enough. Without this table, a second
 * ACTIVATE could be submitted while an activation was already in flight,
 * pushing a second activation frame and leaving two on the stack — the
 * alternating-activation loop then has no single "current" model.
 */
const ANSWERS: Record<Prompt['kind'], readonly ActionType[]> = {
  chooseActivation: ['ACTIVATE', 'PASS_TURN'],
  // Mid-activation: act with the activating model or end its activation.
  // Notably *not* ACTIVATE — that is what starts a second one.
  chooseAction: ['MOVE', 'ATTACK', 'USE_SUPERPOWER', 'PLAY_TACTIC', 'END_ACTIVATION'],
  declareReaction: ['DECLARE_REACTION', 'PASS_REACTION'],
  rollPriority: ['ROLL_PRIORITY'],
};

function checkPrompt(state: GameState, action: Action): Failure | null {
  const prompt = state.prompt;
  if (!prompt) return null;

  const actor = 'player' in action ? action.player : null;
  if (actor !== null && 'player' in prompt && prompt.player !== actor) {
    return reject('NOT_YOUR_TURN', 'Waiting on the other player.');
  }

  const allowed = ANSWERS[prompt.kind];
  if (!allowed.includes(action.type)) {
    return reject(
      'UNEXPECTED_ACTION',
      `${action.type} does not answer the pending ${prompt.kind} prompt.`,
    );
  }

  // The activating model is the only one that may act during its activation.
  if (prompt.kind === 'chooseAction') {
    const acting = actingModel(action);
    if (acting !== null && acting !== prompt.modelId) {
      return reject('UNEXPECTED_ACTION', 'Another model is mid-activation.');
    }
  }

  return null;
}

/** The model an action operates on, where there is one. */
function actingModel(action: Action): ModelId | null {
  if ('modelId' in action) return action.modelId;
  if ('attackerId' in action) return action.attackerId;
  return null;
}

function mustOwner(state: GameState, id: ModelId) {
  const model = getModel(state, id);
  if (!model) throw new Error(`Model ${id} vanished mid-resolution.`);
  return model.owner;
}

/**
 * Is this point on the 36"x36" table?
 *
 * TODO(verify): treats the model's centre, not its base. The table size is
 * settled (#10) and every other distance in the game is measured from the base
 * edge, which makes centre-only measurement here the odd one out — but the
 * question this turns on is whether a base may overhang the edge at all, and
 * that is still unanswered. Until it is, widening this would trade one guess
 * for another.
 */
function onTable(p: Vec3): boolean {
  return p.x >= 0 && p.x <= TABLE_SIZE.width && p.y >= 0 && p.y <= TABLE_SIZE.depth;
}

function pathLength(path: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) total += distanceHorizontal(a, b);
  }
  return total;
}

/** Models may not end a move overlapping another base. */
function findOverlap(state: GameState, moving: Model, destination: Vec3): ModelId | null {
  for (const other of Object.values(state.models)) {
    if (other.id === moving.id || other.health === 'ko') continue;
    const gap = distanceHorizontal(destination, other.pos) - moving.radius - other.radius;
    if (gap < 0) return other.id;
  }
  return null;
}

/**
 * Was this damage an enemy effect?
 *
 * Null source means nothing caused it — the board, a rule, an effect with no
 * owner — which is not an enemy effect and grants no Power. A source the
 * sufferer owns is their own doing, and grants nothing either.
 */
function sufferedFromEnemy(state: GameState, sufferer: Model, source: ModelId | null): boolean {
  if (source === null) return false;
  const attacker = getModel(state, source);
  return attacker !== undefined && attacker.owner !== sufferer.owner;
}

/** Convenience for tests and bots: apply a sequence, stopping at the first rejection. */
export function applyAll(state: GameState, actions: readonly Action[]): Result {
  let current = state;
  const events: GameEvent[] = [];

  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) return result;
    current = result.state;
    events.push(...result.events);
  }
  return { ok: true, state: current, events };
}
