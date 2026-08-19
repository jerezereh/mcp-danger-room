import { describe, expect, it } from 'vitest';

import { characters } from '../characters.js';
import { alternateMode, splitForms } from './forms.js';

const block = (names: string[]) =>
  ({
    cardImage: 'X_NORMAL_injured.png',
    stamina: 5,
    movement: 'S' as const,
    size: 2,
    defense: { physical: 2, energy: 2, mystic: 2 },
    attacks: [],
    superpowers: names.map(name => ({ name, type: 'innate' as const, cost: 0, text: '' })),
  });

const character = (names: string[]) =>
  ({
    id: 'x',
    name: 'X',
    alterEgo: null,
    affiliations: [],
    packCode: null,
    packName: null,
    threat: 3,
    errata: null,
    baseMm: 40,
    healthy: block(names),
    injured: block(names),
    sources: [],
    forms: [],
    verified: false,
  }) as unknown as Parameters<typeof splitForms>[0];

/*
 * BSData flattens a transforming character's two modes into one record and
 * marks each ability with the mode it belongs to. Read literally, Ant-Man has
 * six superpowers, three of which he cannot use.
 */
describe('alternateMode', () => {
  it('finds the mode opposite NORMAL', () => {
    expect(alternateMode(character(['NORMAL - A', 'TINY - B']))).toBe('TINY');
  });

  it('ignores a prefix that is not a mode', () => {
    // Black Bolt prefixes an ability "WHISPER - " and does not transform.
    expect(alternateMode(character(['WHISPER - A', 'B']))).toBeUndefined();
  });

  it('ignores more than one alternate — that is not a pattern we understand', () => {
    expect(alternateMode(character(['NORMAL - A', 'TINY - B', 'HUGE - C']))).toBeUndefined();
  });
});

describe('splitForms', () => {
  it('leaves a character that does not transform untouched', () => {
    const before = character(['WHISPER - A', 'B']);
    expect(splitForms(before, null)).toBe(before);
  });

  it('puts each ability in its own mode, without the prefix', () => {
    const out = splitForms(character(['NORMAL - A', 'TINY - B']), 'X_TINY_injured.png');
    expect(out.healthy.superpowers.map(p => p.name)).toEqual(['A']);
    expect(out.forms[0]?.name).toBe('Tiny');
    expect(out.forms[0]?.healthy.superpowers.map(p => p.name)).toEqual(['B']);
  });

  it('gives an unprefixed ability to both modes', () => {
    // Printed once, applies whichever face is showing.
    const out = splitForms(character(['NORMAL - A', 'TINY - B', 'Shared']), null);
    expect(out.healthy.superpowers.map(p => p.name)).toEqual(['A', 'Shared']);
    expect(out.forms[0]?.healthy.superpowers.map(p => p.name)).toEqual(['B', 'Shared']);
  });

  it('derives the alternate healthy face from its injured one', () => {
    // Cerebro names only the alternate back; the front follows the pattern.
    const out = splitForms(character(['NORMAL - A', 'TINY - B']), 'ANT_MAN_TINY_injured.png');
    expect(out.forms[0]?.healthy.cardImage).toBe('ANT_MAN_TINY_healthy.png');
    expect(out.forms[0]?.injured.cardImage).toBe('ANT_MAN_TINY_injured.png');
  });
});

describe('the corpus', () => {
  it('has exactly the six characters that transform', () => {
    expect(characters.filter(c => c.forms.length > 0).map(c => c.id).sort()).toEqual([
      'ant-man',
      'captain-marvel-cosmic-avenger',
      'emma-frost',
      'hood',
      'ms-marvel',
      'wasp',
    ]);
  });

  it('leaves no mode prefix behind on a character that was split', () => {
    for (const c of characters.filter(x => x.forms.length > 0)) {
      const names = [c.healthy, c.injured, ...c.forms.flatMap(f => [f.healthy, f.injured])]
        .flatMap(s => [...s.attacks, ...s.superpowers])
        .map(a => a.name);
      expect(names.filter(n => /^[A-Z]+ - /.test(n)), c.id).toEqual([]);
    }
  });
});
