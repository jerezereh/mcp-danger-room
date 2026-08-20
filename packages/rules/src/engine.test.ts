import { describe, expect, it } from 'vitest';

import type { Action } from './actions.js';
import { MAX_ROUNDS } from './constants.js';
import { ACTIONS_PER_ACTIVATION, applyAction, applyAll } from './engine.js';
import { vec3 } from './geometry/vec.js';
import type { CharacterId, ModelId, PlayerId } from './ids.js';
import type {
  AttackProfile,
  CharacterProfile,
  DamageType,
  StatProfile,
  SuperpowerProfile,
} from './profile.js';
import { createGame, createSparringGame, type GameSpec, type ModelSpec } from './setup.js';
import type { GameState } from './state.js';

const p1 = 'p1' as PlayerId;
const p2 = 'p2' as PlayerId;
const m1 = 'm1' as ModelId;
const m2 = 'm2' as ModelId;
const m3 = 'm3' as ModelId;
const m4 = 'm4' as ModelId;
const m5 = 'm5' as ModelId;

/**
 * The sparring position's models carry no card data, so they play as training
 * dummies whose one attack is called STRIKE. See `trainingProfile`.
 */
const STRIKE = 'STRIKE';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const stats = (over: Partial<StatProfile> = {}): StatProfile => ({
  stamina: 6,
  movement: 'M',
  size: 2,
  defense: { physical: 3, energy: 3, mystic: 3 },
  attacks: [{ name: STRIKE, type: 'physical', range: 2, shape: 'range', dice: 5, cost: 0 }],
  superpowers: [],
  ...over,
});

const profile = (
  characterId: string,
  over: { healthy?: Partial<StatProfile>; injured?: Partial<StatProfile>; baseMm?: number } = {},
): CharacterProfile => ({
  characterId: characterId as CharacterId,
  name: characterId,
  baseMm: over.baseMm ?? 40,
  healthy: stats(over.healthy),
  injured: stats(over.injured),
});

/**
 * "When this character is targeted by an attack, it may use this superpower.
 * Add N dice to this character's defense roll against that attack."
 *
 * The largest uniform family of reactive superpowers in the corpus, and the
 * one the effect union was built to express. Black Panther's VIBRANIUM ARMOR
 * is one of them.
 */
const shield = (
  name: string,
  count: number,
  damageTypes: readonly DamageType[] = [],
  cost = 2,
): SuperpowerProfile => ({
  name,
  type: 'reactive',
  cost,
  reaction: { timing: 'targeted', role: 'target', damageTypes, effect: { kind: 'addDefenseDice', count } },
});

/** An attack with everything but its damage type and pool left at defaults. */
const attackProfile = (over: Partial<AttackProfile> = {}): AttackProfile => ({
  name: STRIKE,
  type: 'physical',
  range: 2,
  shape: 'range',
  dice: 5,
  cost: 0,
  ...over,
});

/** A two-model game with explicit profiles, for testing what the cards decide. */
function duel(a: Partial<ModelSpec>, b: Partial<ModelSpec>, seed = 1): GameState {
  const spec: GameSpec = {
    seed,
    players: [
      { id: p1, displayName: 'One' },
      { id: p2, displayName: 'Two' },
    ],
    models: [
      { id: m1, characterId: 'alpha' as CharacterId, owner: p1, pos: vec3(12, 18, 0), ...a },
      { id: m2, characterId: 'beta' as CharacterId, owner: p2, pos: vec3(16, 18, 0), ...b },
    ],
  };
  return createGame(spec);
}

/** p1 fields three characters to p2's one, so turns come back around. */
function threeVersusOne(): GameState {
  return createGame({
    seed: 1,
    players: [
      { id: p1, displayName: 'One' },
      { id: p2, displayName: 'Two' },
    ],
    models: [
      { id: m1, characterId: 'alpha' as CharacterId, owner: p1, pos: vec3(12, 18, 0) },
      { id: m3, characterId: 'gamma' as CharacterId, owner: p1, pos: vec3(14, 8, 0) },
      { id: m5, characterId: 'epsilon' as CharacterId, owner: p1, pos: vec3(20, 30, 0) },
      { id: m2, characterId: 'beta' as CharacterId, owner: p2, pos: vec3(16, 18, 0) },
    ],
  });
}

/** Apply a script, asserting every step is accepted, and return the state. */
function play(state: GameState, actions: readonly Action[]): GameState {
  const result = applyAll(state, actions);
  if (!result.ok) {
    throw new Error(`${result.rejection.code}: ${result.rejection.message}`);
  }
  return result.state;
}

