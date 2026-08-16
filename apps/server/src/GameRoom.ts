/**
 * A single game of MCP.
 *
 * The server's one job is to be the only place the rules are allowed to run.
 * A client may *predict* an outcome to keep the UI responsive, but the state
 * that counts is the one computed here. That is what makes cheating a matter of
 * "the server said no" rather than a matter of trust.
 *
 * Note that the room stores GameState as an opaque blob rather than mapping it
 * onto Colyseus schema classes. Delta-syncing a deeply nested game state buys
 * little for a two-player turn-based game, and it would force the state shape to
 * be expressed twice — once for the engine and once for the wire.
 */

// Imported from @colyseus/core rather than the `colyseus` wrapper: the wrapper
// is CommonJS and its named exports do not resolve under ESM.
import { Room, type Client } from '@colyseus/core';
import {
  record,
  save,
  startSession,
  vec3,
  type Action,
  type CharacterId,
  type GameEvent,
  type GameSession,
  type GameSpec,
  type GameState,
  type ModelId,
  type PlayerId,
  type SavedGame,
} from '@danger-room/rules';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type RoomSummary,
  type Seat,
  type ServerMessage,
} from '@danger-room/protocol';

interface SeatAssignment {
  readonly seat: Seat;
  readonly displayName: string;
  ready: boolean;
  /** False while the player is dropped but still inside the reconnect window. */
  connected: boolean;
}

/** How long a dropped player keeps their seat. TODO(tune) with real play. */
const RECONNECT_WINDOW_SECONDS = 120;

/** TODO(squads): built from the players' chosen squads once drafting exists. */
function openingPosition(seed: number): GameSpec {
  return {
    seed,
    players: [
      { id: 'p1' as PlayerId, displayName: 'Player One' },
      { id: 'p2' as PlayerId, displayName: 'Player Two' },
    ],
    models: [
      {
        id: 'm1' as ModelId,
        characterId: 'amazing-spider-man' as CharacterId,
        owner: 'p1' as PlayerId,
        pos: vec3(12, 18, 0),
      },
      {
        id: 'm2' as ModelId,
        characterId: 'black-panther' as CharacterId,
        owner: 'p2' as PlayerId,
        pos: vec3(16, 18, 0),
      },
    ],
  };
}

export class GameRoom extends Room {
  override maxClients = 8; // two players plus spectators

  /**
   * Authoritative session — state plus the action log that produced it. Never
   * sent from a client. Holding the log rather than bare state means the room
   * can be persisted, resumed after a restart, and handed to a bug report as a
   * complete reproduction.
   */
  private session: GameSession = startSession(openingPosition(Date.now()));

  private seats = new Map<string, SeatAssignment>();
  private history: GameEvent[] = [];

  private get game(): GameState {
    return this.session.state;
  }

  /** The durable form of this room. Small — a seed plus a list of actions. */
  snapshotForStorage(): SavedGame {
    return save(this.session, this.roomId);
  }

  override onCreate(options: { name?: string; isPrivate?: boolean }): void {
    this.setMetadata({
      name: options.name ?? 'Unnamed game',
      isPrivate: options.isPrivate ?? false,
    });

    this.onMessage('*', (client, type, message) => {
      this.handle(client, message as ClientMessage);
    });
  }

  override onJoin(client: Client, options: { displayName?: string; protocolVersion?: number }): void {
    if (options.protocolVersion !== PROTOCOL_VERSION) {
      this.sendTo(client, {
        type: 'ERROR',
        code: 'PROTOCOL_MISMATCH',
        message: `This room speaks protocol v${PROTOCOL_VERSION}. Reload to update.`,
      });
      client.leave();
      return;
    }

    const seat = this.nextFreeSeat();
    this.seats.set(client.sessionId, {
      seat,
      displayName: options.displayName ?? 'Anonymous',
      ready: false,
      connected: true,
    });

    this.sendTo(client, { type: 'JOINED', seat, room: this.summary() });
    // Snapshot on join covers both a fresh arrival and a reconnect mid-game.
    this.sendTo(client, { type: 'SNAPSHOT', state: this.game });
    this.broadcastMessage({ type: 'ROOM_UPDATED', room: this.summary() });
  }

  /**
   * Hold the seat open for a dropped player.
   *
   * `allowReconnection` has to be awaited here — that is what issues the
   * reconnection token in the first place. Without it a dropped player can only
   * rejoin as a brand new session, land in `onJoin`, find both seats still
   * occupied by their own stale entry, and get assigned spectator in their own
   * game. Leaving on purpose (or timing out) releases the seat so it does not
   * block the room forever.
   */
  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;

    if (consented || seat.seat === 'spectator') {
      this.seats.delete(client.sessionId);
      this.broadcastMessage({ type: 'ROOM_UPDATED', room: this.summary() });
      return;
    }

