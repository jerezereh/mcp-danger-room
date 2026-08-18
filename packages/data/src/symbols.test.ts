import { describe, expect, it } from 'vitest';

import {
  linkBlankWord,
  SYMBOL_GLYPHS,
  SYMBOL_LABELS,
  tokenize,
  toPlainText,
  unknownSymbols,
  type SymbolKey,
} from './symbols.js';

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

/*
 * Threat and Size appear inline in rules text but had no token, so the
 * extractor wrote them five different ways across 41 cards — {SIZE}, {size},
 * and the bare words "Size" and "Threat". A word is not a glyph: it renders as
 * prose and cannot be restyled, searched, or read by the engine.
 */
describe('threat and size', () => {
  it('tokenizes the glyphs that had no token', () => {
    expect(tokenize('{THREAT}')).toEqual([{ kind: 'symbol', key: 'threat' }]);
    expect(tokenize('{SIZE}')).toEqual([{ kind: 'symbol', key: 'size' }]);
    // The extractor's own invented lowercase spelling.
    expect(tokenize('{size}')).toEqual([{ kind: 'symbol', key: 'size' }]);
  });

  it('renders them as words in plain text', () => {
    expect(toPlainText('a greater {THREAT} than')).toBe('a greater Threat than');
    expect(toPlainText('{SIZE} 4 or less')).toBe('Size 4 or less');
  });
});

describe('the glyph table', () => {
  it('describes every symbol', () => {
    // The prompt is generated from this table. A key with no visual
    // description is a glyph the extractor has to guess at.
    for (const key of Object.keys(SYMBOL_LABELS) as SymbolKey[]) {
      expect(SYMBOL_GLYPHS[key], key).toBeTruthy();
    }
  });

  it('calls the skull Failure, not Blank', () => {
    // Blank is a different die face and prints no glyph at all.
    expect(SYMBOL_LABELS.fail).toBe('Failure');
    expect(SYMBOL_GLYPHS.fail).toContain('skull');
  });

  it('keeps Threat and Power distinguishable', () => {
    // The pair the extractor confuses. Both radiate from a centre and both
    // have a dark dot there, so a description that leans on the centre
    // separates nothing — the outline is the only reliable tell.
    expect(SYMBOL_GLYPHS.power).toContain('spike');
    expect(SYMBOL_GLYPHS.threat).toContain('no spikes');
    expect(SYMBOL_GLYPHS.threat).toContain('circle');
    // Hit belongs to the same cluster and was transposed with Wild once the
    // other two were pinned down, so it has to say how its burst differs.
    expect(SYMBOL_GLYPHS.hit).toContain('uneven');
    expect(SYMBOL_GLYPHS.hit).toContain('small dark dot');
    expect(SYMBOL_GLYPHS.power).toContain('large round dark hole');
  });

  it('keeps Energy and Wild distinguishable', () => {
    // The other confusable pair: both are swirls, and colour is what separates
    // them. A description of either that omits its colour is not enough.
    // Colour cannot separate them inline — both are white on black in rules
    // text — so each description must name its construction.
    expect(SYMBOL_GLYPHS.energy).toContain('blades');
    expect(SYMBOL_GLYPHS.wild).toContain('single continuous coil');
  });
});

describe('unrecognized glyphs', () => {
  it('surfaces {UNKNOWN} rather than swallowing it', () => {
    // The prompt tells the extractor to emit this instead of dropping an icon
    // it cannot name, so it has to reach the data-quality worklist.
    expect(unknownSymbols('deals {UNKNOWN} damage')).toEqual(['UNKNOWN']);
  });
});


/*
 * Blank is the only die result with no printed icon, so sources spell it out.
 * It was previously aliased onto Failure, which conflated two different faces —
 * and 60 occurrences sat in the corpus as prose, invisible to the renderer and
 * to the engine.
 */
describe('the Blank die result', () => {
  it('is its own symbol, not an alias of Failure', () => {
    expect(tokenize('{BLANK}')).toEqual([{ kind: 'symbol', key: 'blank' }]);
    expect(tokenize('{FAIL}')).toEqual([{ kind: 'symbol', key: 'fail' }]);
    expect(SYMBOL_LABELS.blank).toBe('Blank');
  });

  it('links the spelled-out word', () => {
    expect(linkBlankWord('change 1 result to a Blank.')).toBe('change 1 result to a {BLANK}.');
  });

  it('leaves an already-linked token alone', () => {
    expect(linkBlankWord('a {BLANK} result')).toBe('a {BLANK} result');
  });

  it('does not touch the word inside a longer one', () => {
    expect(linkBlankWord('Blankets and blanking')).toBe('Blankets and blanking');
  });

  it('has no glyph description, because it has no glyph', () => {
    expect(SYMBOL_GLYPHS.blank).toContain('no icon');
  });
});
