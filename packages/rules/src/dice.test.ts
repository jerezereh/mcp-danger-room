import { describe, expect, it } from 'vitest';

import {
  countSuccesses,
  DIE_FACES,
  isRerollable,
  resolveCriticals,
  roll,
  rollPool,
  type DieFace,
} from './dice.js';
import { createRng } from './rng.js';

const faces = (...list: DieFace[]): DieFace[] => list;

describe('the die', () => {
  it('has the printed distribution', () => {
    // 1 Critical, 1 Wild, 2 Hit, 1 Block, 2 Blank, 1 Failure.
    const count = (face: DieFace) => DIE_FACES.filter(f => f === face).length;

    expect(DIE_FACES).toHaveLength(8);
    expect(count('critical')).toBe(1);
    expect(count('wild')).toBe(1);
    expect(count('hit')).toBe(2);
    expect(count('block')).toBe(1);
    expect(count('blank')).toBe(2);
    expect(count('failure')).toBe(1);
  });

  it('distinguishes a Blank from a Failure', () => {
    // Both do nothing on their own, but only a Blank may be rerolled — and
    // `{FAIL}` is a symbol 126 lines of corpus text refer to in its own right.
    // The engine used to have one face doing both jobs.
    expect(isRerollable('blank')).toBe(true);
    expect(isRerollable('failure')).toBe(false);
  });

  it('lets every other face be rerolled', () => {
    for (const face of ['critical', 'wild', 'hit', 'block'] as const) {
      expect(isRerollable(face)).toBe(true);
    }
  });
});

describe('counting successes', () => {
  it('counts Critical, Wild and Hit for the attacker', () => {
    const pool = faces('critical', 'wild', 'hit', 'block', 'blank', 'failure');
    expect(countSuccesses(pool, 'attack')).toBe(3);
  });

  it('counts Critical, Wild and Block for the defender', () => {
    const pool = faces('critical', 'wild', 'hit', 'block', 'blank', 'failure');
    expect(countSuccesses(pool, 'defense')).toBe(3);
  });

  it('never counts a Blank or a Failure', () => {
    const dead = faces('blank', 'blank', 'failure');
    expect(countSuccesses(dead, 'attack')).toBe(0);
    expect(countSuccesses(dead, 'defense')).toBe(0);
  });
});

describe('resolving criticals', () => {
  // The rulebook, step 8: "each character rolls an additional die for each
  // Critical result in their initial roll. Criticals rolled in this step are
  // not part of the initial roll and do not add further dice to the roll."
  //
  // Regression: the engine used to reroll criticals repeatedly until none
  // appeared, so a pool containing one could grow without bound. A 5-dice
  // attack was observed rolling 8.
  it('rolls exactly one extra die per Critical in the initial roll', () => {
    const initial = faces('critical', 'critical', 'hit', 'blank');
    const { bonusFaces } = resolveCriticals(createRng(1), initial);
    expect(bonusFaces).toHaveLength(2);
  });

  it('does not cascade, whatever the bonus dice come up as', () => {
    // Every seed, so this cannot pass by a lucky roll: the bonus round is
    // always exactly as large as the initial critical count.
    for (let seed = 0; seed < 200; seed++) {
      const initial = faces('critical', 'critical', 'critical');
      const { bonusFaces } = resolveCriticals(createRng(seed), initial);
      expect(bonusFaces).toHaveLength(3);
    }
  });

  it('rolls nothing when there are no Criticals', () => {
    const { bonusFaces, rng } = resolveCriticals(createRng(7), faces('hit', 'block'));
    expect(bonusFaces).toEqual([]);
    // The RNG must not advance either, or a pool with no criticals would
    // silently change every roll that follows it.
    expect(rng).toEqual(createRng(7));
  });
});

describe('the die as a save-format commitment', () => {
  it('turns a fixed seed into a fixed sequence of faces', () => {
    // A save is a seed plus a list of *intents*; the dice are recomputed on
    // load. So `DIE_FACES` is part of the save format, and changing it
    // reinterprets every save ever taken — the same RNG indices, different
    // symbols, a different game.
    //
    // That failure is the quiet kind. The log records "attack with SPIDER
    // STRIKE", not "and rolled four successes", so every action stays legal
    // and the replay succeeds while handing back a board that never happened.
    //
    // If this test fails and the change was intended, bump
    // SAVE_FORMAT_VERSION in persistence.ts so old saves are refused by
    // version rather than silently reinterpreted.
    expect(rollPool(createRng(42), 10).faces).toEqual([
      'block',
      'hit',
      'blank',
      'blank',
      'wild',
      'block',
      'hit',
      'block',
      'blank',
      'hit',
    ]);
  });
});

describe('rolling a pool', () => {
  it('rolls exactly the requested number of dice', () => {
    expect(rollPool(createRng(3), 7).faces).toHaveLength(7);
  });

  it('treats a negative pool as empty rather than throwing', () => {
    expect(rollPool(createRng(3), -2).faces).toEqual([]);
  });

  it('only ever produces real faces', () => {
    const { faces: rolled } = rollPool(createRng(99), 200);
    expect(rolled.every(f => DIE_FACES.includes(f))).toBe(true);
  });

  it('advances the RNG, so two pools from one state differ', () => {
    const first = rollPool(createRng(5), 6);
    const second = rollPool(first.rng, 6);
    expect(second.rng).not.toEqual(first.rng);
  });
});

describe('roll', () => {
  it('keeps the initial roll and the critical dice separate', () => {
    const { result } = roll(createRng(11), 6, 'attack');
    expect(result.faces).toHaveLength(6);
    expect(result.bonusFaces).toHaveLength(result.faces.filter(f => f === 'critical').length);
  });

  it('counts the faces effects trigger on', () => {
    // Nothing reads these yet — the {WILD} clauses printed on attacks and
    // Dormammu's Failure-counting are both unimplemented — but they are the
    // reason the counts are carried at all.
    const { result } = roll(createRng(11), 6, 'attack');
    const all = [...result.faces, ...result.bonusFaces];

    expect(result.wilds).toBe(all.filter(f => f === 'wild').length);
    expect(result.criticals).toBe(all.filter(f => f === 'critical').length);
    expect(result.failures).toBe(all.filter(f => f === 'failure').length);
  });

  it('counts successes across both the initial and the bonus dice', () => {
    const { result } = roll(createRng(11), 6, 'attack');
    const expected = countSuccesses([...result.faces, ...result.bonusFaces], 'attack');
    expect(result.successes).toBe(expected);
  });

  it('is deterministic for a given seed', () => {
    expect(roll(createRng(42), 5, 'attack')).toEqual(roll(createRng(42), 5, 'attack'));
  });
});
