import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROSTER_SIZE,
  enumerateSquads,
  indexCharacters,
  validateRoster,
  validateSquad,
  type Roster,
} from './roster.js';
import type { Character } from './schema.js';

const stub = (id: string, threat: number, maxCopies = 1): Character =>
  ({
    id,
    name: id,
    alterEgo: null,
    affiliations: [],
    packCode: null,
    packName: null,
    errata: null,
    threat,
    baseMm: 40,
    maxCopies,
    sources: ['manual'],
    forms: [],
    verified: false,
    healthy: {
      cardImage: null,
      stamina: 5,
      movement: 'M',
      size: 2,
      defense: { physical: 3, energy: 3, mystic: 3 },
      attacks: [],
      superpowers: [],
    },
    injured: {
      cardImage: null,
      stamina: 5,
      movement: 'M',
      size: 2,
      defense: { physical: 3, energy: 3, mystic: 3 },
      attacks: [],
      superpowers: [],
    },
  }) satisfies Character;

/** `twin` stands in for Prime Sentinel and Sentinel MK4: two copies allowed. */
const lookup = indexCharacters([stub('a', 3), stub('b', 4), stub('c', 2), stub('twin', 3, 2)]);

const roster: Roster = { id: 'r1', name: 'Test', characterIds: ['a', 'b', 'c'] };

describe('roster validation', () => {
  it('accepts a roster within the size limit', () => {
    const result = validateRoster(roster, lookup);
    expect(result.valid).toBe(true);
    expect(result.totals.threat).toBe(9);
  });

  // Regression: this module used to validate rosters against a "Character
  // Points" budget. That is not a rule in this game — the number it read was a
  // product pack identifier. Threat is the only character cost.
  it('reports threat and nothing else as a total', () => {
    const result = validateRoster(roster, lookup);
    expect(Object.keys(result.totals)).toEqual(['threat']);
  });

  it('never rejects a roster for its total threat', () => {
    const huge: Roster = { ...roster, characterIds: ['a', 'b', 'c'] };
    const result = validateRoster(huge, lookup, null);
    expect(result.valid).toBe(true);
  });

  it('flags a roster over the size limit', () => {
    const ids = Array.from({ length: DEFAULT_ROSTER_SIZE + 1 }, (_, i) =>
      i === 0 ? 'a' : `x${i}`,
    );
    const result = validateRoster({ ...roster, characterIds: ids }, lookup);
    expect(result.violations.map(v => v.code)).toContain('ROSTER_TOO_LARGE');
  });

  it('allows an unbounded roster when maxSize is null', () => {
    const ids = Array.from({ length: 30 }, (_, i) => (i === 0 ? 'a' : `x${i}`));
    const result = validateRoster({ ...roster, characterIds: ids }, lookup, null);
    expect(result.violations.map(v => v.code)).not.toContain('ROSTER_TOO_LARGE');
  });

  it('flags a second copy of an ordinary character', () => {
    const dupes: Roster = { ...roster, characterIds: ['a', 'a'] };
    expect(validateRoster(dupes, lookup).violations.map(v => v.code)).toContain('TOO_MANY_COPIES');
  });

  it('allows two of a character whose card says it may be taken twice', () => {
    // Prime Sentinel and Sentinel MK4 print this in identical words: "When
    // building a Roster or a Squad, a player may include 2 of this character
    // instead of the normal 1." Both were unfieldable as designed before this.
    const twins: Roster = { ...roster, characterIds: ['twin', 'twin'] };
    expect(validateRoster(twins, lookup).valid).toBe(true);
  });

  it('still stops at the third copy, and says what the limit is', () => {
    const three: Roster = { ...roster, characterIds: ['twin', 'twin', 'twin'] };
    const violations = validateRoster(three, lookup).violations;

    // Once, on the copy that broke the limit — not once per copy after the
    // first, which would read as two separate problems.
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('TOO_MANY_COPIES');
    expect(violations[0]?.message).toContain('only 2 are allowed');
  });

  it('counts a second copy against the roster size', () => {
    // "Include 2 of this character" reads as two of the ten slots, not one
    // slot holding two. Both copies are listed, and the size check counts
    // entries.
    const ids = [
      'twin',
      'twin',
      ...Array.from({ length: DEFAULT_ROSTER_SIZE - 1 }, (_, i) => `x${i}`),
    ];
    const result = validateRoster({ ...roster, characterIds: ids }, lookup);
    expect(result.violations.map(v => v.code)).toContain('ROSTER_TOO_LARGE');
  });
});

