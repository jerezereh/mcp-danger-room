import { describe, expect, it } from 'vitest';

import { characters } from './characters.js';

/**
 * Assertions about the shipped corpus rather than about the code that reads it.
 *
 * `characters.json` is generated and `overrides.json` is the correction path,
 * which leaves a gap nothing else covers: an override can be written, be
 * correct, and still not be in the data anybody actually loads. These tests
 * fail on that gap.
 */
describe('the corpus', () => {
  it('lets exactly two characters be taken twice', () => {
    const twice = characters.filter(c => c.maxCopies > 1);
    expect(twice.map(c => c.id).sort()).toEqual(['prime-sentinel', 'sentinel-mk4']);
    expect(twice.every(c => c.maxCopies === 2)).toBe(true);
  });

  it('gives that allowance only to characters whose card grants it', () => {
    // Ties the number to the printed reason. If a future import drops the
    // superpower, or an override sets `maxCopies` on somebody who never had
    // the text, this is what notices.
    for (const character of characters) {
      const grants = [...character.healthy.superpowers, ...character.injured.superpowers].some(p =>
        /may include 2 of this character/i.test(p.text),
      );
      expect({ id: character.id, grants, maxCopies: character.maxCopies }).toEqual({
        id: character.id,
        grants,
        maxCopies: grants ? 2 : 1,
      });
    }
  });

  it('defaults everybody else to one', () => {
    expect(characters.every(c => c.maxCopies >= 1)).toBe(true);
    expect(characters.filter(c => c.maxCopies === 1)).toHaveLength(characters.length - 2);
  });
});
