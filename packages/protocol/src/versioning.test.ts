import { describe, expect, it } from 'vitest';
import {
  SAVE_FORMAT_VERSION,
  SCHEMA_VERSION,
  createSparringGame,
  type Action,
  type CardId,
  type GameEvent,
  type ModelId,
  type PlayerId,
  type Rejection,
  type Vec3,
} from '@danger-room/rules';

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type LobbyListing,
  type RoomSummary,
  type Seat,
  type ServerMessage,
} from './index.js';

/**
 * Guards for `PROTOCOL_VERSION`.
 *
 * This constant has the worst record of the three. Its own doc comment says it
 * covers "the rules an action is validated against" changing — and it was not
 * bumped when the die gained its sixth face, nor when the range and movement
 * distances were corrected. Both bumped `SAVE_FORMAT_VERSION` and stopped
 * there. The third time, a reviewer caught it.
 *
 * So all three versions are pinned in **one assertion** below, next to the wire
 * surface itself. `SNAPSHOT` carries a whole `GameState`, so a schema change is
 * a wire change; an action is validated against the rules, so a rules change is
 * a wire change. Moving any one number puts the other two on screen.
 *
 * That is deliberately a nuisance. A silent version is worse: nothing broke
 * during the two misses only because the client does not connect to the server
 * yet, and nobody chose that as a safety property.
 */

const p1 = 'p1' as PlayerId;
const m1 = 'm1' as ModelId;
const m2 = 'm2' as ModelId;
const VEC: Vec3 = { x: 1, y: 2, z: 0 };

/**
 * One fully-populated sample per variant, typed as that variant.
 *
 * Samples rather than a list of `type` tags, which is the second pass at this
 * file: tags caught a new *message* and nothing else, so renaming `CHAT.text`
 * or adding a required field to `GAME_ENDED` would have sailed through. A
 * sample is checked by the compiler in three directions at once —
 *
 *   added required field  → "missing property" on the sample
 *   removed or renamed    → "unknown property" (excess property check)
 *   retyped               → the literal no longer assignable
 *
 * — and the runtime fingerprint turns any of that into a version question. The
 * gap left is a field added as *optional*, which changes nothing here; that is
 * also the one change an old reader survives, so it is the right thing to stay
 * quiet about.
 */
type Samples<U extends { type: string }> = {
  readonly [K in U['type']]: Extract<U, { type: K }>;
};

const REJECTION: Rejection = { code: 'OUT_OF_RANGE', message: 'Too far.' };
const SEAT: Seat = 'player1';
const ROOM: RoomSummary = {
  id: 'room-1',
  name: 'Test room',
  players: [{ seat: SEAT, displayName: 'One', ready: true }],
  spectators: 0,
  phase: 'playing',
  createdAt: 0,
  isPrivate: false,
};
const LOBBY: LobbyListing = { rooms: [ROOM] };

const ACTIONS: Samples<Action> = {
  ACTIVATE: { type: 'ACTIVATE', player: p1, modelId: m1 },
  MOVE: { type: 'MOVE', player: p1, modelId: m1, path: [VEC], template: 'M' },
  ATTACK: { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'STRIKE' },
  USE_SUPERPOWER: {
    type: 'USE_SUPERPOWER',
    player: p1,
    modelId: m1,
    superpower: 'SHIELD',
    targetId: m2,
  },
  DECLARE_REACTION: { type: 'DECLARE_REACTION', player: p1, modelId: m1, superpower: 'SHIELD' },
  PASS_REACTION: { type: 'PASS_REACTION', player: p1 },
  PLAY_TACTIC: { type: 'PLAY_TACTIC', player: p1, card: 'card' as CardId },
  END_ACTIVATION: { type: 'END_ACTIVATION', player: p1 },
  PASS_TURN: { type: 'PASS_TURN', player: p1 },
  ROLL_PRIORITY: { type: 'ROLL_PRIORITY', player: p1 },
};