    seat.connected = false;
    this.broadcastMessage({ type: 'ROOM_UPDATED', room: this.summary() });

    try {
      const returning = await this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);

      // Re-key onto whatever session the player comes back on, so the seat
      // follows the person rather than the socket.
      this.seats.delete(client.sessionId);
      this.seats.set(returning.sessionId, { ...seat, connected: true });

      this.sendTo(returning, { type: 'SNAPSHOT', state: this.game });
      this.broadcastMessage({ type: 'ROOM_UPDATED', room: this.summary() });
    } catch {
      // Window expired — free the seat for someone else.
      this.seats.delete(client.sessionId);
      this.broadcastMessage({ type: 'ROOM_UPDATED', room: this.summary() });
    }
  }

  // -------------------------------------------------------------------------

  private handle(client: Client, message: ClientMessage): void {
    switch (message.type) {
      case 'SUBMIT_ACTION':
        this.submitAction(client, message.action, message.expectedSequence);
        return;

      case 'RESYNC':
        this.sendTo(client, { type: 'SNAPSHOT', state: this.game });
        return;

      case 'SET_READY': {
        const seat = this.seats.get(client.sessionId);
        if (seat) seat.ready = message.ready;
        this.broadcastMessage({ type: 'ROOM_UPDATED', room: this.summary() });
        return;
      }

      case 'CHAT': {
        const seat = this.seats.get(client.sessionId);
        this.broadcastMessage({
          type: 'CHAT',
          from: seat?.displayName ?? 'Anonymous',
          text: message.text.slice(0, 500),
        });
        return;
      }

      case 'CONCEDE': {
        const seat = this.seats.get(client.sessionId);
        this.broadcastMessage({ type: 'GAME_OVER', winner: seat ? this.opponentOf(seat.seat) : null });
        return;
      }

      case 'JOIN':
        return; // handled in onJoin
    }
  }

  private submitAction(client: Client, action: Action, expectedSequence: number): void {
    const seat = this.seats.get(client.sessionId);

    if (!seat || seat.seat === 'spectator') {
      this.sendTo(client, {
        type: 'ACTION_REJECTED',
        rejection: { code: 'NOT_YOUR_TURN', message: 'Spectators cannot act.' },
      });
      return;
    }

    // Stale submission — the client acted on a board that has since moved on.
    // Resync rather than applying an action whose preconditions may have gone.
    if (expectedSequence !== this.game.sequence) {
      this.sendTo(client, { type: 'SNAPSHOT', state: this.game });
      return;
    }

    // The client claims a player id; the server substitutes the one bound to
    // this connection so a forged `player` field cannot move enemy models.
    const authenticated = { ...action, player: this.playerIdFor(seat.seat) } as Action;

    const step = record(this.session, authenticated);
    if (!step.ok) {
      if (!step.result.ok) {
        this.sendTo(client, { type: 'ACTION_REJECTED', rejection: step.result.rejection });
      }
      return;
    }

    this.session = step.session;
    const events = step.result.ok ? step.result.events : [];
    this.history.push(...events);
    this.broadcastMessage({ type: 'EVENTS', events, sequence: this.game.sequence });
  }

  // -------------------------------------------------------------------------

  private nextFreeSeat(): Seat {
    const taken = new Set([...this.seats.values()].map(s => s.seat));
    if (!taken.has('player1')) return 'player1';
    if (!taken.has('player2')) return 'player2';
    return 'spectator';
  }

  private playerIdFor(seat: Seat) {
    return (seat === 'player1' ? 'p1' : 'p2') as Action['player'];
  }

  private opponentOf(seat: Seat): string | null {
    if (seat === 'player1') return 'player2';
    if (seat === 'player2') return 'player1';
    return null;
  }

  private summary(): RoomSummary {
    return {
      id: this.roomId,
      name: (this.metadata?.name as string) ?? 'Unnamed game',
      players: [...this.seats.values()]
        .filter(s => s.seat !== 'spectator')
        .map(s => ({ seat: s.seat, displayName: s.displayName, ready: s.ready })),
      spectators: [...this.seats.values()].filter(s => s.seat === 'spectator').length,
      phase: this.game.phase === 'finished' ? 'finished' : 'playing',
      createdAt: this.clock.currentTime,
      isPrivate: Boolean(this.metadata?.isPrivate),
    };
  }

  /**
   * Typed wrappers so no untyped payload escapes onto the wire. Named `sendTo`
   * rather than `send` to avoid shadowing Room's own overloaded `send`.
   */
  private sendTo(client: Client, message: ServerMessage): void {
    client.send(message.type, message);
  }

  private broadcastMessage(message: ServerMessage): void {
    this.broadcast(message.type, message);
  }
}
