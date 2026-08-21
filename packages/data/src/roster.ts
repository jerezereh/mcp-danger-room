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
    /**
     * Renamed from `DUPLICATE_CHARACTER`. The limit is no longer always one —
     * Prime Sentinel and Sentinel MK4 allow two — so "duplicate" described the
     * violation only by accident, and would have been a lie about the two
     * characters the rule exists for.
     */
    | 'TOO_MANY_COPIES'
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

/** How many times each id appears. */
function countById(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/**
 * Says the limit rather than saying "again".
 *
 * "Appears more than once" was accurate while every limit was one. It stops
 * being a useful sentence the moment a character may legally appear twice: a
 * player who took three Prime Sentinels needs to be told the number, not told
 * that they repeated themselves.
 *
 * `limit` is passed in rather than read off the character because in a squad it
 * is not always the card's number — a roster holding one Prime Sentinel fields
 * one, and being told "only 2 are allowed" while being refused a second is a
 * worse answer than no answer. `becauseOfRoster` says which constraint bound.
 */
function tooManyCopies(
  character: Character,
  where: 'roster' | 'squad',
  limit: number,
  becauseOfRoster = false,
): Violation {
  const allowed = limit === 1 ? 'only 1 is allowed' : `only ${limit} are allowed`;
  const why = becauseOfRoster ? ', which is all the roster holds' : '';
  return {
    code: 'TOO_MANY_COPIES',
    message: `${character.name} appears too many times in the ${where} — ${allowed}${why}.`,
  };
}

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
  const copies = new Map<string, number>();
  let threat = 0;

  for (const id of roster.characterIds) {
    const character = lookup.get(id);
    if (!character) {
      violations.push({ code: 'UNKNOWN_CHARACTER', message: `Unknown character "${id}".` });
      continue;
    }

    const taken = (copies.get(id) ?? 0) + 1;
    copies.set(id, taken);
    // Reported once, on the copy that breaks the limit, rather than on every
    // copy after the first — otherwise taking four of a character reads as
    // three separate problems.
    if (taken === character.maxCopies + 1) {
      violations.push(tooManyCopies(character, 'roster', character.maxCopies));
    }
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
  // Counts, not membership. A squad is drawn *from* the roster, so how many of
  // a character the roster holds is a supply the squad cannot exceed — and for
  // the two characters whose cards allow a second copy, a set could not tell
  // one Prime Sentinel from two.
  const held = countById(roster.characterIds);
  const copies = new Map<string, number>();
  let threat = 0;

  for (const id of squad.characterIds) {
    const character = lookup.get(id);
    if (!character) {
      violations.push({ code: 'UNKNOWN_CHARACTER', message: `Unknown character "${id}".` });
      continue;
    }

    const available = held.get(id) ?? 0;
    if (available === 0) {
      violations.push({
        code: 'NOT_IN_ROSTER',
        message: `${character.name} is not in this roster.`,
      });
    }

    const taken = (copies.get(id) ?? 0) + 1;
    copies.set(id, taken);

    // The ceiling is the smaller of what the roster holds and what the card
    // allows. `enumerateSquads` has always applied both; this applied only the
    // card's, so a squad it would never have generated still validated.
    // Skipped entirely when the character is absent from the roster, since
    // NOT_IN_ROSTER has already said so and a second complaint adds nothing.
    const limit = Math.min(available, character.maxCopies);
    if (available > 0 && taken === limit + 1) {
      violations.push(tooManyCopies(character, 'squad', limit, limit < character.maxCopies));
    }
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
 * which are dead weight.
 *
 * The roster is grouped by character first rather than walked entry by entry.
 * A roster may legitimately list the same character twice — that is the whole
 * point of `maxCopies` — and walking the raw list would take each entry as an
 * independent yes/no, so two Prime Sentinels in the roster could produce a
 * squad of four. How many are actually available is the smaller of what the
 * roster holds and what the character allows.
 *
 * Exponential in the number of distinct characters, but rosters are ~10 and
 * only two characters in the corpus branch three ways instead of two, so the
 * worst case is a rounding error either way.
 */
export function enumerateSquads(roster: Roster, lookup: Lookup, threatLimit: number): string[][] {
  const grouped = new Map<string, { character: Character; held: number }>();
  for (const id of roster.characterIds) {
    const character = lookup.get(id);
    if (!character) continue;
    const entry = grouped.get(id);
    if (entry) entry.held += 1;
    else grouped.set(id, { character, held: 1 });
  }

  const slots = [...grouped.values()].map(({ character, held }) => ({
    character,
    max: Math.min(held, character.maxCopies),
  }));

  const results: string[][] = [];

  const walk = (index: number, chosen: string[], threat: number): void => {
    if (threat > threatLimit) return;
    if (index === slots.length) {
      if (chosen.length > 0) results.push([...chosen]);
      return;
    }
    const slot = slots[index];
    if (!slot) return;

    // Take none, then one, then two — pushing one more copy each time round
    // rather than rebuilding the list, and unwinding all of them at the end.
    // Threat sums per copy, so two of a 3-Threat character costs 6 and the
    // limit check above needs no special case.
    walk(index + 1, chosen, threat);
    for (let taken = 1; taken <= slot.max; taken++) {
      chosen.push(slot.character.id);
      walk(index + 1, chosen, threat + slot.character.threat * taken);
    }
    for (let taken = 1; taken <= slot.max; taken++) chosen.pop();
  };

  walk(0, [], 0);
  return results;
}
