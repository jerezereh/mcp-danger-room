/**
 * Display formatting.
 *
 * Character ids are kebab-case keys, not display text. The board and the panel
 * were formatting them differently — "Ancient One" on one and "ancient-one" on
 * the other — which reads like two different things rather than one.
 *
 * TODO(data): once every model resolves to a Character record, take the real
 * `name` field from @danger-room/data instead of prettifying the id. This is a
 * stopgap for ids that have no card behind them yet.
 */

export function characterName(id: string): string {
  return id
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Inches, to one decimal — the precision a physical range tool gives you. */
export const inches = (value: number): string => `${value.toFixed(1)}"`;

const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'] as const;

/**
 * Inches as the tools are printed: 3⅜", 5", 7¼".
 *
 * `inches()` rounds to a tenth, which is right for a measured gap and wrong
 * for a *named* quantity. The Short movement tool is 3.375" exactly; showing
 * it as 3.4" puts a number on the button that the engine will not honour, on
 * the more permissive side, which is the specific failure the measured
 * constants exist to end.
 *
 * Derived from the value rather than looked up per template, so it cannot
 * drift from `MOVEMENT_INCHES` the way a hand-written label would. Anything
 * that is not a whole eighth falls back to `inches()` — the tools are all
 * eighths, and a value that is not says more by looking unusual.
 */
export function toolInches(value: number): string {
  const eighths = Math.round(value * 8);
  if (value < 0 || Math.abs(value * 8 - eighths) > 1e-9) return inches(value);

  const whole = Math.trunc(eighths / 8);
  const fraction = EIGHTHS[eighths % 8];
  if (!fraction) return `${whole}"`;
  return whole === 0 ? `${fraction}"` : `${whole}${fraction}"`;
}
