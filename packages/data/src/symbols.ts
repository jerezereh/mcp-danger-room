/**
 * The symbol vocabulary.
 *
 * MCP card text is dense with inline glyphs — `{Ph}` for physical damage, `{R}`
 * for range, `{P}` for power. The prototype stored these raw and rendered them
 * as literal braces. Parsing them into tokens here means the React client can
 * render an icon, the AI can read the semantics, and a plain-text export can
 * substitute words — all from one source.
 */

export type SymbolKey =
  | 'Ph'
  | 'En'
  | 'My'
  | 'P'
  | 'D'
  | 'R'
  | 'S'
  | 'M'
  | 'L'
  | 'C'
  | 'W'
  | 'B'
  | 'A';

export const SYMBOL_LABELS: Readonly<Record<SymbolKey, string>> = {
  Ph: 'Physical',
  En: 'Energy',
  My: 'Mystic',
  P: 'Power',
  D: 'Damage',
  R: 'Range',
  S: 'Short',
  M: 'Medium',
  L: 'Long',
  C: 'Critical',
  W: 'Wild',
  B: 'Block',
  A: 'Blank',
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
      tokens.push(
        symbol in SYMBOL_LABELS
          ? { kind: 'symbol', key: symbol as SymbolKey }
          : { kind: 'unknown', value: symbol },
      );
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
