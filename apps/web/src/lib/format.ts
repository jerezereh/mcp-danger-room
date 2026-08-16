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
