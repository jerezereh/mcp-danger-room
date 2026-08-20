/**
 * Actions — the only way state ever changes.
 *
 * An Action is a *request* from a player, not a guaranteed mutation. The engine
 * validates it against the current state and may reject it. Because actions are
 * small, serializable, and totally ordered, the network protocol is just
 * "client sends Action, server broadcasts the resulting events" — and a replay
 * is nothing more than a seed plus an action list.
 */

import type { Vec3 } from './geometry/vec.js';
import type { CardId, ModelId, PlayerId } from './ids.js';

export type Action =
  /** Begin a model's activation during the alternating-activation loop. */
  | { readonly type: 'ACTIVATE'; readonly player: PlayerId; readonly modelId: ModelId }
  /** Move along a path. Path is a polyline so curved templates stay expressible. */
  | {
      readonly type: 'MOVE';
      readonly player: PlayerId;
      readonly modelId: ModelId;
      readonly path: readonly Vec3[];
      readonly template: 'S' | 'M' | 'L';
    }
  | {
      readonly type: 'ATTACK';
      readonly player: PlayerId;
      readonly attackerId: ModelId;
      readonly targetId: ModelId;
      readonly attackName: string;
    }
  | {
      readonly type: 'USE_SUPERPOWER';
      readonly player: PlayerId;
      readonly modelId: ModelId;
      readonly superpower: string;
      readonly targetId?: ModelId;
    }
  /** Use a reactive superpower in the open reaction window. */
  | {
      readonly type: 'DECLARE_REACTION';
      readonly player: PlayerId;
      readonly modelId: ModelId;
      readonly superpower: string;
    }
  | { readonly type: 'PASS_REACTION'; readonly player: PlayerId }
  | { readonly type: 'PLAY_TACTIC'; readonly player: PlayerId; readonly card: CardId }
  | { readonly type: 'END_ACTIVATION'; readonly player: PlayerId }
  /** End your turn without activating anybody. Legal only when behind on models. */
  | { readonly type: 'PASS_TURN'; readonly player: PlayerId }
  | { readonly type: 'ROLL_PRIORITY'; readonly player: PlayerId };

export type ActionType = Action['type'];

/** A rejected action, with a reason the UI can show verbatim. */
export interface Rejection {
  readonly code:
    | 'NOT_YOUR_TURN'
    | 'WRONG_PHASE'
    | 'UNKNOWN_MODEL'
    | 'MODEL_ALREADY_ACTIVATED'
    | 'MODEL_DAZED'
    | 'MODEL_KO'
    | 'CANNOT_PASS'
    | 'UNKNOWN_ATTACK'
    | 'ILLEGAL_TARGET'
    | 'OUT_OF_RANGE'
    | 'NO_LINE_OF_SIGHT'
    | 'INSUFFICIENT_POWER'
    | 'ILLEGAL_MOVE'
    | 'NO_PROMPT_PENDING'
    | 'UNEXPECTED_ACTION'
    | 'GAME_OVER'
    | 'NOT_IMPLEMENTED';
  readonly message: string;
}
