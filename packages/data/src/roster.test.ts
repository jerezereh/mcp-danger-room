import { describe, expect, it } from 'vitest';

import {
  enumerateSquads,
  indexCharacters,
  validateRoster,
  validateSquad,
  type Roster,
} from './roster.js';
import type { Character } from './schema.js';

const stub = (id: string, cp: number, threat: number): Character =>
  ({
    id,
    name: id,
    alterEgo: null,
    affiliations: [],
    cp,
    threat,
    baseMm: 40,
    source: 'manual',
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

const lookup = indexCharacters([stub('a', 40, 3), stub('b', 50, 4), stub('c', 30, 2)]);

const roster: Roster = { id: 'r1', name: 'Test', characterIds: ['a', 'b', 'c'] };

describe('roster validation', () => {
  it('accepts a roster within budget', () => {
    const result = validateRoster(roster, lookup, 200);
    expect(result.valid).toBe(true);
    expect(result.totals.cp).toBe(120);
  });

  it('flags going over the CP budget', () => {
    const result = validateRoster(roster, lookup, 100);
    expect(result.valid).toBe(false);
    expect(result.violations.map(v => v.code)).toContain('OVER_CP_BUDGET');
  });

  it('flags duplicates', () => {
    const dupes: Roster = { ...roster, characterIds: ['a', 'a'] };
    expect(validateRoster(dupes, lookup, 500).violations.map(v => v.code)).toContain(
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