describe('squad validation', () => {
  it('rejects a squad over the threat limit', () => {
    const result = validateSquad(
      { rosterId: 'r1', characterIds: ['a', 'b'], threatLimit: 5 },
      roster,
      lookup,
    );
    expect(result.valid).toBe(false);
    expect(result.violations.map(v => v.code)).toContain('OVER_THREAT_LIMIT');
  });

  it('rejects a character not in the roster', () => {
    const result = validateSquad(
      { rosterId: 'r1', characterIds: ['a'], threatLimit: 10 },
      { ...roster, characterIds: ['b'] },
      lookup,
    );
    expect(result.violations.map(v => v.code)).toContain('NOT_IN_ROSTER');
  });

  it('rejects a second copy of an ordinary character', () => {
    const result = validateSquad(
      { rosterId: 'r1', characterIds: ['a', 'a'], threatLimit: 20 },
      roster,
      lookup,
    );
    expect(result.violations.map(v => v.code)).toContain('TOO_MANY_COPIES');
  });

  it('allows two of a character whose card allows two', () => {
    // The wording is "a Roster **or** a Squad" — it lifts both limits, so a
    // squad-side check that still refused the second copy would leave these
    // two characters exactly as unplayable as before.
    const result = validateSquad(
      { rosterId: 'r1', characterIds: ['twin', 'twin'], threatLimit: 20 },
      { ...roster, characterIds: ['twin', 'twin'] },
      lookup,
    );
    expect(result.valid).toBe(true);
    // Threat sums per copy: two 3-Threat characters cost 6.
    expect(result.totals.threat).toBe(6);
  });
});

describe('squad enumeration', () => {
  it('lists every legal squad within the threat limit', () => {
    const squads = enumerateSquads(roster, lookup, 5);
    // a(3) b(4) c(2) → a, b, c, a+c  (a+b=7 and b+c=6 both exceed 5)
    expect(squads.map(s => s.sort().join('+')).sort()).toEqual(['a', 'a+c', 'b', 'c']);
  });

  it('returns nothing when the limit affords no one', () => {
    expect(enumerateSquads(roster, lookup, 1)).toEqual([]);
  });

  it('offers the second copy of a character that allows one', () => {
    // Before this, the search walked each roster entry once and could never
    // produce a squad with two of anybody — so the allowance was unreachable
    // even for a roster that legally held both copies.
    const twins: Roster = { id: 'r2', name: 'Twins', characterIds: ['twin', 'twin'] };
    const squads = enumerateSquads(twins, lookup, 6)
      .map(s => s.join('+'))
      .sort();
    expect(squads).toEqual(['twin', 'twin+twin']);
  });

  it('never fields more copies than the roster actually holds', () => {
    // The allowance is a ceiling, not a supply. A roster with one Prime
    // Sentinel fields one, however many the card permits.
    const single: Roster = { id: 'r3', name: 'One', characterIds: ['twin'] };
    expect(enumerateSquads(single, lookup, 20)).toEqual([['twin']]);
  });

  it('does not double-count a duplicate entry as two independent choices', () => {
    // Regression: walking the raw id list took each entry as its own yes/no,
    // so a roster listing the same character twice could emit a squad of four.
    const twins: Roster = { id: 'r4', name: 'Twins', characterIds: ['twin', 'twin'] };
    for (const squad of enumerateSquads(twins, lookup, 100)) {
      expect(squad.length).toBeLessThanOrEqual(2);
    }
  });
});
