import { describe, expect, it } from 'vitest';

import {
  countSuccesses,
  DIE_FACES,
  resolveCriticals,
  roll,
  rollPool,
  type DieFace,
} from './dice.js';
import { createRng } from './rng.js';

const faces = (...list: DieFace[]): DieFace[] => list;

describe('counting successes', () => {
  it('counts Critical, Wild and Hit for the attacker', () => {
    const pool = faces('critical', 'wild', 'hit', 'block', 'blank');
    expect(countSuccesses(pool, 'attack')).toBe(3);
  });

  it('counts Critical, Wild and Block for the defender', () => {
    const pool = faces('critical', 'wild', 'hit', 'block', 'blank');
    expect(countSuccesses(pool, 'defense')).toBe(3);
  });

  it('never counts a blank', () => {
    expect(countSuccesses(faces('blank', 'blank'), 'attack')).toBe(0);
    expect(countSuccesses(faces('blank', 'blank'), 'defense')).toBe(0);
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

  it('counts successes across both the initial and the bonus dice', () => {
    const { result } = roll(createRng(11), 6, 'attack');
    const expected = countSuccesses([...result.faces, ...result.bonusFaces], 'attack');
    expect(result.successes).toBe(expected);
  });

  it('is deterministic for a given seed', () => {
    expect(roll(createRng(42), 5, 'attack')).toEqual(roll(createRng(42), 5, 'attack'));
  });
});
