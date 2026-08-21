/**
 * The game log.
 *
 * Rendered from events rather than by diffing state — the same events the
 * server broadcasts and the same ones the board will eventually animate from.
 * Getting a readable log for free is a strong signal the event vocabulary is
 * the right shape; if a line here is hard to phrase, the event is probably too
 * coarse to animate either.
 */

import { describeEvent } from '../lib/eventText.js';
import { selectGame, useStore } from '../store.js';

export function GameLog() {
  const game = useStore(selectGame);
  const events = useStore(s => s.events);
  const rejection = useStore(s => s.lastRejection);

  return (
    <div className="flex h-full flex-col">
      <h3 className="border-b border-surface-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Log
      </h3>

      <ol className="flex-1 space-y-1 overflow-auto p-3 text-xs">
        {events.length === 0 && <li className="text-slate-600">Nothing has happened yet.</li>}
        {events.map(event => (
          <li key={event.sequence} className="text-slate-400">
            <span className="mr-2 tabular-nums text-slate-600">{event.sequence}</span>
            {describeEvent(event, game)}
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
