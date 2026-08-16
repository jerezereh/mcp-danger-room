/**
 * The symbol vocabulary.
 *
 * MCP card text is dense with inline glyphs — `{PWR}` for power, `{DMG}` for
 * damage, `{RNG}` for range. The prototype stored these raw and rendered them
 * as literal braces. Parsing them into tokens here means the React client can
 * render an icon, the AI can read the semantics, and a plain-text export can
 * substitute words — all from one source.
 *
 * Sources spell the same glyph differently: the hand-entered legacy corpus used
 * short forms (`{P}`, `{D}`, `{R}`), BSData uses long ones (`{PWR}`, `{DMG}`,
 * `{RNG}`). Rather than rewrite one corpus to match the other — which would
 * have to be redone for every future source — the aliases below normalize to a
 * canonical key at parse time. Matching is case-insensitive; the corpus
 * contains a stray `{pwr}`.
 */

/** Canonical glyph identities. Aliases below map onto these. */
export type SymbolKey =
  | 'physical'
  | 'energy'
  | 'mystic'
  | 'power'
  | 'damage'
  | 'range'
  | 'short'
  | 'medium'
  | 'long'
  | 'critical'
  | 'wild'
  | 'hit'
  | 'block'
  | 'fail'
  | 'active'
  | 'reactive'
  | 'innate';

export const SYMBOL_LABELS: Readonly<Record<SymbolKey, string>> = {
  physical: 'Physical',
  energy: 'Energy',
  mystic: 'Mystic',
  power: 'Power',
  damage: 'Damage',
  range: 'Range',
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
  critical: 'Critical',
  wild: 'Wild',
  hit: 'Hit',
  block: 'Block',
  fail: 'Blank',
  active: 'Active',
  reactive: 'Reactive',
  innate: 'Innate',
};

/**
 * Every spelling seen across the sources, lowercased.
 *
 * Note `{M}` is Medium (a movement template) rather than Mystic — mystic damage
 * is `{MYST}` or `{My}`. Getting that backwards would silently mistranslate
 * hundreds of movement effects.
 */
const ALIASES: Readonly<Record<string, SymbolKey>> = {
  ph: 'physical',
  phys: 'physical',
  physical: 'physical',
  en: 'energy',
  enrg: 'energy',
  e: 'energy',
  energy: 'energy',
  my: 'mystic',
  myst: 'mystic',
  mystic: 'mystic',
  p: 'power',
  pwr: 'power',
  power: 'power',
  d: 'damage',
  dmg: 'damage',
  damage: 'damage',
  r: 'range',
  rng: 'range',
  range: 'range',
  s: 'short',
  short: 'short',
  m: 'medium',
  medium: 'medium',
  l: 'long',
  long: 'long',
  c: 'critical',
  crit: 'critical',
  critical: 'critical',
  w: 'wild',
  wild: 'wild',
  hit: 'hit',
  b: 'block',
  block: 'block',
  a: 'fail',
  fail: 'fail',
  blank: 'fail',
  active: 'active',
  activated: 'active',
  reactive: 'reactive',
  react: 'reactive',
  reaction: 'reactive',
  innate: 'innate',
};

/** The canonical spelling to emit when writing new card text. */
export const CANONICAL_TOKENS: Readonly<Record<SymbolKey, string>> = {
  physical: '{PHYS}',
  energy: '{ENRG}',
  mystic: '{MYST}',
  power: '{PWR}',
  damage: '{DMG}',
  range: '{RNG}',
  short: '{S}',
  medium: '{M}',
  long: '{L}',
  critical: '{CRIT}',
  wild: '{WILD}',
  hit: '{HIT}',
  block: '{BLOCK}',
  fail: '{FAIL}',
  active: '{ACTIVE}',
  reactive: '{REACTIVE}',
  innate: '{INNATE}',
};

export type TextToken =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'symbol'; readonly key: SymbolKey }
  | { readonly kind: 'bold'; readonly value: string }
  /** An unrecognized `{...}` — surfaced rather than swallowed so gaps show up. */
  | { readonly kind: 'unknown'; readonly value: string };

const PATTERN = /\{([A-Za-z]+)\}|<b>(.*?)<\/b>/g;

/**
 * Tokenize card text into renderable parts.
 *
 * Deliberately tolerant: unknown braces become `unknown` tokens rather than
 * throwing, because the corpus will always be partly wrong and a bad glyph
 * should not blank out a card.
 */
export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ kind: 'text', value: text.slice(cursor, index) });
    }

    const [full, symbol, bold] = match;
    if (bold !== undefined) {
      tokens.push({ kind: 'bold', value: bold });
    } else if (symbol !== undefined) {
      const key = ALIASES[symbol.toLowerCase()];
      tokens.push(key ? { kind: 'symbol', key } : { kind: 'unknown', value: symbol });
    }
    cursor = index + full.length;
  }

  if (cursor < text.length) {
    tokens.push({ kind: 'text', value: text.slice(cursor) });
  }
  return tokens;
}

/** Flatten to plain prose — for search indexing, alt text, and AI prompts. */
export function toPlainText(text: string): string {
  return tokenize(text)
    .map(token => {
      switch (token.kind) {
        case 'text':
        case 'bold':
          return token.value;
        case 'symbol':
          return SYMBOL_LABELS[token.key];
        case 'unknown':
          return token.value;
      }
    })
    .join('');
}

/** Every unrecognized glyph in a body of text — the data-quality worklist. */
export function unknownSymbols(text: string): string[] {
  return tokenize(text)
    .filter((t): t is Extract<TextToken, { kind: 'unknown' }> => t.kind === 'unknown')
    .map(t => t.value);
}
