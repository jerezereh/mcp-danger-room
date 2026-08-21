/**
 * Naming, and the case #22 was actually about: two players fielding the same
 * character.
 */

import { describe, expect, it } from 'vitest';
import {
  createGame,
  vec3,
  type CharacterId,
  type GameState,
  type ModelId,
  type PlayerId,
} from '@danger-room/rules';

import { playableSparringSpec } from './gameSetup.js';
import { labelOf, nameOf, playerOf, sideOf } from './names.js';

const p1 = 'p1' as PlayerId;
const p2 = 'p2' as PlayerId;
const m1 = 'm1' as ModelId;
const m2 = 'm2' as ModelId;

const position = (): GameState => createGame(playableSparringSpec(11));

/** Both players fielding Amazing Spider-Man, which the squad rules allow. */
function mirrorMatch(): GameState {
  const spec = playableSparringSpec(11);
  const spider = spec.models.find(m => m.characterId === 'amazing-spider-man');
  if (!spider) throw new Error('sparring position changed');

  return createGame({
    ...spec,
    models: [
      { ...spider, id: m1, owner: p1, pos: vec3(12, 18, 0) },
      { ...spider, id: m2, owner: p2, pos: vec3(16, 18, 0) },
    ],
  });
}

describe('nameOf', () => {
  it('reads the name off the profile the game is being played with', () => {
    expect(nameOf(position(), m1)).toBe('Amazing Spider-Man');
  });

  it('does not invent a name for a model with no card', () => {
    // A training dummy answering to "Amazing Spider-Man" while rolling a
    // generic 5-dice STRIKE is the same failure as a placeholder stat block:
    // a confident answer that is not true.
    const dummies = createGame({
      seed: 1,
      players: [{ id: p1, displayName: 'One' }],
      models: [
        { id: m1, characterId: 'amazing-spider-man' as CharacterId, owner: p1, pos: vec3(1, 1, 0) },
      ],
    });

    expect(nameOf(dummies, m1)).toContain('Training Dummy');
    expect(nameOf(dummies, m1)).toContain('amazing-spider-man');
  });

  it('falls back to the id for a model that is not there', () => {
    expect(nameOf(position(), 'nobody' as ModelId)).toBe('nobody');
  });
});

describe('sides', () => {
  it('reads the tag off turn order, not off the id', () => {
    const state = position();
    expect(sideOf(state, p1)).toBe('P1');
    expect(sideOf(state, p2)).toBe('P2');
  });

  it('names players by their display name', () => {
    expect(playerOf(position(), p1)).toBe('Player One');
  });
});

describe('labelOf', () => {
  it('tells two of the same character apart across the table', () => {
    // The reason #22 exists: both players may field the same character.
    const mirror = mirrorMatch();

    expect(nameOf(mirror, m1)).toBe(nameOf(mirror, m2));
    expect(labelOf(mirror, m1)).toBe('Amazing Spider-Man (P1)');
    expect(labelOf(mirror, m2)).toBe('Amazing Spider-Man (P2)');
    expect(labelOf(mirror, m1)).not.toBe(labelOf(mirror, m2));
  });

  it('tells two of the same character apart on the same side', () => {
    // Prime Sentinel and Sentinel MK4 each print an innate superpower letting
    // a player take two: "when building a Roster or a Squad, a player may
    // include 2 of this character instead of the normal 1". So a side tag
    // alone is not enough, which an earlier version of `labelOf` assumed.
    const spec = playableSparringSpec(11);
    const spider = spec.models.find(m => m.characterId === 'amazing-spider-man')!;

    const twins = createGame({
      ...spec,
      models: [
        { ...spider, id: m1, owner: p1, pos: vec3(12, 18, 0) },
        { ...spider, id: m2, owner: p1, pos: vec3(20, 18, 0) },
      ],
    });

    expect(labelOf(twins, m1)).toBe('Amazing Spider-Man #1 (P1)');
    expect(labelOf(twins, m2)).toBe('Amazing Spider-Man #2 (P1)');
  });

  it('leaves an unambiguous name alone', () => {
    // The ordinal is noise on every ordinary line, so it only appears where a
    // name is genuinely ambiguous for that side.
    expect(labelOf(position(), m1)).toBe('Amazing Spider-Man (P1)');
    expect(labelOf(position(), m1)).not.toContain('#');
  });
});
