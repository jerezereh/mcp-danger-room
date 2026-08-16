/**
 * App shell.
 *
 * Two views for now — the roster builder (useful today) and the game board
 * (a skeleton). Routing is a `useState` because there are two routes; swap in a
 * router when there are five.
 */

import { useState } from 'react';

import { Board } from './components/Board.js';
import { GameLog } from './components/GameLog.js';
import { RosterBuilder } from './components/RosterBuilder.js';
import { useStore } from './store.js';

type View = 'roster' | 'play';

const TABS: { id: View; label: string }[] = [
  { id: 'roster', label: 'Rosters' },
  { id: 'play', label: 'Play' },
];

function GameView() {
  const dispatch = useStore(s => s.dispatch);
  const selected = useStore(s => s.selectedModel);
  const game = useStore(s => s.game);
  const newGame = useStore(s => s.newGame);

  const model = selected ? game.models[selected] : undefined;

  return (
    <div className="grid h-full grid-cols-[1fr_300px] overflow-hidden">
      <Board />

      <aside className="flex flex-col overflow-hidden border-l border-surface-border bg-surface-raised">
        <div className="border-b border-surface-border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Selection
          </h3>
          {model ? (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-slate-100">{model.characterId}</p>
              <dl className="grid grid-cols-2 gap-1 text-xs text-slate-400">
                <dt>Health</dt>
                <dd className="text-right text-slate-200">{model.health}</dd>
                <dt>Damage</dt>
                <dd className="text-right tabular-nums text-slate-200">{model.damage}</dd>
                <dt>Power</dt>
                <dd className="text-right tabular-nums text-slate-200">{model.power}</dd>
                <dt>Activated</dt>
                <dd className="text-right text-slate-200">
                  {model.activatedThisRound ? 'yes' : 'no'}
                </dd>
              </dl>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={model.activatedThisRound}
                  onClick={() =>
                    dispatch({ type: 'ACTIVATE', player: model.owner, modelId: model.id })
                  }
                  className="flex-1 rounded bg-accent/80 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-slate-600"
                >
                  Activate
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600">Click a model on the board.</p>
          )}
        </div>

        <div className="min-h-0 flex-1">
          <GameLog />
        </div>

        <button
          type="button"
          onClick={() => newGame()}
          className="border-t border-surface-border px-3 py-2 text-xs text-slate-500 transition hover:text-slate-300"
        >
          New local game
        </button>
      </aside>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>('roster');

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-6 border-b border-surface-border bg-surface-raised px-4">
        <span className="py-3 text-sm font-semibold tracking-tight text-slate-100">
          Danger Room
        </span>

        <nav className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={`border-b-2 px-3 py-3 text-sm transition ${
                view === tab.id
                  ? 'border-accent text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1">
        {view === 'roster' ? <RosterBuilder /> : <GameView />}
      </main>
    </div>
  );
}
