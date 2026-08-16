import { describe, expect, it } from 'vitest';

import type { Action } from './actions.js';
import { applyAction, applyAll } from './engine.js';
import { vec3 } from './geometry/vec.js';
import type { ModelId, PlayerId } from './ids.js';
import { createSparringGame } from './setup.js';

const p1 = 'p1' as PlayerId;
const p2 = 'p2' as PlayerId;
const m1 = 'm1' as ModelId;
const m2 = 'm2' as ModelId;

describe('determinism', () => {
  // This is the property the entire architecture rests on. If it ever fails,
  // replays, server authority, and AI search all fail with it.
  it('produces identical results from identical seeds and actions', () => {
    const script: Action[] = [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'Spider Strike' },
    ];

    const a = applyAll(createSparringGame(42), script);
    const b = applyAll(createSparringGame(42), script);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it('produces different results from different seeds', () => {
    const script: Action[] = [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'Spider Strike' },
    ];

    const a = applyAll(createSparringGame(1), script);
    const b = applyAll(createSparringGame(999), script);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const rolls = (r: typeof a) => r.events.filter(e => e.type === 'DICE_ROLLED');
    expect(rolls(a)).not.toEqual(rolls(b));
  });

  it('keeps state serializable as plain JSON', () => {
    const result = applyAction(createSparringGame(7), {
      type: 'ACTIVATE',
      player: p1,
      modelId: m1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const roundTripped = JSON.parse(JSON.stringify(result.state));
    expect(roundTripped).toEqual(result.state);
  });
});

describe('activation', () => {
  it('rejects activating an opponent model', () => {
    const result = applyAction(createSparringGame(), {
      type: 'ACTIVATE',
      player: p2,
      modelId: m1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('NOT_YOUR_TURN');
  });

  it('rejects activating the same model twice in a round', () => {
    const first = applyAction(createSparringGame(), {
      type: 'ACTIVATE',
      player: p1,
      modelId: m1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = applyAction(first.state, { type: 'ACTIVATE', player: p1, modelId: m1 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.rejection.code).toBe('MODEL_ALREADY_ACTIVATED');
  });

  it('parks a prompt for the activating player', () => {
    const result = applyAction(createSparringGame(), {
      type: 'ACTIVATE',
      player: p1,
      modelId: m1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.prompt).toMatchObject({ kind: 'chooseAction', player: p1 });
  });
});

describe('movement', () => {
  it('rejects a path longer than the template allows', () => {
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'S',
      path: [vec3(12, 18, 0), vec3(30, 18, 0)],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_MOVE');
  });

  it('measures a curved path along its length, not end to end', () => {
    // A dogleg that is short in displacement but long in travel must still be
    // rejected — this is why paths are polylines rather than destinations.
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'S',
      path: [vec3(12, 18, 0), vec3(12, 22, 0), vec3(13, 18, 0)],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects ending a move overlapping another base', () => {
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'M',
      path: [vec3(12, 18, 0), vec3(15.9, 18, 0)],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_MOVE');
  });

  // Regression: a one-point path measured zero, so the server accepted it as a
  // free move and teleported the model anywhere on the table. Distance must be
  // measured from where the model actually is.
  it('rejects a single-point path that teleports the model', () => {
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'S',
      path: [vec3(35, 35, 0)],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_MOVE');
  });

  it('rejects a path that does not start at the model', () => {
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'S',
      path: [vec3(30, 30, 0), vec3(31, 30, 0)],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_MOVE');
  });

  it('counts the leading segment from the model against the budget', () => {
    // 2" from the model, then 2" more — 4" total, over a 3" Short move, even
    // though each individual segment is within budget.
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'S',
      path: [vec3(12, 20, 0), vec3(12, 22, 0)],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a destination off the table', () => {
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'L',
      path: [vec3(12, 18, 0), vec3(12, -2, 0)],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_MOVE');
  });

  it('rejects an empty path', () => {
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'S',
      path: [],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a legal move and emits MODEL_MOVED', () => {
    const result = applyAction(createSparringGame(), {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'M',
      path: [vec3(12, 18, 0), vec3(12, 21, 0)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map(e => e.type)).toContain('MODEL_MOVED');
    expect(result.state.models[m1]?.pos).toEqual(vec3(12, 21, 0));
  });
});

describe('attack', () => {
  it('rolls both sides and can deal damage', () => {
    const result = applyAll(createSparringGame(3), [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'Spider Strike' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rolls = result.events.filter(e => e.type === 'DICE_ROLLED');
    expect(rolls).toHaveLength(2);
    expect(rolls.map(r => (r.type === 'DICE_ROLLED' ? r.mode : null))).toEqual([
      'attack',
      'defense',
    ]);
  });

  it('rejects an attack on an out-of-range target', () => {
    const state = createSparringGame();
    const far = {
      ...state,
      models: {
        ...state.models,
        [m2]: { ...state.models[m2]!, pos: vec3(34, 18, 0) },
      },
    };

    const result = applyAction(far, {
      type: 'ATTACK',
      player: p1,
      attackerId: m1,
      targetId: m2,
      attackName: 'Spider Strike',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('OUT_OF_RANGE');
  });
});
