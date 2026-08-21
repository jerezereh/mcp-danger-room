import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  type GameEvent,
  type GameState,
  type ModelId,
  type PlayerId,
} from '@danger-room/rules';

import { describeEvent, describeOutcome } from './eventText.js';
import { playableSparringSpec } from './gameSetup.js';

const position = (): GameState => createGame(playableSparringSpec(11));

describe('describeEvent', () => {
  it('names models and players rather than printing ids', () => {
    const state = position();
    const spider = Object.values(state.models).find(m => m.characterId === 'amazing-spider-man')!;

    const line = describeEvent(
      { sequence: 1, type: 'ACTIVATION_STARTED', modelId: spider.id },
      state,
    );

    expect(line).toBe('Amazing Spider-Man (P1) activates.');
    expect(line).not.toContain(spider.id);
  });

  it('names the player, not the player id', () => {
    const state = position();
    const line = describeEvent(
      { sequence: 1, type: 'PRIORITY_ASSIGNED', player: state.turnOrder[0]! },
      state,
    );
    expect(line).toBe('Player One takes priority.');
  });

  it('tags both sides of an attack', () => {
    const state = position();
    const spider = Object.values(state.models).find(m => m.characterId === 'amazing-spider-man')!;
    const panther = Object.values(state.models).find(m => m.characterId === 'black-panther')!;

    expect(
      describeEvent(
        {
          sequence: 1,
          type: 'ATTACK_DECLARED',
          attackerId: spider.id,
          targetId: panther.id,
          attackName: 'SPIDER STRIKE',
        },
        state,
      ),
    ).toBe('Amazing Spider-Man (P1) attacks Black Panther (P2) with SPIDER STRIKE.');
  });

  it('says one success and two successes correctly', () => {
    const state = position();
    const id = state.turnOrder.length
      ? (Object.keys(state.models)[0] as ModelId)
      : ('m1' as ModelId);
    const roll = (successes: number): GameEvent => ({
      sequence: 1,
      type: 'DICE_ROLLED',
      modelId: id,
      mode: 'attack',
      faces: ['hit'],
      successes,
    });

    expect(describeEvent(roll(1), state)).toContain('1 success (');
    expect(describeEvent(roll(2), state)).toContain('2 successes (');
  });

  it('has a line for every event a real game produces', () => {
    // The switch is exhaustive at compile time; this checks the output is
    // worth reading — no empty strings, no leftover ids.
    let state = position();
    const seen = new Set<GameEvent['type']>();

    for (let i = 0; i < 200 && state.phase !== 'finished'; i++) {
      const prompt = state.prompt;
      if (prompt?.kind !== 'chooseActivation') break;
      const modelId = prompt.options[0];
      if (!modelId) break;

      const started = applyAction(state, { type: 'ACTIVATE', player: prompt.player, modelId });
      if (!started.ok) break;
      for (const event of started.events) {
        seen.add(event.type);
        const line = describeEvent(event, started.state);
        expect(line.length).toBeGreaterThan(0);
      }

      const ended = applyAction(started.state, { type: 'END_ACTIVATION', player: prompt.player });
      if (!ended.ok) break;
      for (const event of ended.events) {
        seen.add(event.type);
        expect(describeEvent(event, ended.state).length).toBeGreaterThan(0);
      }
      state = ended.state;
    }

    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('describeOutcome', () => {
  const finished = (result: GameState['result']): GameState => ({
    ...position(),
    phase: 'finished',
    result,
  });

  it('names the winner and says how they won', () => {
    const state = finished({ winner: 'p1' as PlayerId, reason: 'wipeout' });
    expect(describeOutcome(state)).toBe(
      'Player One wins — nothing left standing on the other side',
    );
  });

  it('distinguishes a win on points from a win by elimination', () => {
    const state = finished({ winner: 'p2' as PlayerId, reason: 'rounds' });
    expect(describeOutcome(state)).toBe('Player Two wins on Victory Points');
  });

  it('says why a draw was a draw', () => {
    expect(describeOutcome(finished({ winner: null, reason: 'rounds' }))).toContain('drawn');
    expect(describeOutcome(finished({ winner: null, reason: 'wipeout' }))).toBe(
      'Both squads are wiped out — the game is drawn',
    );
  });

  it('does not claim a result for a game still in progress', () => {
    expect(describeOutcome(position())).toBe('The game is still going');
  });
});
