import { describe, expect, it } from 'vitest';

import type { Action } from './actions.js';
import { vec3 } from './geometry/vec.js';
import type { CharacterId, ModelId, PlayerId } from './ids.js';
import {
  deserialize,
  load,
  record,
  save,
  serialize,
  startSession,
  stateAfter,
  SAVE_FORMAT_VERSION,
  type GameSession,
} from './persistence.js';
import type { GameSpec } from './setup.js';

const p1 = 'p1' as PlayerId;
const p2 = 'p2' as PlayerId;
const m1 = 'm1' as ModelId;
const m2 = 'm2' as ModelId;

const spec: GameSpec = {
  seed: 4242,
  players: [
    { id: p1, displayName: 'Player One' },
    { id: p2, displayName: 'Player Two' },
  ],
  models: [
    { id: m1, characterId: 'amazing-spider-man' as CharacterId, owner: p1, pos: vec3(12, 18, 0) },
    { id: m2, characterId: 'black-panther' as CharacterId, owner: p2, pos: vec3(16, 18, 0) },
  ],
};

const script: Action[] = [
  { type: 'ACTIVATE', player: p1, modelId: m1 },
  { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'Spider Strike' },
];

function play(actions: readonly Action[]): GameSession {
  let session = startSession(spec);
  for (const action of actions) {
    const step = record(session, action);
    expect(step.ok).toBe(true);
    if (step.ok) session = step.session;
  }
  return session;
}

describe('recording', () => {
  it('appends applied actions to the log', () => {
    expect(play(script).actions).toEqual(script);
  });

  it('does not log rejected actions', () => {
    // The log records what happened, not what was attempted. Replaying a
    // rejection would freeze that validation rule at the version that saw it.
    const session = startSession(spec);
    const step = record(session, { type: 'ACTIVATE', player: p2, modelId: m1 });

    expect(step.ok).toBe(false);
    expect(session.actions).toEqual([]);
  });

  it('leaves the input session untouched', () => {
    const session = startSession(spec);
    record(session, script[0] as Action);
    expect(session.actions).toEqual([]);
  });
});

describe('save and load', () => {
  it('round-trips to identical state', () => {
    const original = play(script);
    const loaded = load(save(original));

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session.state).toEqual(original.state);
    expect(loaded.session.actions).toEqual(original.actions);
  });

  it('round-trips through a JSON string', () => {
    const original = play(script);
    const loaded = deserialize(serialize(original, 'test save'));

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session.state).toEqual(original.state);
  });

  it('reproduces dice results exactly', () => {
    // The whole approach rests on this: replay must reproduce the RNG stream,
    // not merely a plausible game.
    const original = play(script);
    const loaded = load(save(original));

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session.state.rng).toEqual(original.state.rng);
  });

  it('is far smaller than a state snapshot', () => {
    const session = play(script);
    const logSize = JSON.stringify(save(session)).length;
    const stateSize = JSON.stringify(session.state).length;
    expect(logSize).toBeLessThan(stateSize);
  });

  it('survives an empty log', () => {
    const loaded = load(save(startSession(spec)));
    expect(loaded.ok).toBe(true);
  });
});

describe('load failures', () => {
  it('refuses an unknown format version rather than loading garbage', () => {
    const bad = { ...save(play(script)), formatVersion: SAVE_FORMAT_VERSION + 1 };
    const loaded = load(bad);

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('rejects a malformed save', () => {
    const loaded = load({ formatVersion: SAVE_FORMAT_VERSION } as never);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  it('rejects invalid JSON', () => {
    const loaded = deserialize('{not json');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  // Regression: valid JSON that isn't an object reached the field access and
  // threw past the caller. A hand-edited localStorage value is ordinary input
  // and has to come back as a typed error, not an exception.
  it.each(['null', '42', '"a string"', '[]', 'true'])(
    'returns MALFORMED rather than throwing on %s',
    json => {
      const loaded = deserialize(json);
      expect(loaded.ok).toBe(false);
      if (loaded.ok) return;
      expect(loaded.error.code).toBe('MALFORMED');
    },
  );

  it('does not throw when load is called with null directly', () => {
    expect(() => load(null as never)).not.toThrow();
  });

  it('reports divergence with the offending index instead of truncating', () => {
    // A half-replayed game looks valid and is not, so a rejection mid-replay
    // must be an error rather than a silent stop.
    const saved = save(play(script));
    const tampered = {
      ...saved,
      actions: [
        ...saved.actions,
        { type: 'ACTIVATE', player: p1, modelId: m1 } as Action, // already activated
      ],
    };

    const loaded = load(tampered);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('DIVERGED');
    expect(loaded.error.atAction).toBe(2);
  });
});

describe('replay scrubbing', () => {
  it('reconstructs any prefix of the game', () => {
    const saved = save(play(script));

    const atStart = stateAfter(saved, 0);
    const afterActivate = stateAfter(saved, 1);
    const atEnd = stateAfter(saved, 2);

    expect(atStart.ok && afterActivate.ok && atEnd.ok).toBe(true);
    if (!atStart.ok || !afterActivate.ok || !atEnd.ok) return;

    expect(atStart.session.state.models[m1]?.activatedThisRound).toBe(false);
    expect(afterActivate.session.state.models[m1]?.activatedThisRound).toBe(true);
    expect(atEnd.session.state.sequence).toBeGreaterThan(
      afterActivate.session.state.sequence,
    );
  });

  it('clamps a negative index to the opening position', () => {
    const saved = save(play(script));
    const scrubbed = stateAfter(saved, -5);
    expect(scrubbed.ok).toBe(true);
    if (!scrubbed.ok) return;
    expect(scrubbed.session.actions).toEqual([]);
  });

  it('is stable — scrubbing to the end matches playing straight through', () => {
    const original = play(script);
    const scrubbed = stateAfter(save(original), script.length);

    expect(scrubbed.ok).toBe(true);
    if (!scrubbed.ok) return;
    expect(scrubbed.session.state).toEqual(original.state);
  });
});
