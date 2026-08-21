import { describe, expect, it } from 'vitest';
import { CloseCode, type Client } from '@colyseus/core';
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
/**
 * A room with the handful of things a real Colyseus server would have provided.
 *
 * Stubbed narrowly rather than mocked wholesale: `onJoin` and `onLeave` touch
 * exactly these. `allowReconnection` is left to each test, because what it does
 * — resolve, reject, or stay pending — is the entire subject of the `onLeave`
 * cases below.
 */
function room() {
  const instance = new GameRoom();
  const sent: { to: string; type: string; message: Record<string, unknown> }[] = [];
  const broadcast: string[] = [];

  const stub = (key: string, value: unknown) =>
    Object.defineProperty(instance, key, { value, writable: true, configurable: true });

  for (const [key, value] of Object.entries({
    roomId: 'room-1',
    metadata: { name: 'Test room', isPrivate: false },
    clock: { currentTime: 0 },
    broadcast: (type: string) => void broadcast.push(type),
  })) {
    stub(key, value);
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

  /** Join and return the seat the room handed out. */
  const join = (sessionId: string) => {
    const joiner = client(sessionId);
    instance.onJoin(joiner.handle, { displayName: sessionId, protocolVersion: PROTOCOL_VERSION });
    const joined = [...sent].reverse().find(m => m.to === sessionId && m.type === 'JOINED');
    return { ...joiner, seat: joined?.message.seat as string | undefined };
  };

  return { instance, sent, broadcast, client, join, stub };
}

describe('the protocol version gate', () => {
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

/**
 * Leaving, and the close code that says whether it was on purpose.
 *
 * Colyseus 0.16 replaced `onLeave(client, consented: boolean)` with
 * `onLeave(client, code: number)`. The parameter kept its position, so the
 * upgrade in #35 compiled against the old name for a while and nothing failed
 * at runtime — every close code is truthy, so every disconnect read as a
 * deliberate leave and the reconnection window below stopped existing.
 *
 * A type error caught it, and only after a clean build. These tests are so that
 * next time something cheaper does.
 */
describe('leaving', () => {
  /** The room hands out player1, then player2, then spectator. */
  const nextSeat = (r: ReturnType<typeof room>, id: string) => r.join(id).seat;

  it('frees the seat when a player leaves on purpose', () => {
    const r = room();
    r.join('one');

    void r.instance.onLeave(r.client('one').handle, CloseCode.CONSENTED);

    // The seat is observable through who gets it next.
    expect(nextSeat(r, 'later')).toBe('player1');
  });

  it('holds the seat for a player who merely dropped', () => {
    // The regression. Under the old `consented` reading, 1006 was truthy, the
    // seat was released immediately, and a reconnecting player found their own
    // game full and was seated as a spectator.
    const r = room();
    r.join('one');
    r.stub('allowReconnection', () => new Promise<Client>(() => {}));

    void r.instance.onLeave(r.client('one').handle, CloseCode.ABNORMAL_CLOSURE);

    expect(nextSeat(r, 'later')).toBe('player2');
  });

  it('does not hold a seat for a spectator, whatever the code', () => {
    const r = room();
    r.join('one');
    r.join('two');
    expect(nextSeat(r, 'watcher')).toBe('spectator');

    void r.instance.onLeave(r.client('watcher').handle, CloseCode.ABNORMAL_CLOSURE);

    // Still both players seated, so the next arrival is a spectator again —
    // and no reconnection window was opened, which would have thrown here
    // since `allowReconnection` is unstubbed.
    expect(nextSeat(r, 'another')).toBe('spectator');
  });

  it('moves the seat onto the session a returning player comes back on', async () => {
    const r = room();
    r.join('one');
    const returning = r.client('one-again');
    r.stub('allowReconnection', () => Promise.resolve(returning.handle));

    await r.instance.onLeave(r.client('one').handle, CloseCode.ABNORMAL_CLOSURE);

    // Re-keyed, not re-seated: the seat follows the person rather than the
    // socket, so the next arrival is still only player2.
    expect(nextSeat(r, 'later')).toBe('player2');
    expect(r.sent.some(m => m.to === 'one-again' && m.type === 'SNAPSHOT')).toBe(true);
  });

  it('releases the seat when the reconnection window expires', async () => {
    const r = room();
    r.join('one');
    r.stub('allowReconnection', () => Promise.reject(new Error('expired')));

    await r.instance.onLeave(r.client('one').handle, CloseCode.ABNORMAL_CLOSURE);

    expect(nextSeat(r, 'later')).toBe('player1');
  });

  it('ignores a leave from a session that never had a seat', () => {
    const r = room();
    expect(() => r.instance.onLeave(r.client('ghost').handle, CloseCode.CONSENTED)).not.toThrow();
  });
});
