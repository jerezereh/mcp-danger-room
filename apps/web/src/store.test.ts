/**
 * The contract the board and the action bar are written against.
 *
 * Neither component is rendered here — this drives the store with the exact
 * actions the buttons dispatch, which is the part that can be wrong in a way
 * typechecking will not catch. What it is really asserting is that a whole
 * turn is reachable through the client's own vocabulary, because until now it
 * was not: the client had a single dispatch and no way to answer a
 * `chooseAction` prompt at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { statsAt, vec3, type ModelId } from '@danger-room/rules';

import { useStore } from './store.js';

const state = () => useStore.getState();
const game = () => useStore.getState().session.state;

beforeEach(() => {
  useStore.getState().newGame(11);
});

describe('driving a turn through the store', () => {
  it('opens with an activation prompt and nothing armed', () => {
    expect(game().prompt?.kind).toBe('chooseActivation');
    expect(state().boardMode).toEqual({ kind: 'idle' });
  });

  it('activates, moves, attacks and ends — the whole vocabulary', () => {
    const prompt = game().prompt;
    expect(prompt?.kind).toBe('chooseActivation');
    if (prompt?.kind !== 'chooseActivation') return;

    const modelId = prompt.options[0] as ModelId;
    state().dispatch({ type: 'ACTIVATE', player: prompt.player, modelId });
    expect(game().prompt).toMatchObject({ kind: 'chooseAction', modelId });

    // Move, the way a board click does: one destination, measured from where
    // the model actually is.
    const before = game().models[modelId]!;
    const stats = statsAt(game().profiles[before.characterId]!, before.health);
    state().dispatch({
      type: 'MOVE',
      player: before.owner,
      modelId,
      template: stats.movement,
      path: [vec3(before.pos.x, before.pos.y + 1, 0)],
    });
    expect(game().models[modelId]?.pos.y).toBeCloseTo(before.pos.y + 1);
    expect(state().lastRejection).toBeNull();

    // Attack, the way clicking a highlighted enemy does.
    const attacker = game().models[modelId]!;
    const enemy = Object.values(game().models).find(m => m.owner !== attacker.owner);
    expect(enemy).toBeDefined();
    if (!enemy) return;

    state().dispatch({
      type: 'ATTACK',
      player: attacker.owner,
      attackerId: modelId,
      targetId: enemy.id,
      attackName: stats.attacks[0]!.name,
    });

    // Two actions spent, so the activation ended itself and the turn moved on.
    expect(game().prompt?.kind).toBe('chooseActivation');
    expect(state().events.some(e => e.type === 'ATTACK_DECLARED')).toBe(true);
  });

  it('clears what is armed once an action is accepted', () => {
    const prompt = game().prompt;
    if (prompt?.kind !== 'chooseActivation') return;
    const modelId = prompt.options[0] as ModelId;

    state().dispatch({ type: 'ACTIVATE', player: prompt.player, modelId });
    state().setBoardMode({ kind: 'attack', attackName: 'SPIDER STRIKE' });
    expect(state().boardMode.kind).toBe('attack');

    const attacker = game().models[modelId]!;
    const enemy = Object.values(game().models).find(m => m.owner !== attacker.owner)!;
    state().dispatch({
      type: 'ATTACK',
      player: attacker.owner,
      attackerId: modelId,
      targetId: enemy.id,
      attackName: 'SPIDER STRIKE',
    });

    expect(state().boardMode).toEqual({ kind: 'idle' });
  });

  it('keeps what is armed when the engine refuses', () => {
    // An out-of-range click should leave you still choosing a target rather
    // than dropping you back to the start with an error and no aim.
    const prompt = game().prompt;
    if (prompt?.kind !== 'chooseActivation') return;
    const modelId = prompt.options[0] as ModelId;

    state().dispatch({ type: 'ACTIVATE', player: prompt.player, modelId });
    state().setBoardMode({ kind: 'move', template: 'S' });

    const model = game().models[modelId]!;
    state().dispatch({
      type: 'MOVE',
      player: model.owner,
      modelId,
      template: 'S',
      // Far beyond any template.
      path: [vec3(model.pos.x + 30, model.pos.y, 0)],
    });

    expect(state().lastRejection?.code).toBe('ILLEGAL_MOVE');
    expect(state().boardMode).toEqual({ kind: 'move', template: 'S' });
    expect(game().models[modelId]?.pos).toEqual(model.pos);
  });

  it('does not log a refused action', () => {
    const prompt = game().prompt;
    if (prompt?.kind !== 'chooseActivation') return;

    const before = state().session.actions.length;
    // p2 cannot activate on p1's turn.
    state().dispatch({
      type: 'ACTIVATE',
      player: game().turnOrder[1]!,
      modelId: prompt.options[0]!,
    });

    expect(state().lastRejection).not.toBeNull();
    expect(state().session.actions).toHaveLength(before);
  });

  it('disarms the board when a snapshot replaces the position', () => {
    // A snapshot is authoritative state arriving from elsewhere and can move
    // play to another character entirely. An armed mode belongs to the
    // position it was armed in, so carrying it across would let the next board
    // click issue an action for whoever happens to be acting now.
    const prompt = game().prompt;
    if (prompt?.kind !== 'chooseActivation') return;

    state().dispatch({ type: 'ACTIVATE', player: prompt.player, modelId: prompt.options[0]! });
    state().setBoardMode({ kind: 'attack', attackName: 'SPIDER STRIKE' });
    expect(state().boardMode.kind).toBe('attack');

    state().applySnapshot(game());
    expect(state().boardMode).toEqual({ kind: 'idle' });
  });

  it('answers a reaction prompt', () => {
    // Reactions are reachable in ordinary play now, so the client has to be
    // able to answer one. Play until a window opens.
    for (let i = 0; i < 400 && game().prompt?.kind !== 'declareReaction'; i++) {
      const prompt = game().prompt;
      if (prompt?.kind === 'chooseActivation') {
        const modelId = prompt.options[0];
        if (!modelId) break;
        state().dispatch({ type: 'ACTIVATE', player: prompt.player, modelId });
        continue;
      }
      if (prompt?.kind === 'chooseAction') {
        const model = game().models[prompt.modelId]!;
        const stats = statsAt(game().profiles[model.characterId]!, model.health);
        const enemy = Object.values(game().models).find(
          m => m.owner !== model.owner && m.health !== 'ko' && !m.dazed,
        );
        const attackName = stats.attacks[0]?.name;

        if (enemy && attackName) {
          const beforeSeq = game().sequence;
          state().dispatch({
            type: 'ATTACK',
            player: model.owner,
            attackerId: model.id,
            targetId: enemy.id,
            attackName,
          });
          if (game().sequence !== beforeSeq) continue;
        }
        state().dispatch({ type: 'END_ACTIVATION', player: prompt.player });
        continue;
      }
      break;
    }

    const prompt = game().prompt;
    expect(prompt?.kind).toBe('declareReaction');
    if (prompt?.kind !== 'declareReaction') return;

    const option = prompt.options[0];
    expect(option).toBeDefined();
    if (!option) return;

    state().dispatch({
      type: 'DECLARE_REACTION',
      player: prompt.player,
      modelId: option.modelId,
      superpower: option.superpower,
    });

    expect(state().lastRejection).toBeNull();
    expect(state().events.some(e => e.type === 'REACTION_USED')).toBe(true);
  });
});
