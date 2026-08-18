import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYMBOL_LABELS, type SymbolKey } from '@danger-room/data';
import { describe, expect, it } from 'vitest';

/*
 * The glyph files are looked up by SymbolKey, so their names have to be
 * SymbolKeys.
 *
 * They were named after the printed token instead — `pwr.png` for `power`,
 * `dmg.png` for `damage` — which differs for half the vocabulary. The lookup
 * missed, the component fell back to rendering the label as text, and ten of
 * nineteen icons were quietly absent from the app. Nothing failed: a fallback
 * that works is the hardest kind of bug to see.
 */
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/symbols');

const files = new Set(
  readdirSync(DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => f.replace(/\.png$/, '')),
);

// Blank is the one result with no icon; the app prints the word, as cards do.
const EXPECTED = (Object.keys(SYMBOL_LABELS) as SymbolKey[]).filter(k => k !== 'blank');

describe('symbol glyph files', () => {
  it.each(EXPECTED)('has a glyph named after the %s key', key => {
    expect(files.has(key)).toBe(true);
  });

  /*
   * Icons the cards print but the tokenizer has no token for, because they
   * never appear inline: the stat box's stamina and movement, the attack bar's
   * strength, and the Leadership star. The app draws them; card text cannot
   * contain them.
   */
  const CARD_ONLY = ['leadership', 'stamina', 'movement', 'strength'];

  it('has no glyph that is neither a symbol key nor a card-only icon', () => {
    const allowed: string[] = [...EXPECTED, ...CARD_ONLY];
    expect([...files].filter(f => !allowed.includes(f))).toEqual([]);
  });

  it('has every card-only icon the card layout draws', () => {
    for (const name of CARD_ONLY) expect(files.has(name), name).toBe(true);
  });

  it('covers every symbol the tokenizer can produce, except Blank', () => {
    expect(EXPECTED.length).toBe(Object.keys(SYMBOL_LABELS).length - 1);
  });
});
