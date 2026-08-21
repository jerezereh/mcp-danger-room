import { describe, expect, it } from 'vitest';
import {
  SAVE_FORMAT_VERSION,
  SCHEMA_VERSION,
  type Action,
  type GameEvent,
} from '@danger-room/rules';

import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './index.js';

/**
 * Guards for `PROTOCOL_VERSION`.
 *
 * This constant has the worst record of the three. Its own doc comment says it
 * covers "the rules an action is validated against" changing — and it was not
 * bumped when the die gained its sixth face, nor when the range and movement
 * distances were corrected. Both of those bumped `SAVE_FORMAT_VERSION` and
 * stopped there. The third time, a reviewer caught it.
 *
 * The pattern is clear enough to encode: the two constants answer the same
 * question about different transports, and the person changing the rules is
 * thinking about saves. So all three versions are pinned in **one assertion**
 * below, next to the wire surface itself. Bumping any one of them fails this
 * test, and the developer fixing it has the other two on screen.
 *
 * That is deliberately a nuisance. A silent version is worse: nothing broke
 * during the two misses only because the client does not connect to the server
 * yet, and that is not a safety property anyone chose.
 */

/*
 * `Record<Union['type'], true>` rather than a hand-written array. Adding a
 * message, an action or an event is a *compile* error here until it is listed,
 * so the reminder arrives before the test runs — and cannot be silenced by
 * updating an expected array without thinking about what changed.
 */
const CLIENT_MESSAGES: Record<ClientMessage['type'], true> = {
  JOIN: true,
  SUBMIT_ACTION: true,
  RESYNC: true,
  SET_READY: true,
  CHAT: true,
  CONCEDE: true,
};

const SERVER_MESSAGES: Record<ServerMessage['type'], true> = {
  JOINED: true,
  EVENTS: true,
  SNAPSHOT: true,
  ACTION_REJECTED: true,
  ROOM_UPDATED: true,
  CHAT: true,
  GAME_OVER: true,
  ERROR: true,
};

/** Everything a client may send inside `SUBMIT_ACTION`. */
const ACTIONS: Record<Action['type'], true> = {
  ACTIVATE: true,
  MOVE: true,
  ATTACK: true,
  USE_SUPERPOWER: true,
  DECLARE_REACTION: true,
  PASS_REACTION: true,
  PLAY_TACTIC: true,
  END_ACTIVATION: true,
  PASS_TURN: true,
  ROLL_PRIORITY: true,
};

/** Everything the server may send inside `EVENTS`. */
const EVENTS: Record<GameEvent['type'], true> = {
  ROUND_STARTED: true,
  PRIORITY_ASSIGNED: true,
  TURN_PASSED: true,
  ACTIVATION_STARTED: true,
  ACTIVATION_ENDED: true,
  MODEL_MOVED: true,
  POWER_GAINED: true,
  POWER_SPENT: true,
  ATTACK_DECLARED: true,
  DICE_ROLLED: true,
  DAMAGE_DEALT: true,
  MODEL_DAZED: true,
  MODEL_INJURED: true,
  MODEL_KO: true,
  CONDITION_APPLIED: true,
  CONDITION_REMOVED: true,
  REACTION_WINDOW_OPENED: true,
  REACTION_USED: true,
  OBJECTIVE_SCORED: true,
  GAME_ENDED: true,
};

const keysOf = <T extends object>(shape: T): string[] => Object.keys(shape).sort();

describe('PROTOCOL_VERSION', () => {
  it('still speaks the protocol this version claims to speak', () => {
    expect({
      PROTOCOL_VERSION,
      // Not decoration. `SNAPSHOT` carries a whole `GameState`, so a schema
      // change is a wire change; and an action is validated against the rules,
      // so a rules change is a wire change too. Both of those have gone out
      // without this constant moving. Having all three numbers in one failure
      // is the cheapest way to stop it happening a fourth time.
      SCHEMA_VERSION,
      SAVE_FORMAT_VERSION,
      clientMessages: keysOf(CLIENT_MESSAGES),
      serverMessages: keysOf(SERVER_MESSAGES),
      actions: keysOf(ACTIONS),
      events: keysOf(EVENTS),
    }).toEqual({
      PROTOCOL_VERSION: 3,
      SCHEMA_VERSION: 2,
      SAVE_FORMAT_VERSION: 5,
      clientMessages: ['CHAT', 'CONCEDE', 'JOIN', 'RESYNC', 'SET_READY', 'SUBMIT_ACTION'],
      serverMessages: [
        'ACTION_REJECTED',
        'CHAT',
        'ERROR',
        'EVENTS',
        'GAME_OVER',
        'JOINED',
        'ROOM_UPDATED',
        'SNAPSHOT',
      ],
      actions: [
        'ACTIVATE',
        'ATTACK',
        'DECLARE_REACTION',
        'END_ACTIVATION',
        'MOVE',
        'PASS_REACTION',
        'PASS_TURN',
        'PLAY_TACTIC',
        'ROLL_PRIORITY',
        'USE_SUPERPOWER',
      ],
      events: [
        'ACTIVATION_ENDED',
        'ACTIVATION_STARTED',
        'ATTACK_DECLARED',
        'CONDITION_APPLIED',
        'CONDITION_REMOVED',
        'DAMAGE_DEALT',
        'DICE_ROLLED',
        'GAME_ENDED',
        'MODEL_DAZED',
        'MODEL_INJURED',
        'MODEL_KO',
        'MODEL_MOVED',
        'OBJECTIVE_SCORED',
        'POWER_GAINED',
        'POWER_SPENT',
        'PRIORITY_ASSIGNED',
        'REACTION_USED',
        'REACTION_WINDOW_OPENED',
        'ROUND_STARTED',
        'TURN_PASSED',
      ],
    });
  });
});
