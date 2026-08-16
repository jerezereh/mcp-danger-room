import { describe, expect, it } from 'vitest';

import { tokenize, toPlainText } from './symbols.js';

describe('card text tokenizer', () => {
  it('splits symbols out of surrounding prose', () => {
    expect(tokenize('gains {P} equal to the {D} dealt.')).toEqual([
      { kind: 'text', value: 'gains ' },
      { kind: 'symbol', key: 'P' },
      { kind: 'text', value: ' equal to the ' },
      { kind: 'symbol', key: 'D' },
      { kind: 'text', value: ' dealt.' },
    ]);
  });

  it('recognizes bold trigger names', () => {
    expect(tokenize('{W} <b>Pierce</b>: change a result.')).toEqual([
      { kind: 'symbol', key: 'W' },
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
    expect(toPlainText('Deals {Ph} within {R} 3.')).toBe('Deals Physical within Range 3.');
  });
});
