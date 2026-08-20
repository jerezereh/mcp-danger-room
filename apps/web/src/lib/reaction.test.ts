/**
 * A printed superpower, run end to end.
 *
 * `docs/ARCHITECTURE.md` §11 calls the frame stack "a bet that this is
 * manageable" and names one complete attack with one reactive superpower as
 * the test of that bet. This is that test, against the real card rather than a
 * hand-written fixture: Black Panther's VIBRANIUM ARMOR, from the corpus,
 * interrupting Spider-Man's SPIDER STRIKE in the shared opening position.
 */

import { describe, expect, it } from 'vitest';
import { charactersById, reactionFor } from '@danger-room/data';
import { applyAction, createGame, type GameState } from '@danger-room/rules';

import { playableSparringSpec } from './gameSetup.js';
import { profileFor } from './profile.js';

const VIBRANIUM_ARMOR = 'VIBRANIUM ARMOR - Injured';

/** The sparring position, with Black Panther able to afford his reaction. */
function position(seed = 4): GameState {
  const spec = playableSparringSpec(seed);
  return createGame({
    ...spec,
    models: spec.models.map(model =>
      model.characterId === 'black-panther' ? { ...model, power: 3 } : model,
    ),
  });
}

describe('the reaction registry', () => {
  it('matches a structured trigger to the printed superpower', () => {
    const panther = charactersById.get('black-panther');
    expect(panther).toBeDefined();
    if (!panther) return;

    const printed = panther.healthy.superpowers.find(s => s.name === VIBRANIUM_ARMOR);
    expect(printed?.type).toBe('reactive');
    expect(printed?.cost).toBe(2);

    const structured = reactionFor('black-panther', VIBRANIUM_ARMOR);
    expect(structured).toEqual({
      timing: 'targeted',
      role: 'target',
      damageTypes: ['physical', 'energy'],
      effect: { kind: 'addDefenseDice', count: 2 },
    });
  });

  it('leaves superpowers with no structured trigger unoffered but present', () => {
    // The Ancient One's WINDS OF WATOOMB pushes the attacker — an effect the
    // union cannot express. It must still appear on the profile, so the gap
    // reads as "not implemented" rather than as a character with no powers.
    const ancient = charactersById.get('ancient-one');
    expect(ancient).toBeDefined();
    if (!ancient) return;

    const profile = profileFor(ancient);
    const winds = profile.healthy.superpowers.find(s => s.name === 'WINDS OF WATOOMB');
    expect(winds).toBeDefined();
    expect(winds?.type).toBe('reactive');
    expect(winds?.reaction).toBeNull();
  });
});

describe('VIBRANIUM ARMOR, end to end', () => {
  const attack = (state: GameState) => {
    const spider = Object.values(state.models).find(m => m.characterId === 'amazing-spider-man');
    const panther = Object.values(state.models).find(m => m.characterId === 'black-panther');
    if (!spider || !panther) throw new Error('sparring position changed');

    const started = applyAction(state, {
      type: 'ACTIVATE',
      player: spider.owner,
      modelId: spider.id,
    });
    if (!started.ok) throw new Error(started.rejection.message);

    const declared = applyAction(started.state, {
      type: 'ATTACK',
      player: spider.owner,
      attackerId: spider.id,
      targetId: panther.id,
      attackName: 'SPIDER STRIKE',
    });
    if (!declared.ok) throw new Error(declared.rejection.message);

    return { state: declared.state, events: declared.events, spider, panther };
  };

  it('interrupts a real attack with a real superpower', () => {
    const { state, events, panther } = attack(position());

    expect(events.map(e => e.type)).toContain('REACTION_WINDOW_OPENED');
    expect(state.prompt).toMatchObject({
      kind: 'declareReaction',
      player: panther.owner,
      timing: 'targeted',
      options: [{ modelId: panther.id, superpower: VIBRANIUM_ARMOR, cost: 2 }],
    });
  });

  it('adds two dice to the defense roll and charges two Power', () => {
    const { state, panther } = attack(position());

    const used = applyAction(state, {
      type: 'DECLARE_REACTION',
      player: panther.owner,
      modelId: panther.id,
      superpower: VIBRANIUM_ARMOR,
    });
    expect(used.ok).toBe(true);
    if (!used.ok) return;

    // Black Panther's printed physical defense is 4, so the pool is 6 before
    // any critical adds to it.
    const defense = used.events.filter(e => e.type === 'DICE_ROLLED')[1];
    expect(defense?.type === 'DICE_ROLLED' && defense.faces.length).toBeGreaterThanOrEqual(6);

    // Asserted as the spend rather than as the final total: he may also gain
    // Power from whatever damage gets through, and netting the two off would
    // measure the cost and the economy at once.
    const spent = used.events.find(e => e.type === 'POWER_SPENT');
    expect(spent?.type === 'POWER_SPENT' && spent.amount).toBe(2);
  });

  it('is not offered when he cannot pay for it', () => {
    // The unmodified sparring position starts everyone on zero Power.
    const spec = playableSparringSpec(4);
    const { state } = attack(createGame(spec));
    expect(state.prompt?.kind).not.toBe('declareReaction');
  });

  it('is not offered against a Mystic attack', () => {
    // VIBRANIUM ARMOR is gated on {PHYS} or {ENRG}. The Ancient One's SHARDS
    // OF THE SERAPHIM is Mystic, so the window must not open — but he starts
    // out of range, so move him into it first.
    const base = position();
    const ancient = Object.values(base.models).find(m => m.characterId === 'ancient-one');
    const panther = Object.values(base.models).find(m => m.characterId === 'black-panther');
    if (!ancient || !panther) return;

    const state: GameState = {
      ...base,
      models: {
        ...base.models,
        [ancient.id]: { ...ancient, pos: { x: panther.pos.x - 2, y: panther.pos.y, z: 0 } },
      },
    };

    const started = applyAction(state, {
      type: 'ACTIVATE',
      player: ancient.owner,
      modelId: ancient.id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const declared = applyAction(started.state, {
      type: 'ATTACK',
      player: ancient.owner,
      attackerId: ancient.id,
      targetId: panther.id,
      attackName: 'SHARDS OF THE SERAPHIM',
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    expect(declared.state.prompt?.kind).not.toBe('declareReaction');
  });
});
