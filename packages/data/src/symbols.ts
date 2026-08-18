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
  | 'innate'
  | 'threat'
  | 'size';

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
  // The skull face. Distinct from Blank, which is a separate die result that
  // prints no glyph at all — labelling this one "Blank" conflated the two.
  fail: 'Failure',
  active: 'Active',
  reactive: 'Reactive',
  innate: 'Innate',
  threat: 'Threat',
  size: 'Size',
};

/**
 * What each glyph looks like on the card.
 *
 * Written for the vision extractor, which sees pictures and has to name them.
 * Without this it was told `{CRIT} = Critical` and left to work out which of
 * several small black-on-white icons that was — and it said so, on 34 of 41
 * cards. Where two glyphs are easy to confuse the description says how they
 * differ rather than describing each in isolation.
 */
export const SYMBOL_GLYPHS: Readonly<Record<SymbolKey, string>> = {
  physical: 'a red clenched fist',
  // Energy and Wild are both swirls and are the other confusable pair. They
  // differ in colour and in construction, so the description gives both.
  energy: 'a yellow-and-black swirl, symmetric about its centre',
  mystic: 'a blue eye',
  power: 'a star with long, even, sharply pointed spikes and a large round dark hole at its centre',
  damage: 'three slightly curved parallel lines',
  range: 'a target or crosshair',
  short: 'a distance template marked S',
  medium: 'a distance template marked M',
  long: 'a distance template marked L',
  critical: 'an exclamation mark with jagged lines around it',
  wild: 'a white-and-black spiral winding out from its centre — never yellow',
  hit: 'a jagged, uneven impact burst with a small dark dot at its centre',
  block: 'a shield with a spot on it',
  fail: 'a skull',
  active: 'four arrows pointing outward from a centre',
  reactive: 'a pair of lightning bolts',
  innate: 'an infinity sign',
  // Power, Threat and Hit are one confusable cluster: all three radiate from a
  // centre and all three have something dark at that centre, so the centre
  // separates nothing. The outline does. Power has long even spikes, Hit is an
  // uneven burst, Threat has no spikes at all.
  threat: 'a smooth circle with no spikes, cut into six segments by thin lines from a dot at its centre',
  size: 'an I-beam, the same icon the stat box uses for Size',
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
  failure: 'fail',
  // Legacy spelling. The Blank die face prints no glyph, so nothing inline can
  // legitimately mean it — a `{BLANK}` in the corpus is the skull.
  blank: 'fail',
  active: 'active',
  activated: 'active',
  reactive: 'reactive',
  react: 'reactive',
  reaction: 'reactive',
  innate: 'innate',
  threat: 'threat',
  t: 'threat',
  size: 'size',
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
  threat: '{THREAT}',
  size: '{SIZE}',
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
