/**
 * Card rules text.
 *
 * MCP text is unreadable as raw strings — `gains {P} equal to the {D} dealt`
 * only works once the glyphs are glyphs. The tokenizer lives in the data
 * package; this component is only concerned with how a token looks.
 *
 * Unknown glyphs render visibly wrong on purpose. A corpus assembled by hand
 * over months will always have gaps, and a gap you can see gets fixed.
 */

import { tokenize, SYMBOL_LABELS } from '@danger-room/data';

import { Glyph } from './Glyph.js';

export function CardText({
  text,
  className = '',
  bullet = false,
}: {
  text: string;
  className?: string;
  /** Attack rules text is bulleted on the card; superpower text is not. */
  bullet?: boolean;
}) {
  const body = tokenize(text).map((token, i) => {
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
        return <Glyph key={i} name={token.key} label={SYMBOL_LABELS[token.key]} />;
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
  });

  if (!bullet) return <p className={`text-sm leading-relaxed text-slate-300 ${className}`}>{body}</p>;

  return (
    <p className={`flex gap-1.5 text-sm leading-relaxed text-slate-300 ${className}`}>
      <span aria-hidden className="select-none text-slate-600">
        •
      </span>
      <span className="min-w-0">{body}</span>
    </p>
  );
}
