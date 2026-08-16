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

/** Bumped on any breaking change. Rooms refuse mismatched clients. */
export const PROTOCOL_VERSION = 1;

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
  readonly players: readonly { readonly seat: Seat; readonly displayName: string; readonly ready: boolean }[];
  readonly spectators: number;
  readonly phase: 'lobby' | 'drafting' | 'playing' | 'finished';
  readonly createdAt: number;
  readonly isPrivate: boolean;
}

export interface LobbyListing {
  readonly rooms: readonly RoomSummary[];
}
