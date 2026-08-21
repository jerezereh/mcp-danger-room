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

/**
 * Superpower text can be several lines, and some of those lines are bullets —
 * Elsa Bloodstone's Leadership offers three named effects. HTML collapses the
 * newlines, so those ran together into one paragraph. Each line is rendered
 * separately, and a line the card bullets keeps its bullet.
 */
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
  const lines = text.split('\n').filter(l => l.trim() !== '');
  if (lines.length > 1) {
    return (
      <div className={`space-y-1 ${className}`}>
        {lines.map((line, i) => {
          const marked = line.trimStart().startsWith('•');
          return (
            <CardText
              key={i}
              text={marked ? line.trimStart().replace(/^•\s*/, '') : line}
              bullet={marked || bullet}
            />
          );
        })}
      </div>
    );
  }

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
        /*
         * Blank has no icon. The token is kept in the data because the engine
         * needs to know a die result is meant, but the card prints the word,
         * so the card reads the word — a chip here would invent an icon the
         * printed card does not have.
         */
        return token.key === 'blank' ? (
          <span key={i}>{SYMBOL_LABELS.blank}</span>
        ) : (
          <Glyph key={i} name={token.key} label={SYMBOL_LABELS[token.key]} />
        );
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

  if (!bullet)
    return <p className={`text-sm leading-relaxed text-slate-300 ${className}`}>{body}</p>;

  return (
    <p className={`flex gap-1.5 text-sm leading-relaxed text-slate-300 ${className}`}>
      <span aria-hidden className="select-none text-slate-600">
        •
      </span>
      <span className="min-w-0">{body}</span>
    </p>
  );
}
