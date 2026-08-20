/**
 * A player that makes no decisions.
 *
 * Answers whatever the engine asks: activate the first character offered,
 * attack the nearest enemy until the actions run out, decide reactions by a
 * flag. It exists so that something can drive a game to its end without a
 * human — the integration test uses it to prove the engine reaches an ending,
 * and `scripts/play-demo.ts` uses it to produce a transcript.
 *
 * Sharing one driver between the two is deliberate: the transcript you read is
 * produced by the same code path the test asserts, so a demo that looks right
 * is evidence about the tested path rather than about a second implementation.
 *
 * The discipline here is dispatching on `prompt.kind` and nothing else. An
 * earlier version assumed every pause was an activation, and stalled the first
 * time a reaction window opened.
 */

import {
  applyAction,
  distanceHorizontal,
  edgeDistance,
  hasLineOfSight,
  MOVEMENT_INCHES,
  RANGE_INCHES,
  vec3,
  type Action,
  type GameState,
  type Model,
  type ModelId,
  type Rejection,
  type Result,
} from '@danger-room/rules';

export interface AutoPlayOptions {
  /** Use reactions when they are offered, rather than declining them. */
  readonly useReactions?: boolean;
}

export interface AutoPlayStep {
  /** What the driver decided to do. */
  readonly action: Action;
  /** What the engine made of it. */
  readonly result: Result;
  /**
   * An action tried first and refused.
   *
   * Reported rather than swallowed: an attack out of range or a blocked move
   * is ordinary, but a driver that silently retries hides the difference
   * between "could not" and "did not try".
   */
  readonly rejected?: { readonly action: Action; readonly rejection: Rejection };
}

const isEnemy = (model: Model, other: Model): boolean =>
  other.owner !== model.owner && other.health !== 'ko' && !other.dazed;

