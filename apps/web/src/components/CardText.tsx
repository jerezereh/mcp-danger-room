/**
 * Card rules text.
 *
 * MCP text is unreadable as raw strings — `gains {P} equal to the {D} dealt`
 * only works once the glyphs are glyphs. The tokenizer lives in the data
 * package; this component is only concerned with how a token looks.
 *
 * The glyphs are the real icons, cut from card scans by
 * `packages/data/scripts/build-symbol-key.py` — the same crops the OCR
 * extractor is shown as its key. Unicode lookalikes stood in for a while and
 * were never right: there is no character for the Threat disc or the Wild
 * coil, and the nearest ones (✳, ✷) are exactly the confusion the extractor
 * kept making.
 *
 * Unknown glyphs render visibly wrong on purpose. A corpus assembled by hand
 * over months will always have gaps, and a gap you can see gets fixed.
 */

import { tokenize, SYMBOL_LABELS, type SymbolKey } from '@danger-room/data';

/*
 * One PNG per symbol, resolved at build time.
 *
 * Eager so there is no per-icon request waterfall — 20 files at a few KB each
 * is smaller than the round trips would cost, and card text is dense with
 * them.
 */
const GLYPHS = import.meta.glob<string>('../assets/symbols/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const glyphUrl = (key: SymbolKey): string | undefined =>
  GLYPHS[`../assets/symbols/${key}.png`];

/**
 * Blank is the one die result with no icon — the cards print the word, so the
 * app does too. Anything else without an image would be a build problem, and
 * falls back to its label rather than rendering an empty box.
 */
function Glyph({ symbolKey }: { symbolKey: SymbolKey }) {
  const label = SYMBOL_LABELS[symbolKey];
  const url = glyphUrl(symbolKey);

  if (!url) {
    return (
      <span
        title={label}
        className="mx-0.5 inline-flex h-5 items-center rounded bg-slate-700/40 px-1 align-middle text-xs font-semibold text-slate-300"
      >
        {label}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={label}
      title={label}
      // Sized in em so the icons track the surrounding text rather than
      // needing a variant per context.
      className="mx-0.5 inline-block h-[1.2em] w-[1.2em] rounded-[2px] align-text-bottom"
    />
  );
}

export function CardText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p className={`text-sm leading-relaxed text-slate-300 ${className}`}>
      {tokenize(text).map((token, i) => {
        switch (token.kind) {
          case 'text':
            return <span key={i}>{token.value}</span>;
          case 'bold':
            return (
              <strong key={i} className="font-semibold text-slate-100">
                {token.value}
              </strong>
            );
          case 'symbol':
            return <Glyph key={i} symbolKey={token.key} />;
          case 'unknown':
            return (
              <span
                key={i}
                title="Unrecognized glyph — the corpus has a gap here"
                className="mx-0.5 rounded bg-rose-500/20 px-1 text-xs text-rose-300"
              >
                {`{${token.value}}`}
              </span>
            );
        }
      })}
    </p>
  );
}
