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

import { tokenize, SYMBOL_LABELS, type SymbolKey } from '@danger-room/data';

const SYMBOL_STYLES: Record<SymbolKey, string> = {
  Ph: 'bg-orange-500/20 text-orange-300',
  En: 'bg-sky-500/20 text-sky-300',
  My: 'bg-violet-500/20 text-violet-300',
  P: 'bg-amber-500/20 text-amber-300',
  D: 'bg-rose-500/20 text-rose-300',
  R: 'bg-slate-500/20 text-slate-300',
  S: 'bg-slate-500/20 text-slate-300',
  M: 'bg-slate-500/20 text-slate-300',
  L: 'bg-slate-500/20 text-slate-300',
  C: 'bg-yellow-500/20 text-yellow-300',
  W: 'bg-emerald-500/20 text-emerald-300',
  B: 'bg-blue-500/20 text-blue-300',
  A: 'bg-slate-700/40 text-slate-400',
};

const SYMBOL_GLYPHS: Partial<Record<SymbolKey, string>> = {
  Ph: '✊',
  En: '⚡',
  My: '✦',
  P: '◆',
  D: '✸',
  R: 'R',
  S: 'S',
  M: 'M',
  L: 'L',
  C: '★',
  W: '✷',
  B: '⛊',
  A: '○',
};

function Glyph({ symbolKey }: { symbolKey: SymbolKey }) {
  return (
    <span
      title={SYMBOL_LABELS[symbolKey]}
      className={`mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 align-middle text-xs font-semibold ${SYMBOL_STYLES[symbolKey]}`}
    >
      {SYMBOL_GLYPHS[symbolKey] ?? symbolKey}
    </span>
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
                title="Unrecognized symbol — needs adding to the vocabulary"
                className="mx-0.5 rounded bg-red-500/20 px-1 text-xs text-red-300"
              >
                ?{token.value}
              </span>
            );
        }
      })}
    </p>
  );
}
