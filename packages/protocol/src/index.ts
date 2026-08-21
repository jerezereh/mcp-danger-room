/**
 * @danger-room/protocol
 *
 * The wire contract between client and server. Types only — no logic, so that
 * neither side can drift from the other without a compile error.
 *
 * The protocol is deliberately thin: clients send Actions, the server validates
 * them against the authoritative rules engine and broadcasts the resulting
 * Events. Clients never send state, because a client that can assert state is a
 * client that can cheat.
 */

import type { Action, GameEvent, GameState, Rejection } from '@danger-room/rules';

/**
 * Bumped on any breaking change. Rooms refuse mismatched clients.
 *
 * v2: the `Action` union gained `PASS_TURN`, and the rules an action is
 * validated against changed underneath it. The constant is what makes the
 * version gate in `GameRoom` do anything — left at 1, a new client and an old
 * server would both advertise v1, the client could send `PASS_TURN`, and the
 * old engine's switch would fall through every case and return `undefined`,
 * which `record` then dereferences.
 *
 * v3: `GameState` gained `result` and `GAME_ENDED` gained `reason` (#7), and
 * both cross the wire — `SNAPSHOT` carries a whole `GameState` and `EVENTS`
 * carries `GameEvent`s. A new client joining an old server gets a finished
 * snapshot with no `result` and reports the game as still going. The game also
 * now ends on elimination, so the two engines disagree about when to stop
 * accepting actions, which is the same class of breakage v2 was bumped for.
 *
 * Note for whoever bumps this next: **v3 is later than it should be.** The
 * clause above about "the rules an action is validated against" covers the die
 * gaining its sixth face and the range and movement distances being corrected,
 * and neither bumped this constant — both bumped `SAVE_FORMAT_VERSION` and
 * stopped there. Nothing broke, because the client does not connect yet, but
 * the two constants answer the same question about different transports and
 * they have been drifting apart. A rules change is a protocol change.
 *
 * That last sentence is enforced now rather than hoped for. `versioning.test.ts`
 * pins this constant in one assertion alongside `SCHEMA_VERSION`,
 * `SAVE_FORMAT_VERSION` and the full set of wire tags, so moving any of them
 * puts all three numbers on screen.
 */
export const PROTOCOL_VERSION = 3;

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { readonly type: 'JOIN'; readonly protocolVersion: number; readonly displayName: string }
  | { readonly type: 'SUBMIT_ACTION'; readonly action: Action; readonly expectedSequence: number }
  /** Full-state fetch after a reconnect or a desync. */
  | { readonly type: 'RESYNC' }
  | { readonly type: 'SET_READY'; readonly ready: boolean }
  | { readonly type: 'CHAT'; readonly text: string }
  | { readonly type: 'CONCEDE' };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { readonly type: 'JOINED'; readonly seat: Seat; readonly room: RoomSummary }
  /**
   * The normal update. Events are the animation script; `sequence` lets a client
   * detect that it missed one and ask for a RESYNC.
   */
  | { readonly type: 'EVENTS'; readonly events: readonly GameEvent[]; readonly sequence: number }
  /** Authoritative snapshot. Sent on join, on resync, and after any desync. */
  | { readonly type: 'SNAPSHOT'; readonly state: GameState }
  | { readonly type: 'ACTION_REJECTED'; readonly rejection: Rejection }
  | { readonly type: 'ROOM_UPDATED'; readonly room: RoomSummary }
  | { readonly type: 'CHAT'; readonly from: string; readonly text: string }
  | { readonly type: 'GAME_OVER'; readonly winner: string | null }
  | { readonly type: 'ERROR'; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export type Seat = 'player1' | 'player2' | 'spectator';

export interface RoomSummary {
  readonly id: string;
  readonly name: string;
  readonly players: readonly {
    readonly seat: Seat;
    readonly displayName: string;
    readonly ready: boolean;
  }[];
  readonly spectators: number;
  readonly phase: 'lobby' | 'drafting' | 'playing' | 'finished';
  readonly createdAt: number;
  readonly isPrivate: boolean;
}

export interface LobbyListing {
  readonly rooms: readonly RoomSummary[];
}
