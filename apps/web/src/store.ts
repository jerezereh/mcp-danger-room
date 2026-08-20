/**
 * Client state.
 *
 * The distinction that keeps this small: *game* state belongs to the rules
 * engine and is replaced wholesale by the engine's own reducers. This store
 * holds only what the engine has no opinion about — what is selected, which
 * camera we are in, whether we are connected. Mixing the two is how client-side
 * rules divergence starts.
 *
 * The game is held as a `GameSession` (state plus the action log that produced
 * it) rather than a bare `GameState`, so saving is always possible and the log
 * cannot drift out of step with the state it describes.
 */

import { create } from 'zustand';

import { playableSparringSpec } from './lib/gameSetup.js';
import {
  deserialize,
  record,
  serialize,
  startSession,
  type Action,
  type GameEvent,
  type GameSession,
  type GameState,
  type LoadError,
  type ModelId,
  type MovementTemplate,
  type Rejection,
} from '@danger-room/rules';

export type CameraMode = 'top-down' | 'perspective';

/**
 * What a click on the board means right now.
 *
 * The board is one surface with several jobs — inspect a model, choose where
 * to move, choose what to shoot — and a click cannot mean all three at once.
 * The mode is chosen in the action bar and consumed by the next board click.
 *
 * Deliberately *not* game state. The engine has no opinion about what the
 * pointer is doing, and giving it one is how client-side rules divergence
 * starts (`docs/ARCHITECTURE.md` §8).
 */
export type BoardMode =
  | { readonly kind: 'idle' }
  /** Click the table to move there, with this template. */
  | { readonly kind: 'move'; readonly template: MovementTemplate }
  /** Click an enemy to attack it with this attack. */
  | { readonly kind: 'attack'; readonly attackName: string };

const IDLE: BoardMode = { kind: 'idle' };

const STORAGE_KEY = 'danger-room:current-game';

interface AppState {
  session: GameSession;
  events: GameEvent[];
  selectedModel: ModelId | null;
  cameraMode: CameraMode;
  boardMode: BoardMode;
  lastRejection: Rejection | null;
  lastLoadError: LoadError | null;

  /** Local play: the engine runs in this tab, no server involved. */
  dispatch: (action: Action) => void;
  select: (id: ModelId | null) => void;
  setCameraMode: (mode: CameraMode) => void;
  setBoardMode: (mode: BoardMode) => void;
  /** Online play: authoritative state arriving from the server. */
  applySnapshot: (state: GameState) => void;
  newGame: (seed?: number) => void;

  saveToStorage: () => void;
  loadFromStorage: () => void;
  exportSave: () => string;
}

export const useStore = create<AppState>((set, get) => ({
  session: startSession(playableSparringSpec(Date.now())),
  events: [],
  selectedModel: null,
  cameraMode: 'top-down',
  boardMode: IDLE,
  lastRejection: null,
  lastLoadError: null,

  dispatch: action => {
    const step = record(get().session, action);
    if (!step.ok) {
      // The board mode survives a rejection on purpose: an out-of-range click
      // should leave you still choosing a target, not back at the start.
      set({ lastRejection: step.result.ok ? null : step.result.rejection });
      return;
    }
    set(state => ({
      session: step.session,
      events: [...state.events, ...(step.result.ok ? step.result.events : [])],
      // An accepted action consumes the mode. What is legal next is decided by
      // the prompt the engine just parked, not by what the pointer was doing.
      boardMode: IDLE,
      lastRejection: null,
    }));
  },

  select: id => set({ selectedModel: id }),
  setCameraMode: mode => set({ cameraMode: mode }),
  setBoardMode: mode => set({ boardMode: mode }),

  /**
   * Server snapshots replace state but cannot replace the log — the client
   * never saw the actions of a game it joined mid-way. The log is reset rather
   * than left stale, so a save taken now is honestly empty instead of wrong.
   */
  applySnapshot: state =>
    set(current => ({
      session: { setup: current.session.setup, state, actions: [] },
      lastRejection: null,
    })),

  newGame: seed =>
    set({
      session: startSession(playableSparringSpec(seed ?? Date.now())),
      events: [],
      selectedModel: null,
      boardMode: IDLE,
      lastRejection: null,
      lastLoadError: null,
    }),

  saveToStorage: () => {
    localStorage.setItem(STORAGE_KEY, serialize(get().session));
  },

  loadFromStorage: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const loaded = deserialize(raw);
    if (!loaded.ok) {
      set({ lastLoadError: loaded.error });
      return;
    }
    set({
      session: loaded.session,
      events: [],
      lastLoadError: null,
      selectedModel: null,
      boardMode: IDLE,
    });
  },

  exportSave: () => serialize(get().session),
}));

/** Convenience selectors, so components never reach past the session. */
export const selectGame = (s: AppState): GameState => s.session.state;
export const selectPrompt = (s: AppState) => s.session.state.prompt;
export const selectActionCount = (s: AppState): number => s.session.actions.length;
