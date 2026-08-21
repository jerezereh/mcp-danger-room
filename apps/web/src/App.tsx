/**
 * App shell.
 *
 * Two views for now — the roster builder (useful today) and the game board
 * (a skeleton). Routing is a `useState` because there are two routes; swap in a
 * router when there are five.
 */

import { useState } from 'react';
import { edgeDistance, hasLineOfSight, MAX_ROUNDS, rangeBandTo } from '@danger-room/rules';

import { ActionBar } from './components/ActionBar.js';
import { Board } from './components/Board.js';
import { characterName, inches } from './lib/format.js';
import { GameLog } from './components/GameLog.js';
import { RosterBuilder } from './components/RosterBuilder.js';
import { selectActionCount, selectGame, useStore } from './store.js';

type View = 'roster' | 'play';

const TABS: { id: View; label: string }[] = [
  { id: 'roster', label: 'Rosters' },
  { id: 'play', label: 'Play' },
];

/**
 * Whose turn it is, and why the last thing you tried did not happen.
 *
 * The engine parks a `Prompt` saying exactly what it is waiting for, and it is
 * the only honest answer to "can I click this?" — with alternating activation
 * the Activate button is legal for one player at a time, and without this the
 * other player's click looks like a broken button rather than a turn order.
 *
 * TODO(#8): this is the seed of a real action bar. Moves and attacks still
 * cannot be issued from the board at all.
 */
function TurnBanner() {
  const game = useStore(selectGame);
  const rejection = useStore(s => s.lastRejection);

  const nameOf = (id: string) => game.players[id]?.displayName ?? id;
  const prompt = game.prompt;

  const waiting =
    game.phase === 'finished'
      ? 'Game over'
      : prompt?.kind === 'chooseActivation'
        ? `${nameOf(prompt.player)} to activate`
        : prompt?.kind === 'chooseAction'
          ? `${nameOf(prompt.player)} acting`
          : 'Resolving…';

  return (
    <div className="border-b border-surface-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Round {game.round}
          <span className="text-slate-600"> / {MAX_ROUNDS}</span>
        </span>
        <span className="truncate text-sm text-slate-200">{waiting}</span>
      </div>

      {rejection && (
        <p className="mt-2 rounded bg-accent/10 px-2 py-1 text-xs text-accent">
          {rejection.message}
        </p>
      )}
    </div>
  );
}

function GameView() {
  const selected = useStore(s => s.selectedModel);
  const game = useStore(selectGame);
  const newGame = useStore(s => s.newGame);
  const actionCount = useStore(selectActionCount);
  const saveToStorage = useStore(s => s.saveToStorage);
  const loadFromStorage = useStore(s => s.loadFromStorage);
  const loadError = useStore(s => s.lastLoadError);

  const model = selected ? game.models[selected] : undefined;

  return (
    <div className="grid h-full grid-cols-[1fr_300px] overflow-hidden">
      <Board />

      <aside className="flex flex-col overflow-y-auto border-l border-surface-border bg-surface-raised">
        <TurnBanner />
        <ActionBar />

        <div className="border-b border-surface-border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Selection
          </h3>
          {model ? (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-slate-100">{characterName(model.characterId)}</p>
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
                <dt>Dazed</dt>
                <dd className="text-right text-slate-200">{model.dazed ? 'yes' : 'no'}</dd>
                <dt>Position</dt>
                <dd className="text-right tabular-nums text-slate-200">
                  {model.pos.x.toFixed(1)}, {model.pos.y.toFixed(1)}
                </dd>
              </dl>

              {/*
                The numeric counterpart to the rings and sight lines on the
                board. If a ring says a model is inside R2 and this says R3,
                the geometry is wrong — which is the point of showing both.
              */}
              <div className="border-t border-surface-border pt-2">
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Measured to
                </h4>
                <ul className="space-y-1 text-xs">
                  {Object.values(game.models)
                    .filter(other => other.id !== model.id)
                    .map(other => {
                      const gap = edgeDistance(model, other);
                      const band = rangeBandTo(model, other);
                      const los = hasLineOfSight(model, other, game.terrain);
                      return (
                        <li key={other.id} className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-slate-400">
                            {characterName(other.characterId)}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                            <span className="text-slate-300">{inches(gap)}</span>
                            <span className="text-[#4ab3c7]">{band ? `R${band}` : '—'}</span>
                            <span
                              title={
                                los.clear
                                  ? 'Line of sight clear'
                                  : `Blocked by ${los.blockedBy.join(', ')}`
                              }
                              className={los.clear ? 'text-emerald-400' : 'text-accent'}
                            >
                              {los.clear ? 'LOS' : 'blocked'}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>

              {/*
                No Activate button here any more — activating is one of the
                things the engine offers, so it belongs in the action bar with
                everything else it offers. This panel inspects; it does not act.
              */}
            </div>
          ) : (
            <p className="text-xs text-slate-600">Click a model on the board.</p>
          )}
        </div>

        <div className="min-h-0 flex-1">
          <GameLog />
        </div>

        {loadError && (
          <p className="border-t border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            {loadError.message}
          </p>
        )}

        <div className="flex items-center gap-1 border-t border-surface-border px-3 py-2 text-xs text-slate-500">
          <button
            type="button"
            onClick={() => newGame()}
            className="transition hover:text-slate-300"
          >
            New
          </button>
          <span className="text-slate-700">·</span>
          <button type="button" onClick={saveToStorage} className="transition hover:text-slate-300">
            Save
          </button>
          <span className="text-slate-700">·</span>
          <button
            type="button"
            onClick={loadFromStorage}
            className="transition hover:text-slate-300"
          >
            Load
          </button>
          {/* The save file is this number of actions plus a seed — nothing else. */}
          <span className="ml-auto tabular-nums text-slate-600">{actionCount} actions</span>
        </div>
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

      <main className="min-h-0 flex-1">{view === 'roster' ? <RosterBuilder /> : <GameView />}</main>
    </div>
  );
}