const EVENTS: Samples<GameEvent> = {
  ROUND_STARTED: { sequence: 1, type: 'ROUND_STARTED', round: 1 },
  PRIORITY_ASSIGNED: { sequence: 1, type: 'PRIORITY_ASSIGNED', player: p1 },
  TURN_PASSED: { sequence: 1, type: 'TURN_PASSED', player: p1 },
  ACTIVATION_STARTED: { sequence: 1, type: 'ACTIVATION_STARTED', modelId: m1 },
  ACTIVATION_ENDED: { sequence: 1, type: 'ACTIVATION_ENDED', modelId: m1 },
  MODEL_MOVED: { sequence: 1, type: 'MODEL_MOVED', modelId: m1, from: VEC, to: VEC },
  POWER_GAINED: { sequence: 1, type: 'POWER_GAINED', modelId: m1, amount: 1 },
  POWER_SPENT: { sequence: 1, type: 'POWER_SPENT', modelId: m1, amount: 1 },
  ATTACK_DECLARED: {
    sequence: 1,
    type: 'ATTACK_DECLARED',
    attackerId: m1,
    targetId: m2,
    attackName: 'STRIKE',
  },
  DICE_ROLLED: {
    sequence: 1,
    type: 'DICE_ROLLED',
    modelId: m1,
    mode: 'attack',
    faces: ['hit'],
    successes: 1,
  },
  DAMAGE_DEALT: { sequence: 1, type: 'DAMAGE_DEALT', modelId: m2, amount: 2 },
  MODEL_DAZED: { sequence: 1, type: 'MODEL_DAZED', modelId: m2 },
  MODEL_INJURED: { sequence: 1, type: 'MODEL_INJURED', modelId: m2 },
  MODEL_KO: { sequence: 1, type: 'MODEL_KO', modelId: m2 },
  CONDITION_APPLIED: { sequence: 1, type: 'CONDITION_APPLIED', modelId: m2, condition: 'bleed' },
  CONDITION_REMOVED: { sequence: 1, type: 'CONDITION_REMOVED', modelId: m2, condition: 'bleed' },
  REACTION_WINDOW_OPENED: { sequence: 1, type: 'REACTION_WINDOW_OPENED', timing: 'targeted' },
  REACTION_USED: {
    sequence: 1,
    type: 'REACTION_USED',
    modelId: m2,
    superpower: 'SHIELD',
    timing: 'targeted',
  },
  OBJECTIVE_SCORED: { sequence: 1, type: 'OBJECTIVE_SCORED', player: p1, points: 2 },
  GAME_ENDED: { sequence: 1, type: 'GAME_ENDED', winner: p1, reason: 'wipeout' },
};

const CLIENT_MESSAGES: Samples<ClientMessage> = {
  JOIN: { type: 'JOIN', protocolVersion: PROTOCOL_VERSION, displayName: 'One' },
  SUBMIT_ACTION: { type: 'SUBMIT_ACTION', action: ACTIONS.ACTIVATE, expectedSequence: 0 },
  RESYNC: { type: 'RESYNC' },
  SET_READY: { type: 'SET_READY', ready: true },
  CHAT: { type: 'CHAT', text: 'gg' },
  CONCEDE: { type: 'CONCEDE' },
};

const SERVER_MESSAGES: Samples<ServerMessage> = {
  JOINED: { type: 'JOINED', seat: SEAT, room: ROOM },
  EVENTS: { type: 'EVENTS', events: [EVENTS.ROUND_STARTED], sequence: 1 },
  SNAPSHOT: { type: 'SNAPSHOT', state: createSparringGame(1) },
  ACTION_REJECTED: { type: 'ACTION_REJECTED', rejection: REJECTION },
  ROOM_UPDATED: { type: 'ROOM_UPDATED', room: ROOM },
  CHAT: { type: 'CHAT', from: 'One', text: 'gg' },
  GAME_OVER: { type: 'GAME_OVER', winner: 'One' },
  ERROR: { type: 'ERROR', code: 'PROTOCOL_MISMATCH', message: 'Reload.' },
};

const shape = (value: object): string => Object.keys(value).sort().join(',');

