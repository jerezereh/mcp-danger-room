/**
 * Roster and squad rules.
 *
 * MCP squad building is two-tier and this distinction is the whole point of the
 * "playtest loadouts" feature:
 *
 *   Roster — a pool of characters bought with Character Points (CP). Built once,
 *            reused across games.
 *   Squad  — the characters actually fielded for a given game, drawn from the
 *            roster and constrained by the Threat value the crisis cards set.
 *
 * A good loadout is one where a single roster produces strong squads across the
 * crisis cards you expect to face. That is a question this module can answer
 * and no amount of board rendering can.
 *
 * TODO(verify): CP budget, squad size limits, and leadership restrictions are
 * placeholders pending a rulebook pass.
 */

import type { Character } from './schema.js';

/** TODO(verify): standard roster budget in Character Points. */
export const DEFAULT_CP_BUDGET = 100;

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
    | 'OVER_CP_BUDGET'
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
  readonly totals: { readonly cp: number; readonly threat: number };
}

type Lookup = ReadonlyMap<string, Character>;

export function indexCharacters(characters: readonly Character[]): Lookup {
  return new Map(characters.map(c => [c.id, c]));
}

export function validateRoster(
  roster: Roster,
  lookup: Lookup,
  cpBudget = DEFAULT_CP_BUDGET,
): Validation {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  let cp = 0;
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
    cp += character.cp;
    threat += character.threat;
  }

  if (cp > cpBudget) {
    violations.push({
      code: 'OVER_CP_BUDGET',
      message: `Roster costs ${cp} CP but the budget is ${cpBudget}.`,
    });
  }

  return { valid: violations.length === 0, violations, totals: { cp, threat } };
}

export function validateSquad(squad: Squad, roster: Roster, lookup: Lookup): Validation {
  const violations: Violation[] = [];
  const inRoster = new Set(roster.characterIds);
  const seen = new Set<string>();
  let cp = 0;
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
    cp += character.cp;
    threat += character.threat;
  }

  if (threat > squad.threatLimit) {
    violations.push({
      code: 'OVER_THREAT_LIMIT',
      message: `Squad is ${threat} Threat but the limit is ${squad.threatLimit}.`,
    });
  }

  return { valid: violations.length === 0, violations, totals: { cp, threat } };
}

/**
 * Every legal squad this roster can field at a given threat limit.
 *
 * This is the loadout-analysis primitive: run it across the crisis cards in
 * rotation and you can see which roster slots actually earn their CP and which
 * are dead weight. Exponential in roster size, but rosters are ~10 characters,
 * so 2^10 is nothing.
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