/** The closest enemy still standing. */
function nearestEnemy(state: GameState, model: Model): Model | null {
  let best: Model | null = null;
  let bestGap = Infinity;

  for (const other of Object.values(state.models)) {
    if (!isEnemy(model, other)) continue;
    const gap = edgeDistance(model, other);
    if (gap < bestGap) {
      best = other;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The first attack on this model's current face that reaches the target.
 *
 * Not the *best* attack — the driver does not choose. It takes the first one
 * whose printed range covers the distance, which is enough to keep a game
 * moving and keeps every decision out of the driver.
 *
 * Line of sight is checked with the engine's own function rather than
 * guessed. Skipping it meant a character behind terrain declared an attack
 * every turn, had it refused, and ended its activation — standing still for a
 * whole game while the transcript filled with the same rejection.
 */
function pickAttack(
  state: GameState,
  modelId: ModelId,
): { attackName: string; targetId: ModelId } | null {
  const attacker = state.models[modelId];
  if (!attacker) return null;

  const profile = state.profiles[attacker.characterId];
  if (!profile) return null;

  const target = nearestEnemy(state, attacker);
  if (!target) return null;

  const face = attacker.health === 'healthy' ? profile.healthy : profile.injured;
  const gap = edgeDistance(attacker, target);

  if (!hasLineOfSight(attacker, target, state.terrain).clear) return null;

  for (const attack of face.attacks) {
    if (attack.shape !== 'range' || attack.range === '*') continue;
    if (gap <= RANGE_INCHES[attack.range]) return { attackName: attack.name, targetId: target.id };
  }
  return null;
}

/**
 * Walk toward the nearest enemy, stopping just inside the shortest attack.
 *
 * Without this a character whose attacks are all short-ranged never does
 * anything at all — it starts out of range, has nothing to declare, and ends
 * its activation every round for the whole game. Half the sparring position
 * behaved that way, and it made the transcript useless for reading.
 */
function pickMove(state: GameState, modelId: ModelId): Action | null {
  const model = state.models[modelId];
  if (!model) return null;

  const profile = state.profiles[model.characterId];
  if (!profile) return null;

  const target = nearestEnemy(state, model);
  if (!target) return null;

  const face = model.health === 'healthy' ? profile.healthy : profile.injured;
  const template = face.movement;

  // Close to just inside the longest attack the character has, and never
  // nearer than base contact — a move ending on an overlap is illegal.
  const reach = face.attacks.reduce(
    (best, attack) =>
      attack.shape === 'range' && attack.range !== '*'
        ? Math.max(best, RANGE_INCHES[attack.range])
        : best,
    0,
  );
  const touching = model.radius + target.radius;
  const wanted = Math.max(touching + 0.05, touching + reach - 0.05);

  const centres = distanceHorizontal(model.pos, target.pos);
  const travel = Math.min(MOVEMENT_INCHES[template], centres - wanted);
  if (travel <= 0.05) return null;

  const step = travel / centres;
  const destination = vec3(
    model.pos.x + (target.pos.x - model.pos.x) * step,
    model.pos.y + (target.pos.y - model.pos.y) * step,
    model.pos.z,
  );

  return { type: 'MOVE', player: model.owner, modelId, template, path: [destination] };
}

/** Choose one action for whatever the engine is currently asking. */
export function chooseAction(state: GameState, options: AutoPlayOptions = {}): Action | null {
  const prompt = state.prompt;
  if (!prompt) return null;

  switch (prompt.kind) {
    case 'declareReaction': {
      const option = options.useReactions ? prompt.options[0] : undefined;
      return option
        ? {
            type: 'DECLARE_REACTION',
            player: prompt.player,
            modelId: option.modelId,
            superpower: option.superpower,
          }
        : { type: 'PASS_REACTION', player: prompt.player };
    }

    case 'chooseActivation': {
      const modelId = prompt.options[0];
      return modelId
        ? { type: 'ACTIVATE', player: prompt.player, modelId }
        : { type: 'PASS_TURN', player: prompt.player };
    }

    case 'chooseAction': {
      const attack = pickAttack(state, prompt.modelId);
      if (attack) {
        return {
          type: 'ATTACK',
          player: prompt.player,
          attackerId: prompt.modelId,
          targetId: attack.targetId,
          attackName: attack.attackName,
        };
      }
      // Nothing in range, so close the distance instead.
      return pickMove(state, prompt.modelId) ?? { type: 'END_ACTIVATION', player: prompt.player };
    }

    case 'rollPriority':
      return { type: 'ROLL_PRIORITY', player: prompt.players[0] as never };
  }
}

/**
 * Why this character is about to do nothing.
 *
 * The driver ends an activation whenever it can find neither an attack nor a
 * useful move, and "activates, does nothing" is unreadable without a reason.
 * It lives here rather than in the narrator because the answer depends on the
 * same checks the driver just made.
 */
export function describeInaction(state: GameState, modelId: ModelId): string | null {
  const model = state.models[modelId];
  if (!model) return null;

  const target = nearestEnemy(state, model);
  if (!target) return 'no enemy left standing';

  if (!hasLineOfSight(model, target, state.terrain).clear) {
    // The driver walks straight at its target and has no notion of going
    // around anything. Pathfinding is a real feature and not this one's job.
    return `no line of sight to ${target.characterId}, and no way to path around it`;
  }

  const profile = state.profiles[model.characterId];
  const face = profile && (model.health === 'healthy' ? profile.healthy : profile.injured);
  if (!face || face.attacks.length === 0) return 'no attacks on this card';

  const gap = edgeDistance(model, target);
  const reach = face.attacks.reduce(
    (best, attack) =>
      attack.shape === 'range' && attack.range !== '*'
        ? Math.max(best, RANGE_INCHES[attack.range])
        : best,
    0,
  );
  if (gap > reach) return `${gap.toFixed(1)}" from ${target.characterId}, out of reach`;

  return null;
}

/**
 * Take one step. Null when the engine is asking nothing.
 *
 * An attack or a move that is refused falls back to ending the activation, so
 * a character with nothing useful to do does not hold the game up — but the
 * refusal is reported on the step rather than swallowed.
 */
export function autoPlayStep(state: GameState, options: AutoPlayOptions = {}): AutoPlayStep | null {
  const action = chooseAction(state, options);
  if (!action) return null;

  const result = applyAction(state, action);
  if (result.ok) return { action, result };
  if (action.type !== 'ATTACK' && action.type !== 'MOVE') return { action, result };

  const fallback: Action = { type: 'END_ACTIVATION', player: action.player };
  return {
    action: fallback,
    result: applyAction(state, fallback),
    rejected: { action, rejection: result.rejection },
  };
}