const shapes = (samples: Readonly<Record<string, object>>): string[] =>
  Object.entries(samples)
    .map(([tag, value]) => `${tag}(${shape(value)})`)
    .sort();

describe('PROTOCOL_VERSION', () => {
  it('still speaks the protocol this version claims to speak', () => {
    expect({
      PROTOCOL_VERSION,
      // Not decoration. Both of these have gone out without this constant
      // moving; having all three numbers in one failure is the cheapest way to
      // stop it happening a fourth time.
      SCHEMA_VERSION,
      SAVE_FORMAT_VERSION,
      clientMessages: shapes(CLIENT_MESSAGES),
      serverMessages: shapes(SERVER_MESSAGES),
      actions: shapes(ACTIONS),
      events: shapes(EVENTS),
      lobby: shapes({ rejection: REJECTION, room: ROOM, listing: LOBBY }),
    }).toEqual({
      PROTOCOL_VERSION: 3,
      SCHEMA_VERSION: 2,
      SAVE_FORMAT_VERSION: 5,
      clientMessages: [
        'CHAT(text,type)',
        'CONCEDE(type)',
        'JOIN(displayName,protocolVersion,type)',
        'RESYNC(type)',
        'SET_READY(ready,type)',
        'SUBMIT_ACTION(action,expectedSequence,type)',
      ],
      serverMessages: [
        'ACTION_REJECTED(rejection,type)',
        'CHAT(from,text,type)',
        'ERROR(code,message,type)',
        'EVENTS(events,sequence,type)',
        'GAME_OVER(type,winner)',
        'JOINED(room,seat,type)',
        'ROOM_UPDATED(room,type)',
        'SNAPSHOT(state,type)',
      ],
      actions: [
        'ACTIVATE(modelId,player,type)',
        'ATTACK(attackName,attackerId,player,targetId,type)',
        'DECLARE_REACTION(modelId,player,superpower,type)',
        'END_ACTIVATION(player,type)',
        'MOVE(modelId,path,player,template,type)',
        'PASS_REACTION(player,type)',
        'PASS_TURN(player,type)',
        'PLAY_TACTIC(card,player,type)',
        'ROLL_PRIORITY(player,type)',
        'USE_SUPERPOWER(modelId,player,superpower,targetId,type)',
      ],
      events: [
        'ACTIVATION_ENDED(modelId,sequence,type)',
        'ACTIVATION_STARTED(modelId,sequence,type)',
        'ATTACK_DECLARED(attackName,attackerId,sequence,targetId,type)',
        'CONDITION_APPLIED(condition,modelId,sequence,type)',
        'CONDITION_REMOVED(condition,modelId,sequence,type)',
        'DAMAGE_DEALT(amount,modelId,sequence,type)',
        'DICE_ROLLED(faces,mode,modelId,sequence,successes,type)',
        'GAME_ENDED(reason,sequence,type,winner)',
        'MODEL_DAZED(modelId,sequence,type)',
        'MODEL_INJURED(modelId,sequence,type)',
        'MODEL_KO(modelId,sequence,type)',
        'MODEL_MOVED(from,modelId,sequence,to,type)',
        'OBJECTIVE_SCORED(player,points,sequence,type)',
        'POWER_GAINED(amount,modelId,sequence,type)',
        'POWER_SPENT(amount,modelId,sequence,type)',
        'PRIORITY_ASSIGNED(player,sequence,type)',
        'REACTION_USED(modelId,sequence,superpower,timing,type)',
        'REACTION_WINDOW_OPENED(sequence,timing,type)',
        'ROUND_STARTED(round,sequence,type)',
        'TURN_PASSED(player,sequence,type)',
      ],
      lobby: [
        'listing(rooms)',
        'rejection(code,message)',
        'room(createdAt,id,isPrivate,name,phase,players,spectators)',
      ],
    });
  });

  it('carries a real GameState in SNAPSHOT, not a placeholder', () => {
    // `SNAPSHOT` is the one message whose payload is the whole schema. If it
    // ever stops being a `GameState`, the coupling asserted above quietly stops
    // meaning anything.
    expect(SERVER_MESSAGES.SNAPSHOT.state.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
