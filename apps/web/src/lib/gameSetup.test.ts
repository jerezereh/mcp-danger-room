/**
 * The one test that crosses the corpus/engine boundary.
 *
 * Everything either side of it is tested in isolation — the engine against
 * hand-written profiles, the corpus against its schema. This asserts that the
 * two actually meet: that real card data loads into the engine, and that a
 * game played with it reaches an ending instead of stalling.
 */

import { describe, expect, it } from 'vitest';
import { charactersById } from '@danger-room/data';
import { applyAction, createGame, POWER_PER_ROUND, type GameState } from '@danger-room/rules';

import { playableSparringSpec } from './gameSetup.js';
import { profileFor } from './profile.js';

describe('profileFor', () => {
  it('carries the printed stats through unchanged', () => {
    const spider = charactersById.get('amazing-spider-man');
    expect(spider).toBeDefined();
    if (!spider) return;

    const profile = profileFor(spider);
    expect(profile.name).toBe('Amazing Spider-Man');
    expect(profile.baseMm).toBe(spider.baseMm);
    expect(profile.healthy.stamina).toBe(spider.healthy.stamina);
    expect(profile.healthy.defense).toEqual(spider.healthy.defense);
    expect(profile.healthy.attacks.map(a => a.name)).toEqual(
      spider.healthy.attacks.map(a => a.name),
    );
  });

  it('keeps the healthy and injured faces distinct', () => {
    // Black Panther prints 6 healthy and 7 injured. Collapsing the two faces
    // into one was the old engine's flat stamina 6, and it is the thing this
    // mapping exists to prevent.
    const panther = charactersById.get('black-panther');
    expect(panther).toBeDefined();
    if (!panther) return;

    const profile = profileFor(panther);
    expect(profile.healthy.stamina).toBe(panther.healthy.stamina);
    expect(profile.injured.stamina).toBe(panther.injured.stamina);
  });

  it('maps every character in the corpus without throwing', () => {
    expect(() => [...charactersById.values()].map(profileFor)).not.toThrow();
  });
});

/**
 * The dumbest possible player: answer whatever the engine asks.
 *
 * Activate the first model offered, swing at the nearest enemy until the
 * actions run out, decline every reaction. It makes no decisions — the point
 * is that the engine drives itself to an ending, not that anyone plays well.
 *
 * Dispatching on `prompt.kind` rather than assuming a shape is the whole
 * discipline here. A driver that only knew about activations stalled the first
 * time a reaction window opened.
 */
function answerOnePrompt(state: GameState): GameState | null {
  const prompt = state.prompt;
  if (!prompt) return null;

  switch (prompt.kind) {
    case 'declareReaction': {
      const passed = applyAction(state, { type: 'PASS_REACTION', player: prompt.player });
      return passed.ok ? passed.state : null;
    }

    case 'chooseActivation': {
      const modelId = prompt.options[0];
      if (!modelId) return null;
      const started = applyAction(state, { type: 'ACTIVATE', player: prompt.player, modelId });
      return started.ok ? started.state : null;
    }

    case 'chooseAction': {
      const attacker = state.models[prompt.modelId];
      const profile = attacker ? state.profiles[attacker.characterId] : undefined;
      const face =
        attacker && profile
          ? attacker.health === 'healthy'
            ? profile.healthy
            : profile.injured
          : undefined;
      const attackName = face?.attacks[0]?.name;
      const enemy = Object.values(state.models).find(
        m => attacker && m.owner !== attacker.owner && m.health !== 'ko',
      );

      if (attackName && enemy) {
        const hit = applyAction(state, {
          type: 'ATTACK',
          player: prompt.player,
          attackerId: prompt.modelId,
          targetId: enemy.id,
          attackName,
        });
        // A hit spends an action, so this terminates: the activation ends by
        // itself once the budget is gone.
        if (hit.ok) return hit.state;
      }

      const ended = applyAction(state, { type: 'END_ACTIVATION', player: prompt.player });
      return ended.ok ? ended.state : null;
    }

    default:
      return null;
  }
}

describe('the client’s opening position', () => {
  it('attaches a real profile to every model that has a card', () => {
    const spec = playableSparringSpec(1);
    expect(spec.models).not.toHaveLength(0);

    for (const model of spec.models) {
      expect(model.profile?.characterId).toBe(model.characterId);
      expect(model.profile?.name).not.toBe('Training Dummy');
    }
  });

  it('plays a whole game through to the end on real card data', () => {
    let state: GameState = createGame(playableSparringSpec(11));

    // Bounded so a loop bug fails the test rather than hanging the suite.
    for (let i = 0; i < 1000 && state.phase !== 'finished'; i++) {
      const next = answerOnePrompt(state);
      expect(next).not.toBeNull();
      if (!next) return;
      state = next;
    }

    expect(state.phase).toBe('finished');
    expect(state.prompt).toBeNull();
  });

  it('closes the loop: damage pays for the reaction it provokes', () => {
    // The economy and the reaction machinery only meet in a real game. Every
    // character opens holding just the 1 Power the round-1 Power Phase gave
    // it — not enough for any defensive superpower in the corpus, which all
    // cost 2 — then earns the rest by being punched.
    let state: GameState = createGame(playableSparringSpec(11));
    expect(Object.values(state.models).every(m => m.power === POWER_PER_ROUND)).toBe(true);
    expect(POWER_PER_ROUND).toBeLessThan(2);

    for (let i = 0; i < 1000 && state.prompt?.kind !== 'declareReaction'; i++) {
      const next = answerOnePrompt(state);
      if (!next) break;
      state = next;
    }

    const prompt = state.prompt;
    expect(prompt?.kind).toBe('declareReaction');
    if (prompt?.kind !== 'declareReaction') return;

    const option = prompt.options[0];
    expect(option).toBeDefined();
    if (!option) return;

    // Paid for out of Power nobody started the game with.
    expect(option.cost).toBeGreaterThan(0);
    expect(state.models[option.modelId]?.power).toBeGreaterThanOrEqual(option.cost);
  });

  it('rolls the dice the cards print, not a constant', () => {
    // Spider-Man's SPIDER STRIKE is 5 dice and Black Panther defends physical
    // with 4 — the old engine rolled 5 and 3 for every character alive.
    const state = createGame(playableSparringSpec(3));

    const spider = Object.values(state.models).find(m => m.characterId === 'amazing-spider-man');
    const panther = Object.values(state.models).find(m => m.characterId === 'black-panther');
    expect(spider && panther).toBeTruthy();
    if (!spider || !panther) return;

    const started = applyAction(state, {
      type: 'ACTIVATE',
      player: spider.owner,
      modelId: spider.id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const result = applyAction(started.state, {
      type: 'ATTACK',
      player: spider.owner,
      attackerId: spider.id,
      targetId: panther.id,
      attackName: 'SPIDER STRIKE',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rolls = result.events.filter(e => e.type === 'DICE_ROLLED');
    const attack = rolls[0];
    const defense = rolls[1];

    // Criticals add dice, so each pool is a floor rather than an exact count.
    expect(attack?.type === 'DICE_ROLLED' && attack.faces.length).toBeGreaterThanOrEqual(5);
    expect(defense?.type === 'DICE_ROLLED' && defense.faces.length).toBeGreaterThanOrEqual(4);
  });
});
