/**
 * One line of log, per event.
 *
 * Lives in the client rather than in `packages/rules` because it is
 * presentation: it is English, it makes formatting choices, and it is the
 * first thing a translator would have to touch. The engine's job is to say
 * what happened; how that reads is ours.
 *
 * A plain module rather than part of `GameLog.tsx` so that it can be tested —
 * there is no DOM test setup yet (#26), so a `.ts` module is coverable today
 * and a component is not.
 *
 * The switch is exhaustive on purpose. A new event type is a compile error
 * here until somebody decides how to say it out loud, which is the same
 * discipline the demo narrator follows and the reason the event vocabulary
 * stays honest: a beat that is hard to phrase is a beat the board cannot
 * animate either.
 */

import { MAX_ROUNDS, type GameEvent, type GameState } from '@danger-room/rules';

import { labelOf, playerOf } from './names.js';

export function describeEvent(event: GameEvent, state: GameState): string {
  const model = (id: Parameters<typeof labelOf>[1]) => labelOf(state, id);
  const player = (id: Parameters<typeof playerOf>[1]) => playerOf(state, id);

  switch (event.type) {
    case 'ROUND_STARTED':
      return `Round ${event.round} begins.`;
    case 'PRIORITY_ASSIGNED':
      return `${player(event.player)} takes priority.`;
    case 'TURN_PASSED':
      return `${player(event.player)} passes.`;
    case 'ACTIVATION_STARTED':
      return `${model(event.modelId)} activates.`;
    case 'ACTIVATION_ENDED':
      return `${model(event.modelId)} finishes activating.`;
    case 'MODEL_MOVED':
      return `${model(event.modelId)} moves to ${event.to.x.toFixed(1)}, ${event.to.y.toFixed(1)}.`;
    case 'POWER_GAINED':
      return `${model(event.modelId)} gains ${event.amount} power.`;
    case 'POWER_SPENT':
      return `${model(event.modelId)} spends ${event.amount} power.`;
    case 'ATTACK_DECLARED':
      return `${model(event.attackerId)} attacks ${model(event.targetId)} with ${event.attackName}.`;
    case 'DICE_ROLLED':
      return `${model(event.modelId)} rolls ${event.mode}: ${event.successes} success${
        event.successes === 1 ? '' : 'es'
      } (${event.faces.join(', ')}).`;
    case 'DAMAGE_DEALT':
      return `${model(event.modelId)} takes ${event.amount} damage.`;
    case 'MODEL_DAZED':
      return `${model(event.modelId)} is Dazed.`;
    case 'MODEL_INJURED':
      return `${model(event.modelId)} flips to its injured side.`;
    case 'MODEL_KO':
      return `${model(event.modelId)} is KO'd.`;
    case 'CONDITION_APPLIED':
      return `${model(event.modelId)} gains ${event.condition}.`;
    case 'CONDITION_REMOVED':
      return `${model(event.modelId)} loses ${event.condition}.`;
    case 'REACTION_WINDOW_OPENED':
      return `Reaction window: ${event.timing}.`;
    case 'REACTION_USED':
      return `${model(event.modelId)} uses ${event.superpower}.`;
    case 'OBJECTIVE_SCORED':
      return `${player(event.player)} scores ${event.points} VP.`;
    case 'GAME_ENDED':
      return `${describeOutcome(state)}.`;
  }
}

/**
 * How a finished game finished, in words.
 *
 * Reads `state.result` rather than the `GAME_ENDED` event, so the same sentence
 * serves the log line and the header — and so a client that has scrolled past
 * the event, or never had it, can still say who won.
 */
export function describeOutcome(state: GameState): string {
  const result = state.result;
  if (!result) return 'The game is still going';

  const winner = result.winner;
  if (winner === null) {
    return result.reason === 'wipeout'
      ? 'Both squads are wiped out — the game is drawn'
      : `${MAX_ROUNDS} rounds elapse with the scores level — the game is drawn`;
  }

  return result.reason === 'wipeout'
    ? `${playerOf(state, winner)} wins — nothing left standing on the other side`
    : `${playerOf(state, winner)} wins on Victory Points`;
}
