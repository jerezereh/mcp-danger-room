import { describe, expect, it } from 'vitest';
import type { Client } from '@colyseus/core';
import { PROTOCOL_VERSION } from '@danger-room/protocol';

import { GameRoom, isClientMessage } from './GameRoom.js';

/**
 * Regression: inbound payloads were cast straight to ClientMessage and their
 * `.type` read immediately, so a single malformed frame from any connected
 * socket threw inside the room and took the game down for everyone in it.
 */
describe('isClientMessage', () => {
  it.each([null, undefined, 0, 'JOIN', [], [{ type: 'JOIN' }], true])(
    'rejects non-object payload %s',
    value => {
      expect(isClientMessage(value)).toBe(false);
    },
  );

  it.each([{}, { type: null }, { type: 42 }, { type: 'NOT_A_REAL_TYPE' }, { notType: 'JOIN' }])(
    'rejects object without a known type: %s',
    value => {
      expect(isClientMessage(value)).toBe(false);
    },
  );

  it.each(['JOIN', 'SUBMIT_ACTION', 'RESYNC', 'SET_READY', 'CHAT', 'CONCEDE'])(
    'accepts %s',
    type => {
      expect(isClientMessage({ type })).toBe(true);
    },
  );

  it('does not throw on any of these', () => {
    for (const value of [null, undefined, 0, '', [], {}, Object.create(null)]) {
      expect(() => isClientMessage(value)).not.toThrow();
    }
  });
});

/**
 * The version gate.
 *
 * `PROTOCOL_VERSION` is the only thing standing between an updated client and
 * an old server, and until now nothing exercised it — this file covered
 * `isClientMessage` and stopped. That is why bumping the constant to 3 broke no
 * tests, which looked like reassurance and was the opposite.
 *
 * The room needs a handful of things a real Colyseus server would have
 * provided. They are stubbed rather than mocked wholesale: `onJoin` is the unit
 * under test and it touches exactly these.
 */
describe('the protocol version gate', () => {
  function room() {
    const instance = new GameRoom();
    const sent: { to: string; type: string; message: Record<string, unknown> }[] = [];
    const broadcast: string[] = [];

    for (const [key, value] of Object.entries({
      roomId: 'room-1',
      metadata: { name: 'Test room', isPrivate: false },
      clock: { currentTime: 0 },
      broadcast: (type: string) => void broadcast.push(type),
    })) {
      Object.defineProperty(instance, key, { value, writable: true, configurable: true });
    }

    const client = (sessionId: string) => {
      let left = false;
      const handle = {
        sessionId,
        send: (type: string, message: Record<string, unknown>) =>
          void sent.push({ to: sessionId, type, message }),
        leave: () => void (left = true),
      };
      return { handle: handle as unknown as Client, hasLeft: () => left };
    };

    return { instance, sent, broadcast, client };
  }

  it('turns away a client speaking an older protocol', () => {
    const { instance, sent, client } = room();
    const joiner = client('old');

    instance.onJoin(joiner.handle, { displayName: 'Old', protocolVersion: PROTOCOL_VERSION - 1 });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toMatchObject({ type: 'ERROR', code: 'PROTOCOL_MISMATCH' });
    // The number belongs in the message: "reload" is only actionable advice if
    // the player can tell which side is behind.
    expect(sent[0]?.message.message).toContain(`v${PROTOCOL_VERSION}`);
    expect(joiner.hasLeft()).toBe(true);
  });

  it('turns away a client that claims no version at all', () => {
    // Not a hypothetical: `protocolVersion` is optional on the options object,
    // so a client that simply forgets it reaches this branch as `undefined`.
    const { instance, sent, client } = room();
    const joiner = client('silent');

    instance.onJoin(joiner.handle, { displayName: 'Silent' });

    expect(sent[0]?.message).toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(joiner.hasLeft()).toBe(true);
  });

  it('turns away a client from the future as firmly as one from the past', () => {
    const { instance, sent, client } = room();
    const joiner = client('new');

    instance.onJoin(joiner.handle, { displayName: 'New', protocolVersion: PROTOCOL_VERSION + 1 });

    expect(sent[0]?.message).toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(joiner.hasLeft()).toBe(true);
  });

  it('seats a client that speaks the current protocol', () => {
    // The half that makes the three rejections mean something: a gate that
    // refused everybody would pass every test above.
    const { instance, sent, broadcast, client } = room();
    const joiner = client('current');

    instance.onJoin(joiner.handle, { displayName: 'Current', protocolVersion: PROTOCOL_VERSION });

    expect(joiner.hasLeft()).toBe(false);
    expect(sent.map(s => s.type)).toEqual(['JOINED', 'SNAPSHOT']);
    expect(sent[0]?.message).toMatchObject({ seat: 'player1' });
    // A snapshot on join is what a reconnecting player resyncs from, so it has
    // to carry a real state rather than an empty placeholder.
    expect(sent[1]?.message.state).toMatchObject({ round: 1, phase: 'activation' });
    expect(broadcast).toEqual(['ROOM_UPDATED']);
  });
});
