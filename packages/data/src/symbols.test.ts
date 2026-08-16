import { describe, expect, it } from 'vitest';

import { tokenize, toPlainText, unknownSymbols } from './symbols.js';

describe('card text tokenizer', () => {
  it('splits symbols out of surrounding prose', () => {
    expect(tokenize('gains {PWR} equal to the {DMG} dealt.')).toEqual([
      { kind: 'text', value: 'gains ' },
      { kind: 'symbol', key: 'power' },
      { kind: 'text', value: ' equal to the ' },
      { kind: 'symbol', key: 'damage' },
      { kind: 'text', value: ' dealt.' },
    ]);
  });

  it('recognizes bold trigger names', () => {
    expect(tokenize('{WILD} <b>Pierce</b>: change a result.')).toEqual([
      { kind: 'symbol', key: 'wild' },
      { kind: 'text', value: ' ' },
      { kind: 'bold', value: 'Pierce' },
      { kind: 'text', value: ': change a result.' },
    ]);
  });

  it('surfaces unknown glyphs instead of swallowing them', () => {
    // The corpus will always be partly wrong; a bad glyph must not blank a card.
    expect(tokenize('{Zzz} happens')).toEqual([
      { kind: 'unknown', value: 'Zzz' },
      { kind: 'text', value: ' happens' },
    ]);
  });

  it('handles text with no markup', () => {
    expect(tokenize('Plain text.')).toEqual([{ kind: 'text', value: 'Plain text.' }]);
  });

  it('flattens to prose for search and alt text', () => {
    expect(toPlainText('Deals {PHYS} within {RNG} 3.')).toBe('Deals Physical within Range 3.');
  });
});

describe('source spelling differences', () => {
  // The legacy corpus was hand-entered with short glyphs; BSData uses long
  // ones. Both are in the corpus at once, so both must resolve to one identity
  // — otherwise half the cards render with unknown-symbol errors.
  it.each([
    ['{P}', '{PWR}', 'power'],
    ['{D}', '{DMG}', 'damage'],
    ['{R}', '{RNG}', 'range'],
    ['{C}', '{CRIT}', 'critical'],
    ['{W}', '{WILD}', 'wild'],
    ['{B}', '{BLOCK}', 'block'],
    ['{Ph}', '{PHYS}', 'physical'],
    ['{En}', '{ENRG}', 'energy'],
    ['{My}', '{MYST}', 'mystic'],
  ])('%s and %s both mean %s', (short, long, key) => {
    expect(tokenize(short)).toEqual([{ kind: 'symbol', key }]);
    expect(tokenize(long)).toEqual([{ kind: 'symbol', key }]);
  });

  it('is case-insensitive — the corpus contains a stray {pwr}', () => {
    expect(tokenize('{pwr}')).toEqual([{ kind: 'symbol', key: 'power' }]);
  });

  // {M} is a movement template, not mystic. Getting this backwards would
  // silently mistranslate every "advance {M}" in the corpus.
  it('reads {M} as Medium movement, not Mystic', () => {
    expect(tokenize('advance {M}')).toEqual([
      { kind: 'text', value: 'advance ' },
      { kind: 'symbol', key: 'medium' },
    ]);
    expect(tokenize('{MYST}')).toEqual([{ kind: 'symbol', key: 'mystic' }]);
  });
});

describe('unknownSymbols', () => {
  it('lists every unrecognized glyph', () => {
    expect(unknownSymbols('{PWR} then {Zzz} and {Qqq}')).toEqual(['Zzz', 'Qqq']);
  });

  it('is empty for fully-understood text', () => {
    expect(unknownSymbols('{PWR} {DMG} {RNG} {S} {M} {L}')).toEqual([]);
  });
});
