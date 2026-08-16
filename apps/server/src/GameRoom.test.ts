import { describe, expect, it } from 'vitest';

import { isClientMessage } from './GameRoom.js';

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