describe('determinism', () => {
  // This is the property the entire architecture rests on. If it ever fails,
  // replays, server authority, and AI search all fail with it.
  it('produces identical results from identical seeds and actions', () => {
    const script: Action[] = [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: STRIKE },
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
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: STRIKE },
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

  // Profiles travel in state, so they have to survive the same round trip as
  // everything else — including the nested defense record and attack list.
  it('keeps profiles serializable', () => {
    const state = duel({ profile: profile('alpha') }, {});
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('activation', () => {
  it('opens the game by asking the first player to activate', () => {
    const state = createSparringGame();
    expect(state.prompt).toMatchObject({ kind: 'chooseActivation', player: p1 });
    expect(state.prompt?.kind === 'chooseActivation' && state.prompt.options).toEqual([m1, m3]);
  });

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
    // Plays a full turn back to p1, so this exercises the once-per-round rule
    // rather than the alternating-activation gate — which would reject any
    // ACTIVATE from p1 while it was p2's turn, for a different reason.
    const played = play(createSparringGame(), [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'END_ACTIVATION', player: p1 },
      { type: 'ACTIVATE', player: p2, modelId: m2 },
      { type: 'END_ACTIVATION', player: p2 },
    ]);
    expect(played.stack).toHaveLength(0);

    const again = applyAction(played, { type: 'ACTIVATE', player: p1, modelId: m1 });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.rejection.code).toBe('MODEL_ALREADY_ACTIVATED');
  });

  // Regression: checkPrompt only verified the player, so a second ACTIVATE was
  // accepted mid-activation and left two activation frames on the stack, with
  // no single "current" model for the alternating-activation loop.
  it('rejects activating a second model while one is mid-activation', () => {
    const first = applyAction(createSparringGame(), {
      type: 'ACTIVATE',
      player: p1,
      modelId: m1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.stack).toHaveLength(1);

    const second = applyAction(first.state, { type: 'ACTIVATE', player: p1, modelId: m3 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.rejection.code).toBe('UNEXPECTED_ACTION');
  });

  it('rejects a different model acting during someone else’s activation', () => {
    const first = applyAction(createSparringGame(), {
      type: 'ACTIVATE',
      player: p1,
      modelId: m1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const wrongModel = applyAction(first.state, {
      type: 'MOVE',
      player: p1,
      modelId: m3,
      template: 'S',
      path: [vec3(14, 8, 0), vec3(14, 10, 0)],
    });
    expect(wrongModel.ok).toBe(false);
    if (wrongModel.ok) return;
    expect(wrongModel.rejection.code).toBe('UNEXPECTED_ACTION');
  });

  it('lets the activating model act during its own activation', () => {
    const first = applyAction(createSparringGame(), {
      type: 'ACTIVATE',
      player: p1,
      modelId: m1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const move = applyAction(first.state, {
      type: 'MOVE',
      player: p1,
      modelId: m1,
      template: 'M',
      path: [vec3(12, 18, 0), vec3(12, 21, 0)],
    });
    expect(move.ok).toBe(true);
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

describe('the action budget', () => {
  const activate: Action = { type: 'ACTIVATE', player: p1, modelId: m1 };
  const move = (to: number): Action => ({
    type: 'MOVE',
    player: p1,
    modelId: m1,
    template: 'S',
    path: [vec3(12, to, 0)],
  });

  it('ends the activation once the actions run out', () => {
    // Regression: `actionsRemaining` was pushed onto the frame and never
    // decremented, so a model could move and attack without limit until its
    // owner volunteered to stop.
    const state = play(createSparringGame(), [activate, move(20), move(22)]);

    expect(ACTIONS_PER_ACTIVATION).toBe(2);
    expect(state.stack).toHaveLength(0);
    expect(state.prompt).toMatchObject({ kind: 'chooseActivation', player: p2 });
  });

  it('emits ACTIVATION_ENDED when the budget empties, not only on request', () => {
    const result = applyAll(createSparringGame(), [activate, move(20), move(22)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.filter(e => e.type === 'ACTIVATION_ENDED')).toHaveLength(1);
  });

  it('rejects a third action from a model that has spent both', () => {
    const state = play(createSparringGame(), [activate, move(20), move(22)]);
    const third = applyAction(state, move(24));

    expect(third.ok).toBe(false);
    if (third.ok) return;
    // The turn has already passed to p2, so p1 is not the one being asked.
    expect(third.rejection.code).toBe('NOT_YOUR_TURN');
  });

  it('counts an attack against the budget too', () => {
    const state = play(createSparringGame(), [
      activate,
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: STRIKE },
    ]);

    const frame = state.stack[0];
    expect(frame?.kind).toBe('activation');
    expect(frame?.kind === 'activation' && frame.actionsRemaining).toBe(1);
  });

  it('rejects a move with no activation in progress', () => {
    // The prompt gate catches this too, but the rule belongs to the engine:
    // acting outside an activation is illegal however the state was reached.
    const state = createSparringGame();
    const loose = applyAction({ ...state, prompt: null }, move(20));

    expect(loose.ok).toBe(false);
    if (loose.ok) return;
    expect(loose.rejection.code).toBe('UNEXPECTED_ACTION');
  });
});

describe('the round loop', () => {
  const endTurn = (player: PlayerId, modelId: ModelId): Action[] => [
    { type: 'ACTIVATE', player, modelId },
    { type: 'END_ACTIVATION', player },
  ];

  it('alternates activations between the players', () => {
    const afterP1 = play(createSparringGame(), endTurn(p1, m1));
    expect(afterP1.prompt).toMatchObject({ kind: 'chooseActivation', player: p2 });

    const afterP2 = play(afterP1, endTurn(p2, m2));
    expect(afterP2.prompt).toMatchObject({ kind: 'chooseActivation', player: p1 });
  });

  it('rejects activating out of turn', () => {
    const afterP1 = play(createSparringGame(), endTurn(p1, m1));
    const outOfTurn = applyAction(afterP1, { type: 'ACTIVATE', player: p1, modelId: m3 });

    expect(outOfTurn.ok).toBe(false);
    if (outOfTurn.ok) return;
    expect(outOfTurn.rejection.code).toBe('NOT_YOUR_TURN');
  });

  it('starts a new round once everyone has activated', () => {
    const result = applyAll(createSparringGame(), [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
      ...endTurn(p2, m4),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.round).toBe(2);
    expect(result.state.phase).toBe('activation');
    expect(result.events.filter(e => e.type === 'ROUND_STARTED')).toHaveLength(1);
  });

  it('clears activation flags at the end of the round', () => {
    const state = play(createSparringGame(), [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
      ...endTurn(p2, m4),
    ]);

    expect(Object.values(state.models).every(m => !m.activatedThisRound)).toBe(true);
    // Damage is not per-round bookkeeping and must survive cleanup.
    expect(state.models[m1]?.health).toBe('healthy');
  });

  it('gives priority to exactly one player, and lets them go first', () => {
    const state = play(createSparringGame(), [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
      ...endTurn(p2, m4),
    ]);

    const withPriority = Object.values(state.players).filter(p => p.hasPriority);
    expect(withPriority).toHaveLength(1);
    // "The player who has priority takes the first turn."
    expect(state.prompt).toMatchObject({ kind: 'chooseActivation', player: withPriority[0]?.id });
  });

  it('passes priority only when the last player to activate holds it', () => {
    // "If the player that activated the last character of the Activation Phase
    // has the Priority token, they pass it to their opponent." So it is
    // deterministic, and it stays put otherwise — which a roll-off, as an
    // earlier version of this engine used, gets wrong half the time.
    //
    // p1 starts with priority. p2 activates last, and does not hold it, so it
    // does not move.
    const stays = play(createSparringGame(), [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
      ...endTurn(p2, m4),
    ]);
    expect(stays.players[p1]?.hasPriority).toBe(true);

    // Now p1 activates last while holding it, so it passes. Turns alternate
    // strictly, so the only way p1 goes last is to out-number p2 — which is
    // exactly when the turn comes back around to them.
    const passes = play(threeVersusOne(), [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
      ...endTurn(p1, m5),
    ]);
    expect(passes.players[p2]?.hasPriority).toBe(true);
    expect(passes.players[p1]?.hasPriority).toBe(false);
  });

  it('gives every character 1 Power at the start of a round', () => {
    // "At the beginning of the Power Phase, all characters gain 1 Power."
    const start = createSparringGame();
    expect(Object.values(start.models).every(m => m.power === 1)).toBe(true);

    const round2 = play(start, [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
      ...endTurn(p2, m4),
    ]);
    expect(round2.round).toBe(2);
    expect(Object.values(round2.models).every(m => m.power === 2)).toBe(true);
  });

  it('lets a player with models left keep activating when the other is done', () => {
    // p2 fields one model to p1's two. Once p2 has spent theirs, the round
    // must not stall — p1 activates consecutively until they run out too.
    const state = createGame({
      seed: 1,
      players: [
        { id: p1, displayName: 'One' },
        { id: p2, displayName: 'Two' },
      ],
      models: [
        { id: m1, characterId: 'alpha' as CharacterId, owner: p1, pos: vec3(12, 18, 0) },
        { id: m3, characterId: 'gamma' as CharacterId, owner: p1, pos: vec3(14, 8, 0) },
        { id: m2, characterId: 'beta' as CharacterId, owner: p2, pos: vec3(16, 18, 0) },
      ],
    });

    const afterTwo = play(state, [...endTurn(p1, m1), ...endTurn(p2, m2)]);
    expect(afterTwo.round).toBe(1);
    expect(afterTwo.prompt).toMatchObject({ kind: 'chooseActivation', player: p1, options: [m3] });
  });

  it('finishes the game after the last round', () => {
    let state = createSparringGame(5);

    // Answer whatever the engine asks until it stops asking. Bounded so a loop
    // bug fails the test rather than hanging the suite.
    for (let i = 0; i < 200 && state.phase !== 'finished'; i++) {
      const prompt = state.prompt;
      if (prompt?.kind !== 'chooseActivation') throw new Error(`unexpected ${prompt?.kind}`);
      const modelId = prompt.options[0];
      if (!modelId) throw new Error('asked to activate with no options');
      state = play(state, endTurn(prompt.player, modelId));
    }

    expect(state.phase).toBe('finished');
    expect(state.round).toBe(MAX_ROUNDS);
    expect(state.prompt).toBeNull();
  });

  it('rejects every action once the game has finished', () => {
    const finished: GameState = { ...createSparringGame(), phase: 'finished', prompt: null };
    const result = applyAction(finished, { type: 'ACTIVATE', player: p1, modelId: m1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('GAME_OVER');
  });
});

describe('movement', () => {
  const activate: Action = { type: 'ACTIVATE', player: p1, modelId: m1 };

  /** A move by the activating model, from the sparring position. */
  const moving = (over: Partial<Extract<Action, { type: 'MOVE' }>>): Action[] => [
    activate,
    { type: 'MOVE', player: p1, modelId: m1, template: 'S', path: [], ...over } as Action,
  ];

  const rejects = (actions: readonly Action[], code: string) => {
    const result = applyAll(createSparringGame(), actions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe(code);
  };

  it('rejects a path longer than the template allows', () => {
    rejects(moving({ path: [vec3(12, 18, 0), vec3(30, 18, 0)] }), 'ILLEGAL_MOVE');
  });

  it('measures a curved path along its length, not end to end', () => {
    // A dogleg that is short in displacement but long in travel must still be
    // rejected — this is why paths are polylines rather than destinations.
    rejects(
      moving({ path: [vec3(12, 18, 0), vec3(12, 22, 0), vec3(13, 18, 0)] }),
      'ILLEGAL_MOVE',
    );
  });

  it('rejects ending a move overlapping another base', () => {
    rejects(moving({ template: 'M', path: [vec3(12, 18, 0), vec3(15.9, 18, 0)] }), 'ILLEGAL_MOVE');
  });

  // Regression: a one-point path measured zero, so the server accepted it as a
  // free move and teleported the model anywhere on the table. Distance must be
  // measured from where the model actually is.
  it('rejects a single-point path that teleports the model', () => {
    rejects(moving({ path: [vec3(35, 35, 0)] }), 'ILLEGAL_MOVE');
  });

  it('rejects a path that does not start at the model', () => {
    rejects(moving({ path: [vec3(30, 30, 0), vec3(31, 30, 0)] }), 'ILLEGAL_MOVE');
  });

  it('counts the leading segment from the model against the budget', () => {
    // 2" from the model, then 2" more — 4" total, over a 3" Short move, even
    // though each individual segment is within budget.
    rejects(moving({ path: [vec3(12, 20, 0), vec3(12, 22, 0)] }), 'ILLEGAL_MOVE');
  });

  it('rejects an empty path', () => {
    rejects(moving({ path: [] }), 'ILLEGAL_MOVE');
  });

  it('rejects a destination off the table', () => {
    const state = duel({ pos: vec3(12, 2, 0), profile: profile('alpha') }, {});
    const result = applyAll(state, [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'MOVE', player: p1, modelId: m1, template: 'M', path: [vec3(12, -1, 0)] },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_MOVE');
    expect(result.rejection.message).toContain('off the table');
  });

  it('rejects a template longer than the character’s printed move', () => {
    const state = duel({ profile: profile('alpha', { healthy: { movement: 'S' } }) }, {});
    const result = applyAll(state, [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'MOVE', player: p1, modelId: m1, template: 'L', path: [vec3(12, 21, 0)] },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_MOVE');
    expect(result.rejection.message).toContain('printed S move');
  });

  it('accepts a legal move and emits MODEL_MOVED', () => {
    const result = applyAll(
      createSparringGame(),
      moving({ template: 'M', path: [vec3(12, 18, 0), vec3(12, 21, 0)] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map(e => e.type)).toContain('MODEL_MOVED');
    expect(result.state.models[m1]?.pos).toEqual(vec3(12, 21, 0));
  });
});

describe('attack', () => {
  const attack = (name = STRIKE): Action => ({
    type: 'ATTACK',
    player: p1,
    attackerId: m1,
    targetId: m2,
    attackName: name,
  });
  const activate: Action = { type: 'ACTIVATE', player: p1, modelId: m1 };

  it('rolls both sides and can deal damage', () => {
    const result = applyAll(createSparringGame(3), [activate, attack()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rolls = result.events.filter(e => e.type === 'DICE_ROLLED');
    expect(rolls).toHaveLength(2);
    expect(rolls.map(r => (r.type === 'DICE_ROLLED' ? r.mode : null))).toEqual([
      'attack',
      'defense',
    ]);
  });

  it('rejects an attack the attacker does not have', () => {
    const result = applyAll(createSparringGame(), [activate, attack('WEB SHOOTERS')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('UNKNOWN_ATTACK');
  });

  it('rejects an attack on an out-of-range target', () => {
    const state = duel({}, { pos: vec3(34, 18, 0) });
    const result = applyAll(state, [activate, attack()]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('OUT_OF_RANGE');
  });

  it('takes the attack range from the card, not from a constant', () => {
    // 8.42" apart edge to edge. Range 2 is 3.5" and misses; Range 5 is 8" and
    // also misses; only a longer band would reach — so the same geometry has
    // to give different answers for two different printed ranges.
    const reach = (range: 2 | 5) =>
      applyAll(
        duel(
          { profile: profile('alpha', { healthy: { attacks: [{ name: STRIKE, type: 'physical', range, shape: 'range', dice: 5, cost: 0 }] } }) },
          { pos: vec3(18, 18, 0) },
        ),
        [activate, attack()],
      );

    expect(reach(2).ok).toBe(false);
    expect(reach(5).ok).toBe(true);
  });

  it('rolls the attack pool the card prints', () => {
    const state = duel(
      { profile: profile('alpha', { healthy: { attacks: [{ name: STRIKE, type: 'physical', range: 2, shape: 'range', dice: 8, cost: 0 }] } }) },
      {},
    );
    const result = applyAll(state, [activate, attack()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rolled = result.events.find(e => e.type === 'DICE_ROLLED');
    // Criticals add dice, so the pool is a floor rather than an exact count.
    expect(rolled?.type === 'DICE_ROLLED' && rolled.faces.length).toBeGreaterThanOrEqual(8);
  });

  it('defends with the stat matching the attack’s damage type', () => {
    // Regression: every attack rolled against one hardcoded defense of 3,
    // which is the single biggest way the placeholder engine misrepresented a
    // character — a mystic specialist defended physical attacks identically.
    const defender = profile('beta', {
      healthy: { defense: { physical: 1, energy: 4, mystic: 7 } },
    });
    const mystic = profile('alpha', {
      healthy: { attacks: [{ name: STRIKE, type: 'mystic', range: 2, shape: 'range', dice: 5, cost: 0 }] },
    });

    const result = applyAll(duel({ profile: mystic }, { profile: defender }), [activate, attack()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const defense = result.events.filter(e => e.type === 'DICE_ROLLED')[1];
    expect(defense?.type === 'DICE_ROLLED' && defense.faces.length).toBeGreaterThanOrEqual(7);
  });

  it('rejects beam and area attacks rather than resolving them wrongly', () => {
    const beam = profile('alpha', {
      healthy: { attacks: [{ name: STRIKE, type: 'energy', range: 3, shape: 'beam', dice: 5, cost: 0 }] },
    });
    const result = applyAll(duel({ profile: beam }, {}), [activate, attack()]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('being Dazed', () => {
  /**
   * Deal an exact amount of damage, without going through the dice.
   *
   * Primes the stack with an `applyDamage` frame under a spent activation and
   * ends the activation, which drops resolution straight onto the damage. The
   * alternative is rolling until the dice cooperate, which tests the RNG
   * rather than the stamina threshold.
   */
  function suffer(state: GameState, amount: number, source: ModelId | null = m1): GameState {
    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount, source },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };

    const result = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    if (!result.ok) throw new Error(`${result.rejection.code}: ${result.rejection.message}`);
    return result.state;
  }

  /** Play out whatever is left of the round, so Cleanup runs. */
  function throughCleanup(state: GameState): GameState {
    let current = state;
    for (let i = 0; i < 20 && current.round === state.round; i++) {
      const prompt = current.prompt;
      if (prompt?.kind !== 'chooseActivation') break;

      const modelId = prompt.options[0];
      const action: Action = modelId
        ? { type: 'ACTIVATE', player: prompt.player, modelId }
        : { type: 'PASS_TURN', player: prompt.player };

      const stepped = applyAction(current, action);
      if (!stepped.ok) break;
      current = stepped.state;

      if (current.prompt?.kind === 'chooseAction') {
        const ended = applyAction(current, { type: 'END_ACTIVATION', player: prompt.player });
        if (!ended.ok) break;
        current = ended.state;
      }
    }
    return current;
  }

  it('takes the threshold from the card', () => {
    const glass = duel({}, { profile: profile('beta', { healthy: { stamina: 3 } }) });

    expect(suffer(glass, 2).models[m2]).toMatchObject({ dazed: false, damage: 2 });
    expect(suffer(glass, 3).models[m2]).toMatchObject({ dazed: true });
  });

  it('does not flip the card until Cleanup', () => {
    // Regression: reaching Stamina used to flip the character to its Injured
    // side immediately, handing it that card's Stamina and attacks for the
    // rest of the round. The rules keep it on the healthy side, holding its
    // damage, until the Cleanup Phase.
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 3 } }) });
    const dazed = suffer(state, 3);

    expect(dazed.models[m2]).toMatchObject({ dazed: true, health: 'healthy', damage: 3 });
  });

  it('clears damage and flips to Injured during Cleanup', () => {
    // "Characters with a Dazed token remove all Damage tokens, special
    // conditions, and their Dazed token. They then flip their Stat Cards over
    // to the Injured side."
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 3 } }) });
    const after = throughCleanup(suffer(state, 3));

    expect(after.round).toBe(2);
    expect(after.models[m2]).toMatchObject({ dazed: false, health: 'injured', damage: 0 });
  });

  it('cannot be activated while Dazed', () => {
    // "activate one character that does not have an Activated or Dazed token."
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 3 } }) });
    const dazed = suffer(state, 3);

    const offered = dazed.prompt?.kind === 'chooseActivation' ? dazed.prompt.options : [];
    expect(offered).not.toContain(m2);

    const tried = applyAction(dazed, { type: 'ACTIVATE', player: p2, modelId: m2 });
    expect(tried.ok).toBe(false);
    if (tried.ok) return;
    expect(['MODEL_DAZED', 'NOT_YOUR_TURN']).toContain(tried.rejection.code);
  });

  it('reads the injured face once the card has flipped', () => {
    // Healthy Stamina 3, injured Stamina 9. Before the flip 3 damage Dazes it;
    // after the flip it takes 9 to do so again.
    const state = duel({}, {
      profile: profile('beta', { healthy: { stamina: 3 }, injured: { stamina: 9 } }),
    });
    const flipped = throughCleanup(suffer(state, 3));
    expect(flipped.models[m2]?.health).toBe('injured');

    const hurtAgain = suffer(flipped, 8);
    expect(hurtAgain.models[m2]).toMatchObject({ health: 'injured', dazed: false, damage: 8 });
  });

  it('is KO’d rather than Dazed a second time', () => {
    const state = duel({}, {
      profile: profile('beta', { healthy: { stamina: 2 }, injured: { stamina: 2 } }),
    });
    const flipped = throughCleanup(suffer(state, 2));
    expect(flipped.models[m2]?.health).toBe('injured');

    expect(suffer(flipped, 2).models[m2]?.health).toBe('ko');
  });

  it('emits the beats of taking damage in order', () => {
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 2 } }) });
    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount: 2, source: m1 },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };

    const result = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const types = result.events.map(e => e.type);
    expect(types).toContain('DAMAGE_DEALT');
    expect(types.indexOf('DAMAGE_DEALT')).toBeLessThan(types.indexOf('MODEL_DAZED'));
  });
});

describe('passing a turn', () => {
  const endTurn = (player: PlayerId, modelId: ModelId): Action[] => [
    { type: 'ACTIVATE', player, modelId },
    { type: 'END_ACTIVATION', player },
  ];

  it('offers the choice only to the player who is behind', () => {
    // "A player can end their turn without activating a character if at the
    // start of their turn they have fewer non-Grunt characters without
    // Activated or Dazed tokens on the battlefield than their opponent does."
    const state = threeVersusOne();
    expect(state.prompt).toMatchObject({ kind: 'chooseActivation', player: p1, mayPass: false });

    // p1 spends one, so p2 is now 1 against 2 and may decline.
    const afterP1 = play(state, endTurn(p1, m1));
    expect(afterP1.prompt).toMatchObject({ player: p2, options: [m2], mayPass: true });
  });

  it('rejects passing when not behind', () => {
    const result = applyAction(threeVersusOne(), { type: 'PASS_TURN', player: p1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('CANNOT_PASS');
  });

  it('lets a player who is behind decline to activate', () => {
    // The real tactical point of passing: p2 keeps their character in hand and
    // makes p1 commit first.
    const state = play(threeVersusOne(), endTurn(p1, m1));
    const passed = applyAction(state, { type: 'PASS_TURN', player: p2 });
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;

    expect(passed.events.map(e => e.type)).toContain('TURN_PASSED');
    // Still unspent, and the turn has gone back to p1.
    expect(passed.state.models[m2]?.activatedThisRound).toBe(false);
    expect(passed.state.prompt).toMatchObject({ kind: 'chooseActivation', player: p1 });
  });

  it('rejects passing out of turn', () => {
    const result = applyAction(threeVersusOne(), { type: 'PASS_TURN', player: p2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('NOT_YOUR_TURN');
  });

  it('passes for a player with nobody left, rather than stalling', () => {
    const result = applyAll(threeVersusOne(), [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // p2 is spent while p1 still has one, so p2's turn is taken for them and
    // the turn comes back around.
    expect(result.events.filter(e => e.type === 'TURN_PASSED')).toHaveLength(1);
    expect(result.state.round).toBe(1);
    expect(result.state.prompt).toMatchObject({ player: p1, options: [m5] });
  });

  it('ends the round when neither player can act', () => {
    // "The Activation Phase ends when a player ends their turn and neither
    // player has a character without an Activated or Dazed token." When
    // nobody can activate, nobody can pass either — which is what closes it.
    const state = play(threeVersusOne(), [
      ...endTurn(p1, m1),
      ...endTurn(p2, m2),
      ...endTurn(p1, m3),
      ...endTurn(p1, m5),
    ]);
    expect(state.round).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The 14-step attack sequence — see issue #5 for the transcription.
// ---------------------------------------------------------------------------

describe('the attack sequence', () => {
  const activate: Action = { type: 'ACTIVATE', player: p1, modelId: m1 };
  const strike: Action = {
    type: 'ATTACK',
    player: p1,
    attackerId: m1,
    targetId: m2,
    attackName: STRIKE,
  };

  it('refuses to target an allied character', () => {
    // "A character can never ... choose an allied character to be the target
    // of its attack." Nothing checked this, so a squad could shoot itself.
    const result = applyAll(createSparringGame(), [
      activate,
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m3, attackName: STRIKE },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('ILLEGAL_TARGET');
  });

  it('refuses an attack the character cannot pay for', () => {
    // Step 1: "If the character doesn't have sufficient Power to pay for the
    // attack, it can't select that attack to use." So the attack is never
    // declared, rather than failing partway through.
    const costly = duel(
      { profile: profile('alpha', { healthy: { attacks: [attackProfile({ cost: 3 })] } }) },
      {},
    );
    const result = applyAll(costly, [activate, strike]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('INSUFFICIENT_POWER');
  });

  it('spends the attack’s Power cost at step 3', () => {
    const costly = duel(
      { profile: profile('alpha', { healthy: { attacks: [attackProfile({ cost: 3 })] } }), power: 5 },
      {},
    );
    const result = applyAll(costly, [activate, strike]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Seeded 5, plus 1 from the round-1 Power Phase, minus the cost of 3.
    expect(result.state.models[m1]?.power).toBe(3);
    const spent = result.events.find(e => e.type === 'POWER_SPENT');
    expect(spent?.type === 'POWER_SPENT' && spent.amount).toBe(3);
  });

  it('never rolls fewer than one die, whatever the card says', () => {
    // "Note that an attack pool can never be reduced to fewer than one die."
    const unarmed = duel(
      { profile: profile('alpha', { healthy: { attacks: [attackProfile({ dice: 0 })] } }) },
      { profile: profile('beta', { healthy: { defense: { physical: 0, energy: 0, mystic: 0 } } }) },
    );
    const result = applyAll(unarmed, [activate, strike]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rolls = result.events.filter(e => e.type === 'DICE_ROLLED');
    for (const rolled of rolls) {
      expect(rolled.type === 'DICE_ROLLED' && rolled.faces.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('rolls the attacker before the defender', () => {
    const result = applyAll(createSparringGame(3), [activate, strike]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const modes = result.events
      .filter(e => e.type === 'DICE_ROLLED')
      .map(e => (e.type === 'DICE_ROLLED' ? e.mode : null));
    expect(modes).toEqual(['attack', 'defense']);
  });

  it('deals the difference in successes as damage', () => {
    const result = applyAll(createSparringGame(3), [activate, strike]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rolls = result.events.filter(e => e.type === 'DICE_ROLLED');
    const attack = rolls[0];
    const defense = rolls[1];
    if (attack?.type !== 'DICE_ROLLED' || defense?.type !== 'DICE_ROLLED') return;

    const expected = Math.max(0, attack.successes - defense.successes);
    const dealt = result.events.find(e => e.type === 'DAMAGE_DEALT');
    const actual = dealt?.type === 'DAMAGE_DEALT' ? dealt.amount : 0;

    expect(actual).toBe(expected);
  });

  it('runs the whole sequence without leaving the attack on the stack', () => {
    const state = play(createSparringGame(3), [activate, strike]);
    expect(state.stack.filter(f => f.kind === 'attack')).toHaveLength(0);
  });
});

describe('the damage cap', () => {
  // Step 12: "A character can only suffer damage equal to its remaining
  // Stamina; any excess damage is ignored." Without it, an overkill hit spills
  // across the flip and can take a character from healthy to KO'd in one blow.
  const overkill = (state: GameState, amount: number): GameState => {
    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount, source: m1 },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };
    const result = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    if (!result.ok) throw new Error(result.rejection.code);
    return result.state;
  };

  it('ignores damage beyond the target’s remaining Stamina', () => {
    const state = duel({}, {
      profile: profile('beta', { healthy: { stamina: 4 }, injured: { stamina: 4 } }),
    });

    const hit = overkill(state, 99);
    // Dazed on 4 damage — its full Stamina — rather than KO'd by the excess.
    expect(hit.models[m2]).toMatchObject({ dazed: true, health: 'healthy', damage: 4 });
  });

  it('reports the damage actually suffered, not the damage offered', () => {
    const state = duel({}, {
      profile: profile('beta', { healthy: { stamina: 4 }, injured: { stamina: 4 } }),
    });

    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount: 99, source: m1 },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };
    const result = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dealt = result.events.find(e => e.type === 'DAMAGE_DEALT');
    expect(dealt?.type === 'DAMAGE_DEALT' && dealt.amount).toBe(4);
  });
});

describe('reaction windows', () => {
  const activate: Action = { type: 'ACTIVATE', player: p1, modelId: m1 };
  const strike = (name = STRIKE): Action => ({
    type: 'ATTACK',
    player: p1,
    attackerId: m1,
    targetId: m2,
    attackName: name,
  });

  /** A defender holding VIBRANIUM ARMOR, and the Power to use it. */
  const defender = (
    over: { damageTypes?: readonly DamageType[]; power?: number; cost?: number } = {},
  ) => ({
    profile: profile('beta', {
      healthy: { superpowers: [shield('VIBRANIUM ARMOR', 2, over.damageTypes ?? [], over.cost ?? 2)] },
    }),
    power: over.power ?? 3,
  });

  it('opens no window when nobody has an eligible reaction', () => {
    // A window that prompts a player to decline something they could never
    // have done turns every attack into four pointless questions.
    const state = play(createSparringGame(), [activate, strike()]);
    expect(state.stack.some(f => f.kind === 'reactionWindow')).toBe(false);
    expect(state.prompt?.kind).not.toBe('declareReaction');
  });

  it('pauses the attack and offers the reaction to the target', () => {
    const state = play(duel({}, defender()), [activate, strike()]);

    expect(state.prompt).toMatchObject({
      kind: 'declareReaction',
      player: p2,
      timing: 'targeted',
      options: [{ modelId: m2, superpower: 'VIBRANIUM ARMOR', cost: 2 }],
    });
  });

  it('suspends the attack mid-sequence, as serializable data', () => {
    // This is the architecture's central claim (docs/ARCHITECTURE.md §4): a
    // half-resolved attack is a value, not a closure, and survives a round
    // trip through JSON.
    const state = play(duel({}, defender()), [activate, strike()]);

    const attack = state.stack.find(f => f.kind === 'attack');
    expect(attack?.kind === 'attack' && attack.step).toBe('payPower');
    expect(state.stack.map(f => f.kind)).toEqual(['activation', 'attack', 'reactionWindow']);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('adds the dice to the defense pool when the reaction is used', () => {
    const state = duel({}, defender());
    const paused = play(state, [activate, strike()]);
    const result = applyAction(paused, {
      type: 'DECLARE_REACTION',
      player: p2,
      modelId: m2,
      superpower: 'VIBRANIUM ARMOR',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Base defense 3, plus 2 from the reaction. Criticals can only add.
    const defense = result.events.filter(e => e.type === 'DICE_ROLLED')[1];
    expect(defense?.type === 'DICE_ROLLED' && defense.faces.length).toBeGreaterThanOrEqual(5);
    expect(result.events.filter(e => e.type === 'REACTION_USED')).toHaveLength(1);

    // The cost, asserted as the spend rather than as the final total: the
    // defender may also gain Power from whatever damage gets through, and
    // netting the two off would measure both rules at once.
    const spent = result.events.find(e => e.type === 'POWER_SPENT');
    expect(spent?.type === 'POWER_SPENT' && spent.amount).toBe(2);
  });

  it('carries on with the attack when the reaction is declined', () => {
    const paused = play(duel({}, defender()), [activate, strike()]);
    const result = applyAction(paused, { type: 'PASS_REACTION', player: p2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Nothing was paid for, and the attack ran to completion.
    expect(result.events.filter(e => e.type === 'POWER_SPENT')).toHaveLength(0);
    expect(result.state.stack.filter(f => f.kind === 'attack')).toHaveLength(0);
  });

  it('does not offer a reaction gated on a damage type the attack is not', () => {
    // "When this character is targeted by a {PHYS} or {ENRG} attack" — a
    // Mystic attack must not open the window at all.
    const mystic = profile('alpha', {
      healthy: { attacks: [attackProfile({ type: 'mystic' })] },
    });
    const state = play(
      duel({ profile: mystic }, defender({ damageTypes: ['physical', 'energy'] })),
      [activate, strike()],
    );

    expect(state.prompt?.kind).not.toBe('declareReaction');
  });

  it('does offer it when the damage type matches', () => {
    const state = play(duel({}, defender({ damageTypes: ['physical', 'energy'] })), [
      activate,
      strike(),
    ]);
    expect(state.prompt?.kind).toBe('declareReaction');
  });

  it('does not offer a reaction the character cannot pay for', () => {
    // Seeded 0, so the round-1 Power Phase leaves exactly 1 against a cost of 2.
    const state = play(duel({}, defender({ power: 0, cost: 2 })), [activate, strike()]);
    expect(state.prompt?.kind).not.toBe('declareReaction');
  });

  it('rejects a reaction that was never on offer', () => {
    const paused = play(duel({}, defender()), [activate, strike()]);
    const result = applyAction(paused, {
      type: 'DECLARE_REACTION',
      player: p2,
      modelId: m2,
      superpower: 'PERFECT BLOCK',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('UNEXPECTED_ACTION');
  });

  it('will not let the same reaction be used twice in one window', () => {
    const paused = play(duel({}, defender({ power: 9 })), [activate, strike()]);
    const once = applyAction(paused, {
      type: 'DECLARE_REACTION',
      player: p2,
      modelId: m2,
      superpower: 'VIBRANIUM ARMOR',
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;

    // The window closed because the only option was spent, so the attack ran
    // to completion rather than asking again.
    expect(once.state.stack.filter(f => f.kind === 'reactionWindow')).toHaveLength(0);
    // Recorded on the window, which is gone with it — not on the character.
    expect(once.state.models[m2]?.usedThisTurn).not.toContain('VIBRANIUM ARMOR');
  });

  it('offers the same reaction again on the next attack of one activation', () => {
    // Regression: use was recorded on the model for the whole turn, so a
    // defender who shielded the first of two attacks in an enemy activation
    // was denied the shield against the second. Almost none of the printed
    // defensive superpowers carry a once-per-Turn restriction, and none of the
    // nine currently registered do.
    const paused = play(duel({}, defender({ power: 9 })), [activate, strike()]);
    const first = applyAction(paused, {
      type: 'DECLARE_REACTION',
      player: p2,
      modelId: m2,
      superpower: 'VIBRANIUM ARMOR',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = applyAction(first.state, strike());
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.state.prompt).toMatchObject({
      kind: 'declareReaction',
      options: [{ modelId: m2, superpower: 'VIBRANIUM ARMOR' }],
    });
  });

  it('never offers a reaction to the wrong side of the attack', () => {
    // The shield triggers on being *targeted*. Giving it to the attacker must
    // not open a window on their own attack.
    const state = play(duel(defender(), {}), [activate, strike()]);
    expect(state.prompt?.kind).not.toBe('declareReaction');
  });
});

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

describe('gaining Power from damage', () => {
  // "Whenever a character suffers Damage as a result of an enemy effect, that
  // character gains Power equal to the amount of Damage suffered."
  //
  // Asserted as a delta throughout, because every character also holds the 1
  // Power the round-1 Power Phase gave it.
  const hurt = (state: GameState, amount: number, source: ModelId | null): number => {
    const before = state.models[m2]?.power ?? 0;
    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount, source },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };
    const result = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    if (!result.ok) throw new Error(result.rejection.code);
    return (result.state.models[m2]?.power ?? 0) - before;
  };

  const target = () => duel({}, { profile: profile('beta', { healthy: { stamina: 10 } }) });

  it('gives Power equal to the damage suffered', () => {
    expect(hurt(target(), 3, m1)).toBe(3);
  });

  it('gives Power for the damage that landed, not the damage offered', () => {
    // Stamina 10 and no prior damage, so an 18-damage hit is capped at 10 —
    // and the excess that step 12 ignores must not pay for anything.
    expect(hurt(target(), 18, m1)).toBe(10);
  });

  it('gives no Power for damage a character does to itself', () => {
    expect(hurt(target(), 3, m2)).toBe(0);
  });

  it('gives no Power for damage from an ally', () => {
    const state = createGame({
      seed: 1,
      players: [
        { id: p1, displayName: 'One' },
        { id: p2, displayName: 'Two' },
      ],
      models: [
        { id: m1, characterId: 'alpha' as CharacterId, owner: p1, pos: vec3(12, 18, 0) },
        { id: m2, characterId: 'beta' as CharacterId, owner: p2, pos: vec3(16, 18, 0) },
        { id: m4, characterId: 'delta' as CharacterId, owner: p2, pos: vec3(20, 18, 0) },
      ],
    });
    expect(hurt(state, 3, m4)).toBe(0);
  });

  it('gives no Power for damage with no source at all', () => {
    // The board, a rule, an effect nobody owns. Not an enemy effect.
    expect(hurt(target(), 3, null)).toBe(0);
  });

  it('emits POWER_GAINED alongside the damage', () => {
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 10 } }) });
    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount: 4, source: m1 },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };
    const result = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const gained = result.events.find(e => e.type === 'POWER_GAINED');
    expect(gained?.type === 'POWER_GAINED' && gained.amount).toBe(4);

    const types = result.events.map(e => e.type);
    expect(types.indexOf('DAMAGE_DEALT')).toBeLessThan(types.indexOf('POWER_GAINED'));
  });

  it('emits nothing when no Power is gained', () => {
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 10 } }) });
    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount: 4, source: null },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };
    const result = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.filter(e => e.type === 'POWER_GAINED')).toHaveLength(0);
  });

  it('gains Power through a real attack, not only a primed frame', () => {
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 10 } }) });
    const before = state.models[m2]?.power ?? 0;

    const result = applyAll(state, [
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: STRIKE },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dealt = result.events.find(e => e.type === 'DAMAGE_DEALT');
    const damage = dealt?.type === 'DAMAGE_DEALT' ? dealt.amount : 0;
    expect((result.state.models[m2]?.power ?? 0) - before).toBe(damage);
  });

  it('carries Power across the end of a round, on top of the new grant', () => {
    // Damage and Power persist through Cleanup; only activation bookkeeping is
    // cleared. The next Power Phase then adds its own 1.
    const state = duel({}, { profile: profile('beta', { healthy: { stamina: 10 } }) });
    const primed: GameState = {
      ...state,
      stack: [
        { kind: 'applyDamage', modelId: m2, amount: 3, source: m1 },
        { kind: 'activation', modelId: m1, actionsRemaining: 0 },
      ],
      prompt: { kind: 'chooseAction', player: p1, modelId: m1 },
    };
    const hit = applyAction(primed, { type: 'END_ACTIVATION', player: p1 });
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;

    // 1 from the Power Phase, plus 3 from the damage.
    expect(hit.state.models[m2]?.power).toBe(4);

    // Both models are still unspent — the primed frame bypassed ACTIVATE — so
    // the round only turns over once each has taken its turn.
    const round2 = play(hit.state, [
      { type: 'ACTIVATE', player: p2, modelId: m2 },
      { type: 'END_ACTIVATION', player: p2 },
      { type: 'ACTIVATE', player: p1, modelId: m1 },
      { type: 'END_ACTIVATION', player: p1 },
    ]);
    expect(round2.round).toBe(2);
    expect(round2.models[m2]?.power).toBe(5);
  });
});
