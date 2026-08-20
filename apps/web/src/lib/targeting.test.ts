import { describe, expect, it } from 'vitest';
import { applyAction, createGame, vec3, type GameState, type ModelId } from '@danger-room/rules';

import { playableSparringSpec } from './gameSetup.js';
import { targetableBy } from './targeting.js';

const spider = 'm1' as ModelId;
const panther = 'm2' as ModelId;
const ancient = 'm3' as ModelId;

const position = (): GameState => createGame(playableSparringSpec(11));

const modelOf = (state: GameState, id: ModelId) => state.models[id] ?? null;

describe('targetableBy', () => {
  it('highlights an enemy in range and line of sight', () => {
    const state = position();
    // Spider-Man and Black Panther start 4" apart; SPIDER STRIKE is Range 3.
    expect([...targetableBy(state, modelOf(state, spider), 'SPIDER STRIKE')]).toEqual([panther]);
  });

  it('never highlights an ally', () => {
    // The Ancient One is Spider-Man's, so he must not light up however close
    // he is — the engine refuses an allied target outright.
    const state = position();
    const closed: GameState = {
      ...state,
      models: {
        ...state.models,
        [ancient]: { ...state.models[ancient]!, pos: vec3(13, 18, 0) },
      },
    };

    expect(targetableBy(closed, modelOf(closed, spider), 'SPIDER STRIKE').has(ancient)).toBe(false);
  });

  it('drops a target that is out of the attack’s printed range', () => {
    const state = position();
    const far: GameState = {
      ...state,
      models: { ...state.models, [panther]: { ...state.models[panther]!, pos: vec3(34, 18, 0) } },
    };

    expect(targetableBy(far, modelOf(far, spider), 'SPIDER STRIKE').size).toBe(0);
  });

  it('drops a target behind terrain', () => {
    const state = position();
    const crate = state.terrain.find(t => t.blocksLineOfSight);
    expect(crate).toBeDefined();
    if (!crate) return;

    // Put the two models on opposite sides of a blocking piece, close enough
    // that only line of sight can be the reason.
    const blocked: GameState = {
      ...state,
      models: {
        ...state.models,
        [spider]: { ...state.models[spider]!, pos: vec3(crate.pos.x, crate.pos.y - 2, 0) },
        [panther]: { ...state.models[panther]!, pos: vec3(crate.pos.x, crate.pos.y + 2, 0) },
      },
    };

    expect(targetableBy(blocked, modelOf(blocked, spider), 'SPIDER STRIKE').size).toBe(0);
  });

  it('highlights nothing for an attack the character does not have', () => {
    const state = position();
    expect(targetableBy(state, modelOf(state, spider), 'HEAT VISION').size).toBe(0);
  });

  it('highlights nothing when no attack is aimed', () => {
    const state = position();
    expect(targetableBy(state, modelOf(state, spider), null).size).toBe(0);
  });

  it('reads the injured face once a character has flipped', () => {
    const state = position();
    const flipped: GameState = {
      ...state,
      models: { ...state.models, [spider]: { ...state.models[spider]!, health: 'injured' } },
    };

    // Amazing Spider-Man prints SPIDER STRIKE on both faces, so it stays
    // available — the point is that the lookup follows the health state
    // rather than always reading the healthy card.
    expect(targetableBy(flipped, modelOf(flipped, spider), 'SPIDER STRIKE').has(panther)).toBe(
      true,
    );
  });

  it('agrees with the engine about whether the attack is allowed', () => {
    // The contract this module lives under: a highlight is a hint and the
    // engine is the authority. They must not disagree.
    const state = position();
    const started = applyAction(state, {
      type: 'ACTIVATE',
      player: state.models[spider]!.owner,
      modelId: spider,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const highlighted = targetableBy(started.state, modelOf(started.state, spider), 'SPIDER STRIKE');

    for (const model of Object.values(started.state.models)) {
      if (model.id === spider) continue;
      const result = applyAction(started.state, {
        type: 'ATTACK',
        player: started.state.models[spider]!.owner,
        attackerId: spider,
        targetId: model.id,
        attackName: 'SPIDER STRIKE',
      });
      expect(result.ok).toBe(highlighted.has(model.id));
    }
  });
});
