/**
 * Client state.
 *
 * The distinction that keeps this small: *game* state belongs to the rules
 * engine and is replaced wholesale by `applyAction`. This store holds only what
 * the engine has no opinion about — what is selected, which camera we are in,
 * whether we are connected. Mixing the two is how client-side rules divergence
 * starts.
 */

import { create } from 'zustand';
import {
  applyAction,
  createSparringGame,
  type Action,
  type GameEvent,
  type GameState,
  type ModelId,
  type Rejection,
} from '@danger-room/rules';

export type CameraMode = 'top-down' | 'perspective';

interface AppState {
  game: GameState;
  events: GameEvent[];
  selectedModel: ModelId | null;
  cameraMode: CameraMode;
  lastRejection: Rejection | null;

  /** Local play path: the engine runs in this tab, no server involved. */
  dispatch: (action: Action) => void;
  select: (id: ModelId | null) => void;
  setCameraMode: (mode: CameraMode) => void;
  /** Online play path: authoritative state arriving from the server. */
  applySnapshot: (state: GameState) => void;
  newGame: (seed?: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  game: createSparringGame(Date.now()),
  events: [],
  selectedModel: null,
  cameraMode: 'top-down',
  lastRejection: null,

  dispatch: action => {
    const result = applyAction(get().game, action);
    if (!result.ok) {
      set({ lastRejection: result.rejection });
      return;
    }
    set(state => ({
      game: result.state,
      events: [...state.events, ...result.events],
      lastRejection: null,
    }));
  },

  select: id => set({ selectedModel: id }),
  setCameraMode: mode => set({ cameraMode: mode }),
  applySnapshot: game => set({ game, lastRejection: null }),
  newGame: seed => set({ game: createSparringGame(seed ?? Date.now()), events: [] }),
}));
