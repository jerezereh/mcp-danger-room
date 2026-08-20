/**
 * The game log.
 *
 * Rendered from events rather than by diffing state — the same events the
 * server broadcasts and the same ones the board will eventually animate from.
 * Getting a readable log for free is a strong signal the event vocabulary is
 * the right shape; if a line here is hard to phrase, the event is probably too
 * coarse to animate either.
 */

import type { GameEvent } from '@danger-room/rules';

import { useStore } from '../store.js';

function describe(event: GameEvent): string {
  switch (event.type) {
    case 'ROUND_STARTED':
      return `Round ${event.round} begins.`;
    case 'PRIORITY_ASSIGNED':
      return `${event.player} takes priority.`;
    case 'TURN_PASSED':
      return `${event.player} passes.`;
    case 'ACTIVATION_STARTED':
      return `${event.modelId} activates.`;
    case 'ACTIVATION_ENDED':
      return `${event.modelId} finishes activating.`;
    case 'MODEL_MOVED':
      return `${event.modelId} moves to (${event.to.x.toFixed(1)}, ${event.to.y.toFixed(1)}).`;
    case 'POWER_GAINED':
      return `${event.modelId} gains ${event.amount} power.`;
    case 'POWER_SPENT':
      return `${event.modelId} spends ${event.amount} power.`;
    case 'ATTACK_DECLARED':
      return `${event.attackerId} attacks ${event.targetId} with ${event.attackName}.`;
    case 'DICE_ROLLED':
      return `${event.modelId} rolls ${event.mode}: ${event.successes} success${
        event.successes === 1 ? '' : 'es'
      } (${event.faces.join(', ')}).`;
    case 'DAMAGE_DEALT':
      return `${event.modelId} takes ${event.amount} damage.`;
    case 'MODEL_DAZED':
      return `${event.modelId} is Dazed.`;
    case 'MODEL_INJURED':
      return `${event.modelId} flips to its injured side.`;
    case 'MODEL_KO':
      return `${event.modelId} is KO'd.`;
    case 'CONDITION_APPLIED':
      return `${event.modelId} gains ${event.condition}.`;
    case 'CONDITION_REMOVED':
      return `${event.modelId} loses ${event.condition}.`;
    case 'REACTION_WINDOW_OPENED':
      return `Reaction window: ${event.timing}.`;
    case 'REACTION_USED':
      return `${event.modelId} uses ${event.superpower}.`;
    case 'OBJECTIVE_SCORED':
      return `${event.player} scores ${event.points} VP.`;
    case 'GAME_ENDED':
      return event.winner ? `${event.winner} wins.` : 'The game ends in a draw.';
  }
}

export function GameLog() {
  const events = useStore(s => s.events);
  const rejection = useStore(s => s.lastRejection);

  return (
    <div className="flex h-full flex-col">
      <h3 className="border-b border-surface-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Log
      </h3>

      <ol className="flex-1 space-y-1 overflow-auto p-3 text-xs">
        {events.length === 0 && (
          <li className="text-slate-600">Nothing has happened yet.</li>
        )}
        {events.map(event => (
          <li key={event.sequence} className="text-slate-400">
            <span className="mr-2 tabular-nums text-slate-600">{event.sequence}</span>
            {describe(event)}
          </li>
        ))}
      </ol>

      {rejection && (
        <p className="border-t border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
          {rejection.message}
        </p>
      )}
    </div>
  );
}
