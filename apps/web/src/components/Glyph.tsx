/**
 * A card icon.
 *
 * The images are the real thing, cut from card scans by
 * `packages/data/scripts/build-symbol-key.py` — the same crops the OCR
 * extractor is shown as its key. Unicode lookalikes stood in for a while and
 * were never right: there is no character for the Threat disc or the Wild
 * coil, and the nearest ones (✳, ✷) are exactly the pair the extractor kept
 * confusing.
 *
 * Files are named after the identity, not the printed token — `power.png`, not
 * `pwr.png`. Ten of nineteen icons were silently absent when that was the
 * other way round, so `symbols.test.ts` asserts the naming.
 */

/*
 * Eager so there is no per-icon request waterfall: twenty-odd files of a few
 * KB each is smaller than the round trips, and card text is dense with them.
 */
const GLYPHS = import.meta.glob<string>('../assets/symbols/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const glyphUrl = (name: string): string | undefined =>
  GLYPHS[`../assets/symbols/${name}.png`];

/**
 * Falls back to the label when there is no image. That is correct for Blank,
 * which has no icon on the card either, and for anything else it keeps the
 * text readable rather than leaving a gap.
 */
export function Glyph({
  name,
  label,
  className = 'h-[1.2em] w-[1.2em]',
}: {
  name: string;
  label: string;
  className?: string;
}) {
  const url = glyphUrl(name);

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
      className={`inline-block rounded-[2px] align-text-bottom ${className}`}
    />
  );
}
