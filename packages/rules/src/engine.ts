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
 * Status: the skeleton and the move path are real. Attack resolution shows the
 * intended shape but stops short of the full sequence — see NOT_IMPLEMENTED.
 */

import type { Action, Rejection } from './actions.js';
import { roll } from './dice.js';
import type { GameEvent, GameEventInput } from './events.js';
import { hasLineOfSight } from './geometry/los.js';
import { edgeDistance, type Footprint } from './geometry/measure.js';
import { distanceHorizontal, type Vec3 } from './geometry/vec.js';
import { MOVEMENT_INCHES, TABLE_SIZE } from './constants.js';
import type { ModelId } from './ids.js';
import {
  activatableModels,
  getModel,
  type Frame,
  type GameState,
  type Model,
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action): Result {
  const draft: Draft = { state, events: [] };

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

      putModel(draft, { ...model, activatedThisRound: true, usedThisTurn: [] });
      emit(draft, { type: 'ACTIVATION_STARTED', modelId: model.id });

      // TODO(rules): power gained at activation start, and the real action
      // allowance per activation. `2` is a placeholder.
      pushFrame(draft, { kind: 'activation', modelId: model.id, actionsRemaining: 2 });
      return resolve(draft);
    }

    case 'MOVE': {
      const model = getModel(state, action.modelId);
      if (!model) return reject('UNKNOWN_MODEL', `No model ${action.modelId}.`);
      if (model.owner !== action.player)
        return reject('NOT_YOUR_TURN', 'That model belongs to your opponent.');

      const destination = action.path[action.path.length - 1];
      if (!destination) return reject('ILLEGAL_MOVE', 'Move path is empty.');

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
      return resolve(draft);
    }

    case 'ATTACK': {
      const attacker = getModel(state, action.attackerId);
      const target = getModel(state, action.targetId);
      if (!attacker || !target) return reject('UNKNOWN_MODEL', 'Attacker or target not found.');
      if (attacker.owner !== action.player)
        return reject('NOT_YOUR_TURN', 'That model belongs to your opponent.');
      if (target.health === 'ko') return reject('MODEL_KO', 'Target is already KO’d.');

      // TODO(data): range and dice count come from the character's attack
      // profile in @danger-room/data. Hardcoded here to keep the skeleton
      // self-contained.
      const attackRange = 5;
      if (edgeDistance(footprintOf(attacker), footprintOf(target)) > attackRange) {
        return reject('OUT_OF_RANGE', 'Target is out of range for that attack.');
      }

      const los = hasLineOfSight(
        footprintOf(attacker),
        footprintOf(target),
        draft.state.terrain,
      );
      if (!los.clear) return reject('NO_LINE_OF_SIGHT', 'Terrain blocks line of sight.');

      emit(draft, {
        type: 'ATTACK_DECLARED',
        attackerId: attacker.id,
        targetId: target.id,
        attackName: action.attackName,
      });

      pushFrame(draft, {
        kind: 'attack',
        step: 'rollAttack',
        attackerId: attacker.id,
        targetId: target.id,
        attackName: action.attackName,
        attackDice: 5,
        defenseDice: 3,
        successes: null,
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

    case 'DECLARE_REACTION':
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
        // An activation parks waiting for the player's next action rather than
        // resolving itself. This is the normal "engine is idle" resting state.
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
        if (top.pendingPlayers.length === 0) {
          popFrame(draft);
          continue;
        }
        const player = top.pendingPlayers[0];
        if (!player) {
          popFrame(draft);
          continue;
        }
        draft.state = {
          ...draft.state,
          prompt: {
            kind: 'declareReaction',
            player,
            window: top.window,
            // TODO(rules): enumerate genuinely eligible reactions from the
            // player's models, filtered by power cost and trigger conditions.
            options: [],
          },
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

        const damage = model.damage + top.amount;
        putModel(draft, { ...model, damage });
        emit(draft, { type: 'DAMAGE_DEALT', modelId: model.id, amount: top.amount });
        pushFrame(draft, { kind: 'checkKO', modelId: model.id });
        continue;
      }

      case 'checkKO': {
        popFrame(draft);
        const model = getModel(draft.state, top.modelId);
        if (!model) continue;

        // TODO(data): stamina thresholds come from the character card's healthy
        // and injured stat blocks. Placeholders below.
        const healthyStamina = 6;
        const injuredStamina = 6;

        if (model.health === 'healthy' && model.damage >= healthyStamina) {
          putModel(draft, { ...model, health: 'injured', damage: 0 });
          emit(draft, { type: 'MODEL_INJURED', modelId: model.id });
        } else if (model.health === 'injured' && model.damage >= injuredStamina) {
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

  draft.state = { ...draft.state, prompt: null };
  return { ok: true, state: draft.state, events: draft.events };
}

/**
 * One step of the attack sequence. Each step either pushes the next step or
 * pushes a reaction window ahead of it — which is how "you may use this
 * superpower when targeted" gets a place to interrupt.
 */
function advanceAttack(draft: Draft, frame: Extract<Frame, { kind: 'attack' }>): void {
  switch (frame.step) {
    case 'rollAttack': {
      const attack = roll(draft.state.rng, frame.attackDice, 'attack');
      draft.state = { ...draft.state, rng: attack.rng };
      emit(draft, {
        type: 'DICE_ROLLED',
        modelId: frame.attackerId,
        mode: 'attack',
        faces: [...attack.result.faces, ...attack.result.bonusFaces],
        successes: attack.result.successes,
      });
      pushFrame(draft, { ...frame, step: 'rollDefense', successes: attack.result.successes });
      return;
    }

    case 'rollDefense': {
      const defense = roll(draft.state.rng, frame.defenseDice, 'defense');
      draft.state = { ...draft.state, rng: defense.rng };
      emit(draft, {
        type: 'DICE_ROLLED',
        modelId: frame.targetId,
        mode: 'defense',
        faces: [...defense.result.faces, ...defense.result.bonusFaces],
        successes: defense.result.successes,
      });

      const net = Math.max(0, (frame.successes ?? 0) - defense.result.successes);
      pushFrame(draft, { ...frame, step: 'afterAttack' });
      if (net > 0) {
        pushFrame(draft, { kind: 'applyDamage', modelId: frame.targetId, amount: net });
      }
      return;
    }

    case 'afterAttack':
      // TODO(rules): after-attack effect text, power gain from damage dealt,
      // and the afterAttackResolved reaction window.
      return;

    default:
      // Steps not yet modelled fall through without stalling resolution.
      return;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkPrompt(state: GameState, action: Action): Failure | null {
  const prompt = state.prompt;
  if (!prompt) return null;

  const actor = 'player' in action ? action.player : null;
  if (actor !== null && 'player' in prompt && prompt.player !== actor) {
    return reject('NOT_YOUR_TURN', 'Waiting on the other player.');
  }
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
 * TODO(verify): treats the model's centre, not its base. The rulebook's answer
 * to "may a base overhang the edge?" needs checking.
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
