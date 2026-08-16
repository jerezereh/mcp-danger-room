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

const stub = (id: string, threat: number): Character =>
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
    sources: ['manual'],
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

const lookup = indexCharacters([stub('a', 3), stub('b', 4), stub('c', 2)]);

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
    const ids = Array.from({ length: DEFAULT_ROSTER_SIZE + 1 }, (_, i) => (i === 0 ? 'a' : `x${i}`));
    const result = validateRoster({ ...roster, characterIds: ids }, lookup);
    expect(result.violations.map(v => v.code)).toContain('ROSTER_TOO_LARGE');
  });

  it('allows an unbounded roster when maxSize is null', () => {
    const ids = Array.from({ length: 30 }, (_, i) => (i === 0 ? 'a' : `x${i}`));
    const result = validateRoster({ ...roster, characterIds: ids }, lookup, null);
    expect(result.violations.map(v => v.code)).not.toContain('ROSTER_TOO_LARGE');
  });

  it('flags duplicates', () => {
    const dupes: Roster = { ...roster, characterIds: ['a', 'a'] };
    expect(validateRoster(dupes, lookup).violations.map(v => v.code)).toContain(
      'DUPLICATE_CHARACTER',
    );
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
});
