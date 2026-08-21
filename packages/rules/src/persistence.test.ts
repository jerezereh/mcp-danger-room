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
  type SavedGame,
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

// The spec above carries no profiles, so both models play as training
// dummies whose one attack is called STRIKE. See `trainingProfile`.
const script: Action[] = [
  { type: 'ACTIVATE', player: p1, modelId: m1 },
  { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'STRIKE' },
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

  // Regression: `setup` being truthy was the only check, so a missing array
  // reached createGame and threw "spec.players is not iterable" past the
  // caller. A malformed action entry threw the same way inside applyAction.
  describe.each([
    ['setup missing players', { seed: 1, models: [] }, []],
    ['setup missing models', { seed: 1, players: [] }, []],
    ['setup with no seed', { players: [], models: [] }, []],
    ['setup is a string', 'nope', []],
    ['terrain is not an array', { seed: 1, players: [], models: [], terrain: 5 }, []],
  ])('malformed setup: %s', (_label, setup, actions) => {
    it('returns MALFORMED instead of throwing', () => {
      const attempt = () => load({ formatVersion: SAVE_FORMAT_VERSION, setup, actions } as never);
      expect(attempt).not.toThrow();

      const loaded = attempt();
      expect(loaded.ok).toBe(false);
      if (loaded.ok) return;
      expect(loaded.error.code).toBe('MALFORMED');
    });
  });

  it.each([['a string'], [null], [42], [{ noType: true }]])(
    'returns MALFORMED for a bad action entry: %s',
    bad => {
      const attempt = () =>
        load({ formatVersion: SAVE_FORMAT_VERSION, setup: spec, actions: [bad] } as never);
      expect(attempt).not.toThrow();

      const loaded = attempt();
      expect(loaded.ok).toBe(false);
      if (loaded.ok) return;
      expect(loaded.error.code).toBe('MALFORMED');
      expect(loaded.error.atAction).toBe(0);
    },
  );

  it('reports which action was malformed', () => {
    const loaded = load({
      formatVersion: SAVE_FORMAT_VERSION,
      setup: spec,
      actions: [script[0], null],
    } as never);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.atAction).toBe(1);
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
    expect(atEnd.session.state.sequence).toBeGreaterThan(afterActivate.session.state.sequence);
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

describe('untrusted saves', () => {
  // `load` is public and its input is a localStorage value or a file someone
  // may have edited. It is documented to return a typed error, never to throw,
  // and the structural checks cannot cover everything the engine dereferences.

  const bare = (models: unknown[], actions: Action[] = []): SavedGame =>
    ({
      formatVersion: SAVE_FORMAT_VERSION,
      setup: { seed: 1, players: [{ id: p1, displayName: 'One' }], models },
      actions,
    }) as SavedGame;

  it('reports a truncated profile instead of throwing', () => {
    // Regression: a model with `"profile": {}` reached `createModel` and threw
    // while reading `profile.healthy.size`, escaping past the Load button.
    const loaded = load(
      bare([{ id: m1, characterId: 'a', owner: p1, pos: vec3(1, 1, 0), profile: {} }]),
    );

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
    expect(loaded.error.message).toContain('healthy');
  });

  it('reports a profile whose stats are the wrong shape', () => {
    const profile = {
      characterId: 'a',
      name: 'A',
      baseMm: 40,
      healthy: { stamina: 5, size: 2, movement: 'M', defense: 3, attacks: [], superpowers: [] },
      injured: { stamina: 5, size: 2, movement: 'M', defense: {}, attacks: [], superpowers: [] },
    };
    const loaded = load(
      bare([{ id: m1, characterId: 'a', owner: p1, pos: vec3(1, 1, 0), profile }]),
    );

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  it('reports a model that is not an object', () => {
    const loaded = load(bare([null]));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  it('reports a model with no position', () => {
    const loaded = load(bare([{ id: m1, characterId: 'a', owner: p1 }]));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  it('reports a position with no coordinates', () => {
    // Regression: `pos: {}` passed an is-it-an-object check and then
    // propagated NaN through every distance in the game — quieter than an
    // exception and worse, since moves get rejected with arithmetic nobody
    // can explain rather than the save being reported as broken.
    const loaded = load(bare([{ id: m1, characterId: 'a', owner: p1, pos: {} }]));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  it('reports a position whose coordinates are not finite', () => {
    const loaded = load(
      bare([{ id: m1, characterId: 'a', owner: p1, pos: { x: 1, y: null, z: 0 } }]),
    );
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  it('reports terrain with no usable position', () => {
    const saved = {
      formatVersion: SAVE_FORMAT_VERSION,
      setup: {
        seed: 1,
        players: [{ id: p1, displayName: 'One' }],
        models: [{ id: m1, characterId: 'a', owner: p1, pos: vec3(1, 1, 0) }],
        terrain: [{ id: 'crate', radius: 1, height: 2, size: 2, blocksLineOfSight: true }],
      },
      actions: [],
    } as unknown as SavedGame;

    const loaded = load(saved);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('MALFORMED');
  });

  it('accepts a model with no profile at all', () => {
    // Optional by design — the engine substitutes a training dummy.
    const loaded = load(bare([{ id: m1, characterId: 'a', owner: p1, pos: vec3(1, 1, 0) }]));
    expect(loaded.ok).toBe(true);
  });
});

describe('save format versioning', () => {
  it('refuses a v1 save by version rather than by divergence', () => {
    // Regression: v1 setups carry no profiles, so every model replayed as a
    // training dummy and an ATTACK naming a real attack was rejected. Left at
    // v1 that surfaced as DIVERGED pointing at an arbitrary action, which
    // reads as a corrupt save rather than an old one.
    const v1 = {
      formatVersion: 1,
      setup: {
        seed: 1,
        players: [
          { id: p1, displayName: 'One' },
          { id: p2, displayName: 'Two' },
        ],
        models: [
          { id: m1, characterId: 'amazing-spider-man', owner: p1, pos: vec3(12, 18, 0) },
          { id: m2, characterId: 'black-panther', owner: p2, pos: vec3(16, 18, 0) },
        ],
      },
      actions: [
        { type: 'ACTIVATE', player: p1, modelId: m1 },
        { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'Spider Strike' },
      ],
    } as unknown as SavedGame;

    const loaded = load(v1);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('UNSUPPORTED_VERSION');
    expect(loaded.error.message).toContain('v1');
  });

  it('refuses a v2 save, whose dice meant something else', () => {
    // The quiet case. v2 saves are structurally identical to v3 ones and every
    // action in them is still legal, so replaying one succeeds — but the die
    // gained a sixth face, four of the eight RNG indices now land on different
    // symbols, and the board that comes back is not the board that was saved.
    // Only the version distinguishes them.
    const v2 = {
      formatVersion: 2,
      setup: {
        seed: 1,
        players: [
          { id: p1, displayName: 'One' },
          { id: p2, displayName: 'Two' },
        ],
        models: [
          { id: m1, characterId: 'a', owner: p1, pos: vec3(12, 18, 0) },
          { id: m2, characterId: 'b', owner: p2, pos: vec3(16, 18, 0) },
        ],
      },
      actions: [{ type: 'ACTIVATE', player: p1, modelId: m1 }],
    } as unknown as SavedGame;

    const loaded = load(v2);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('refuses a v3 save, whose distances meant something else', () => {
    // The same quiet case as v2, one layer along. v3 saves are structurally
    // identical to v4 ones, but the Medium tool was 4" and is now 5", so this
    // 4.5" move was illegal when it was saved and is legal now. Replaying it
    // succeeds and hands back a game that could not have been played. Only the
    // version distinguishes them.
    const v3 = {
      formatVersion: 3,
      setup: {
        seed: 1,
        players: [
          { id: p1, displayName: 'One' },
          { id: p2, displayName: 'Two' },
        ],
        models: [
          { id: m1, characterId: 'a', owner: p1, pos: vec3(12, 18, 0) },
          { id: m2, characterId: 'b', owner: p2, pos: vec3(30, 30, 0) },
        ],
      },
      actions: [
        { type: 'ACTIVATE', player: p1, modelId: m1 },
        { type: 'MOVE', player: p1, modelId: m1, template: 'M', path: [vec3(12, 22.5, 0)] },
      ],
    } as unknown as SavedGame;

    const loaded = load(v3);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('refuses a v4 save, which could contain actions taken after a wipeout', () => {
    // v4 games ran all six rounds however one-sided they got, so a log from
    // one can legally contain activations after a player was eliminated.
    // Replaying it now meets a finished game and is rejected — loud rather
    // than quiet, but it still surfaces as DIVERGED at an arbitrary action,
    // which reads as corruption rather than age.
    const v4 = {
      formatVersion: 4,
      setup: {
        seed: 1,
        players: [
          { id: p1, displayName: 'One' },
          { id: p2, displayName: 'Two' },
        ],
        models: [
          { id: m1, characterId: 'a', owner: p1, pos: vec3(12, 18, 0) },
          { id: m2, characterId: 'b', owner: p2, pos: vec3(16, 18, 0) },
        ],
      },
      actions: [{ type: 'ACTIVATE', player: p1, modelId: m1 }],
    } as unknown as SavedGame;

    const loaded = load(v4);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('is past v4, because a wipeout now ends the game', () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThan(4);
  });
});
