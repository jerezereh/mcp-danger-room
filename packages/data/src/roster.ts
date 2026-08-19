/**
 * Roster and squad rules.
 *
 * MCP squad building is two-tier, and this distinction is the point of the
 * "playtest loadouts" feature:
 *
 *   Roster — a pool of characters. Built once, reused across games.
 *   Squad  — the characters actually fielded for a given game, drawn from the
 *            roster and constrained by the Threat the crisis cards set.
 *
 * **Threat is the only character cost in this game.** An earlier version of
 * this module also validated rosters against a "Character Points" budget,
 * which is not a rule — the number it was reading is a product pack
 * identifier, not a cost. Nothing here should reintroduce a second currency.
 *
 * A good loadout is one where a single roster produces strong squads across
 * the crisis cards you expect to face. That is a question this module can
 * answer and no amount of board rendering can.
 */

import type { Character } from './schema.js';

/**
 * Characters in a tournament roster.
 *
 * TODO(verify): 10 is the commonly cited organised-play size, unchecked
 * against the current rules pack. Pass `null` for casual/unbounded rosters.
 */
export const DEFAULT_ROSTER_SIZE = 10;

export interface Roster {
  readonly id: string;
  readonly name: string;
  readonly characterIds: readonly string[];
}

export interface Squad {
  readonly rosterId: string;
  readonly characterIds: readonly string[];
  /** Threat limit imposed by the selected crisis cards. */
  readonly threatLimit: number;
}

export interface Violation {
  readonly code:
    | 'ROSTER_TOO_LARGE'
    | 'OVER_THREAT_LIMIT'
    | 'DUPLICATE_CHARACTER'
    | 'NOT_IN_ROSTER'
    | 'UNKNOWN_CHARACTER'
    | 'NO_LEADER';
  readonly message: string;
}

export interface Validation {
  readonly valid: boolean;
  readonly violations: readonly Violation[];
  /** Threat only. There is no second currency. */
  readonly totals: { readonly threat: number };
}

type Lookup = ReadonlyMap<string, Character>;

export function indexCharacters(characters: readonly Character[]): Lookup {
  return new Map(characters.map(c => [c.id, c]));
}

/**
 * A roster is a pool, not a purchase. The only things that can be wrong with
 * it are unknown characters, duplicates, and (in organised play) its size.
 */
export function validateRoster(
  roster: Roster,
  lookup: Lookup,
  maxSize: number | null = DEFAULT_ROSTER_SIZE,
): Validation {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  let threat = 0;

  for (const id of roster.characterIds) {
    const character = lookup.get(id);
    if (!character) {
      violations.push({ code: 'UNKNOWN_CHARACTER', message: `Unknown character "${id}".` });
      continue;
    }
    if (seen.has(id)) {
      violations.push({
        code: 'DUPLICATE_CHARACTER',
        message: `${character.name} appears more than once in the roster.`,
      });
    }
    seen.add(id);
    threat += character.threat;
  }

  if (maxSize !== null && roster.characterIds.length > maxSize) {
    violations.push({
      code: 'ROSTER_TOO_LARGE',
      message: `Roster has ${roster.characterIds.length} characters; the limit is ${maxSize}.`,
    });
  }

  // Reported for information only — a roster's total threat is never a limit.
  return { valid: violations.length === 0, violations, totals: { threat } };
}

export function validateSquad(squad: Squad, roster: Roster, lookup: Lookup): Validation {
  const violations: Violation[] = [];
  const inRoster = new Set(roster.characterIds);
  const seen = new Set<string>();
  let threat = 0;

  for (const id of squad.characterIds) {
    const character = lookup.get(id);
    if (!character) {
      violations.push({ code: 'UNKNOWN_CHARACTER', message: `Unknown character "${id}".` });
      continue;
    }
    if (!inRoster.has(id)) {
      violations.push({
        code: 'NOT_IN_ROSTER',
        message: `${character.name} is not in this roster.`,
      });
    }
    if (seen.has(id)) {
      violations.push({
        code: 'DUPLICATE_CHARACTER',
        message: `${character.name} appears more than once in the squad.`,
      });
    }
    seen.add(id);
    threat += character.threat;
  }

  if (threat > squad.threatLimit) {
    violations.push({
      code: 'OVER_THREAT_LIMIT',
      message: `Squad is ${threat} Threat but the limit is ${squad.threatLimit}.`,
    });
  }

  return { valid: violations.length === 0, violations, totals: { threat } };
}

/**
 * Every legal squad this roster can field at a given threat limit.
 *
 * This is the loadout-analysis primitive: run it across the crisis cards in
 * rotation and you can see which roster slots actually earn their place and
 * which are dead weight. Exponential in roster size, but rosters are ~10
 * characters, so 2^10 is nothing.
 */
export function enumerateSquads(
  roster: Roster,
  lookup: Lookup,
  threatLimit: number,
): string[][] {
  const characters = roster.characterIds
    .map(id => lookup.get(id))
    .filter((c): c is Character => c !== undefined);

  const results: string[][] = [];

  const walk = (index: number, chosen: string[], threat: number): void => {
    if (threat > threatLimit) return;
    if (index === characters.length) {
      if (chosen.length > 0) results.push([...chosen]);
      return;
    }
    const character = characters[index];
    if (!character) return;

    walk(index + 1, chosen, threat);
    chosen.push(character.id);
    walk(index + 1, chosen, threat + character.threat);
    chosen.pop();
  };

  walk(0, [], 0);
  return results;
}
