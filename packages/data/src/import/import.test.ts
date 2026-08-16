import { describe, expect, it } from 'vitest';

import { parsePack, toDraft } from './cerebro.js';
import type { CharacterDraft } from './draft.js';
import { finalize } from './draft.js';
import { mergeDrafts } from './merge.js';
import { qualifiedSlug, slugify, splitName } from './slug.js';
import {
  crossCheck,
  ExtractedCard as ExtractedCardSchema,
  parseStaminaErrata,
  type ExtractedCard,
} from './extraction.js';
import { characters } from '../characters.js';

describe('slug — the join key across sources', () => {
  // Cerebro says "Abomination"; BSData says "ABOMINATION (Emil Blonsky)".
  // These must land on the same key or the two sources never merge.
  it('ignores case, punctuation, and the alter ego', () => {
    expect(slugify('Abomination')).toBe('abomination');
    expect(slugify('ABOMINATION (Emil Blonsky)')).toBe('abomination');
    expect(slugify('Amazing Spider-Man')).toBe('amazing-spider-man');
    expect(slugify("Ant-Man")).toBe('ant-man');
    expect(slugify('M.O.D.O.K.')).toBe('modok');
  });

  it('keeps distinctly-named characters apart', () => {
    expect(slugify('Black Widow')).not.toBe(slugify('Black Widow, Agent of S.H.I.E.L.D.'));
    expect(slugify('Amazing Spider-Man')).not.toBe(slugify('Spider-Man'));
  });

  // The bare name is genuinely ambiguous in this game — both sources list two
  // "Captain America" and two "Spider-Man" records. Qualifying by alter ego is
  // what separates them; the merge applies it only inside a colliding group.
  it('cannot separate same-named characters on its own', () => {
    expect(slugify('CAPTAIN AMERICA (Steve Rogers)')).toBe(slugify('CAPTAIN AMERICA (Sam Wilson)'));
  });

  it('qualifies by alter ego when the name collides', () => {
    expect(qualifiedSlug('Captain America', 'Steve Rogers')).toBe('captain-america-steve-rogers');
    expect(qualifiedSlug('Captain America', 'Sam Wilson')).toBe('captain-america-sam-wilson');
    expect(qualifiedSlug('Captain America', 'Steve Rogers')).not.toBe(
      qualifiedSlug('Captain America', 'Sam Wilson'),
    );
  });

  it('leaves a character with no alter ego on its bare slug', () => {
    expect(qualifiedSlug('Abomination', null)).toBe('abomination');
  });

  it('splits a name from its parenthesised alter ego', () => {
    expect(splitName('ANGELA (Aldrif Odinsdottir)')).toEqual({
      name: 'ANGELA',
      alterEgo: 'Aldrif Odinsdottir',
    });
    expect(splitName('Abomination')).toEqual({ name: 'Abomination', alterEgo: null });
  });
});

describe('cerebro', () => {
  it('parses the pack field as an identifier, not a cost', () => {
    expect(parsePack('CP162: Abomination and Wrecking Crew')).toEqual({
      code: 'CP162',
      name: 'Abomination and Wrecking Crew',
    });
    expect(parsePack(undefined)).toEqual({ code: null, name: null });
  });

  it('drops the alias when it just repeats the name', () => {
    const draft = toDraft({ ID: 1, Name: 'Abomination', Alias: 'Abomination' });
    expect(draft.alterEgo).toBeNull();
  });

  it('keeps a real alter ego', () => {
    const draft = toDraft({ ID: 1, Name: 'Abomination', Alias: 'Emil Blonsky' });
    expect(draft.alterEgo).toBe('Emil Blonsky');
  });

  it('produces an incomplete draft — it has no rules text to give', () => {
    const draft = toDraft({
      ID: 1,
      Name: 'Abomination',
      Cost: 5,
      Affiliations: 'Criminal Syndicate, Hydra',
      front_health: 7,
    });
    expect(draft.threat).toBe(5);
    expect(draft.affiliations).toEqual(['Criminal Syndicate', 'Hydra']);
    expect(draft.healthy?.attacks).toBeUndefined();

    const finalized = finalize(draft, 'cerebro');
    expect(finalized.ok).toBe(false);
    if (finalized.ok) return;
    expect(finalized.missing).toContain('healthy.attacks');
  });
});

describe('merge precedence', () => {
  const cerebro: CharacterDraft = {
    id: 'angela',
    name: 'Angela',
    affiliations: ['A-Force', 'Asgard'],
    threat: 5,
    healthy: { cardImage: 'ANGELA_healthy.png', stamina: 7 },
    sources: ['cerebro'],
  };
  const bsdata: CharacterDraft = {
    id: 'angela',
    name: 'ANGELA',
    affiliations: ['A-Force', 'Asgard', 'Guardians of the Galaxy'],
    threat: 5,
    healthy: {
      stamina: 6,
      movement: 'L',
      size: 2,
      defense: { physical: 4, energy: 4, mystic: 4 },
      attacks: [],
      superpowers: [],
    },
    sources: ['bsdata'],
  };

  it('takes identity from Cerebro and rules data from BSData', () => {
    const { drafts } = mergeDrafts([cerebro], [bsdata]);
    const merged = drafts[0];

    expect(merged?.name).toBe('Angela'); // Cerebro's casing
    expect(merged?.healthy?.movement).toBe('L'); // BSData's rules data
    expect(merged?.healthy?.cardImage).toBe('ANGELA_healthy.png'); // only Cerebro has it
    expect(merged?.sources).toEqual(['cerebro', 'bsdata']);
  });

  it('does not report case-only name differences as conflicts', () => {
    // BSData uppercases every name. Reporting those would bury the real
    // disagreements under one conflict per character.
    const { conflicts } = mergeDrafts([cerebro], [bsdata]);
    expect(conflicts.filter(c => c.field === 'name')).toEqual([]);
  });

  /*
   * Stamina comes from Cerebro, because it tracks errata and BSData does not.
   * Ancient One is the worked example: printed 6/6, errata'd to 7/6. Cerebro
   * says 7 and carries "Stamina change 6/6 to 7/6"; BSData, frozen since 2024,
   * still says 6.
   */
  it('takes current (errata-aware) stamina from Cerebro', () => {
    const withErrata: CharacterDraft = { ...cerebro, errata: 'Stamina change 6/6 to 7/6' };
    const { drafts } = mergeDrafts([withErrata], [bsdata]); // cerebro 7, bsdata 6
    expect(drafts[0]?.healthy?.stamina).toBe(7);
  });

  it('does not flag a difference that a stamina errata explains', () => {
    const withErrata: CharacterDraft = { ...cerebro, errata: 'Stamina change 6/6 to 7/6' };
    const { conflicts } = mergeDrafts([withErrata], [bsdata]);
    expect(conflicts.filter(c => c.field.endsWith('stamina'))).toEqual([]);
  });

  it('flags a difference with no errata to explain it', () => {
    // No errata text: one of the two sources is simply wrong.
    const { conflicts } = mergeDrafts([cerebro], [bsdata]);
    const found = conflicts.find(c => c.field === 'healthy.stamina');

    expect(found).toBeDefined();
    expect(found?.values).toMatchObject({ cerebro: 7, bsdata: 6 });
  });

  it('ignores a Cerebro stamina of 0 — the single-sided-card sentinel', () => {
    // Hulk, Apocalypse and three others report back_health 0. Taken literally
    // it fails schema validation and drops the character from the corpus.
    const singleSided: CharacterDraft = {
      ...cerebro,
      injured: { cardImage: null, stamina: 0 },
    };
    const bsWithInjured: CharacterDraft = {
      ...bsdata,
      injured: { ...bsdata.healthy, stamina: 8 },
    };
    const { drafts } = mergeDrafts([singleSided], [bsWithInjured]);
    expect(drafts[0]?.injured?.stamina).toBe(8);
  });

  it('passes through characters present in only one source', () => {
    const { drafts, stats } = mergeDrafts(
      [cerebro, { id: 'bastion', name: 'Bastion', sources: ['cerebro'] }],
      [bsdata],
    );
    expect(drafts).toHaveLength(2);
    expect(stats.matched).toBe(1);
    expect(stats.onlyIn['cerebro']).toBe(1);
  });
});

describe('finalize', () => {
  const complete = (): CharacterDraft => ({
    id: 'x',
    name: 'X',
    threat: 4,
    healthy: {
      stamina: 6,
      movement: 'M',
      size: 2,
      defense: { physical: 3, energy: 3, mystic: 3 },
      attacks: [{ name: 'Punch', type: 'physical', range: 1, dice: 5, cost: 0, text: [] }],
      superpowers: [],
    },
    injured: {
      stamina: 6,
      movement: 'M',
      size: 2,
      defense: { physical: 3, energy: 3, mystic: 3 },
      attacks: [{ name: 'Punch', type: 'physical', range: 1, dice: 5, cost: 0, text: [] }],
      superpowers: [],
    },
    sources: ['bsdata'],
  });

  it('promotes a complete draft', () => {
    const result = finalize(complete(), 'bsdata');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.source).toBe('bsdata');
    // Nothing this pipeline produces has been checked against a printed card.
    expect(result.character.verified).toBe(false);
  });

  it('reports exactly which fields are missing rather than throwing', () => {
    const draft = complete();
    delete draft.healthy?.size;
    delete draft.threat;

    const result = finalize(draft, 'bsdata');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('threat');
    expect(result.missing).toContain('healthy.size');
  });

  it('treats an attackless character as incomplete, not valid', () => {
    const draft = complete();
    draft.healthy = { ...draft.healthy, attacks: [] };

    const result = finalize(draft, 'bsdata');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('healthy.attacks');
  });
});

describe('OCR cross-check', () => {
  const extracted = (over: Partial<ExtractedCard> = {}): ExtractedCard => ({
    name: 'Angela',
    alterEgo: null,
    affiliations: ['Asgard'],
    threat: 5,
    healthy: {
      stamina: 6,
      movement: 'L',
      size: 2,
      defense: { physical: 4, energy: 4, mystic: 4 },
      attacks: [],
      superpowers: [],
    },
    injured: {
      stamina: 7,
      movement: 'L',
      size: 2,
      defense: { physical: 4, energy: 4, mystic: 4 },
      attacks: [],
      superpowers: [],
    },
    legibility: 'clear',
    notes: '',
    ...over,
  });

  it('is silent when the model agrees with what we already know', () => {
    expect(
      crossCheck(extracted(), {
        name: 'Angela',
        threat: 5,
        affiliations: ['Asgard'],
        healthyStamina: 6,
      }),
    ).toEqual([]);
  });

  it('flags a misread stat with both values', () => {
    const found = crossCheck(extracted(), { threat: 4 });
    expect(found).toEqual([{ field: 'threat', extracted: 5, known: 4 }]);
  });

  it('ignores affiliation ordering but catches a genuine difference', () => {
    expect(
      crossCheck(extracted({ affiliations: ['Asgard', 'A-Force'] }), {
        affiliations: ['A-Force', 'Asgard'],
      }),
    ).toEqual([]);

    expect(crossCheck(extracted(), { affiliations: ['Cabal'] })).toHaveLength(1);
  });

  it('checks nothing it was given nothing for', () => {
    expect(crossCheck(extracted(), {})).toEqual([]);
  });
});

describe('extraction schema stays compatible with the corpus', () => {
  /*
   * The extraction contract is declared with `zod/v4` because the SDK's
   * JSON-Schema helper requires it, while the runtime schema stays on v3. That
   * means the attack and superpower shapes exist twice.
   *
   * This is the guard on that duplication: every character already in the
   * corpus must validate as an extraction. If the two definitions drift, model
   * output stops being mergeable into the corpus — and this fails before any
   * money is spent on a batch.
   */
  it('accepts every character already in the corpus', () => {
    const rejected: string[] = [];

    for (const c of characters) {
      const result = ExtractedCardSchema.safeParse({
        name: c.name,
        alterEgo: c.alterEgo,
        affiliations: c.affiliations,
        threat: c.threat,
        healthy: c.healthy,
        injured: c.injured,
        legibility: 'clear',
        notes: '',
      });
      if (!result.success) {
        rejected.push(`${c.id}: ${result.error.issues[0]?.path.join('.')}`);
      }
    }

    expect(rejected).toEqual([]);
  });

  it('rejects output that is missing a required field', () => {
    expect(ExtractedCardSchema.safeParse({ name: 'X' }).success).toBe(false);
  });
});

describe('errata-aware OCR cross-check', () => {
  const extracted = (h: number, i: number): ExtractedCard => ({
    name: 'Ancient One',
    alterEgo: null,
    affiliations: [],
    threat: 4,
    healthy: {
      stamina: h,
      movement: 'M',
      size: 2,
      defense: { physical: 2, energy: 3, mystic: 5 },
      attacks: [],
      superpowers: [],
    },
    injured: {
      stamina: i,
      movement: 'M',
      size: 2,
      defense: { physical: 2, energy: 3, mystic: 5 },
      attacks: [],
      superpowers: [],
    },
    legibility: 'clear',
    notes: '',
  });

  const ANCIENT_ONE = 'Stamina change 6/6 to 7/6';

  it('parses the printed and current values out of the errata', () => {
    expect(parseStaminaErrata(ANCIENT_ONE)).toEqual({ printed: [6, 6], current: [7, 6] });
  });

  it.each([
    ['Stamina changed 6/7 to 7/8. Blades of Ichor Pursuit changed to...', [6, 7], [7, 8]],
    ['Stamina Changed 5/5 to 6/6. Speed changed to Medium from Short.', [5, 5], [6, 6]],
    ['Stamina change 6/6 to 7/7.', [6, 6], [7, 7]],
    // Single-sided characters write one number, and She-Hulk mixes the forms
    // because errata gave her an injured side she did not previously have.
    ['Stamina Changed 13 to 14. Leadership removed.', [13, 13], [14, 14]],
    ['Stamina changed 20 to 10/10. Physical Defense up to 4 from 3.', [20, 20], [10, 10]],
  ])('handles the real-world phrasings: %s', (text, printed, current) => {
    expect(parseStaminaErrata(text as string)).toEqual({ printed, current });
  });

  it('returns null when errata does not touch stamina', () => {
    expect(parseStaminaErrata('Peerless added.')).toBeNull();
    expect(parseStaminaErrata(null)).toBeNull();
  });

  /*
   * The scan is a physical card; the corpus holds the current value. For the
   * 136 errata'd characters those differ by design, so a faithful reading of a
   * pre-errata card must not be reported as a misread — otherwise the review
   * queue fills with false positives and the real ones get lost.
   */
  it('accepts the printed value on a pre-errata scan, marked explained', () => {
    const found = crossCheck(extracted(6, 6), {
      healthyStamina: 7,
      injuredStamina: 6,
      errata: ANCIENT_ONE,
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ field: 'healthy.stamina', extracted: 6, known: 7, explained: true });
  });

  it('accepts the current value on a reprinted card, silently', () => {
    expect(
      crossCheck(extracted(7, 6), { healthyStamina: 7, injuredStamina: 6, errata: ANCIENT_ONE }),
    ).toEqual([]);
  });

  // The parse is what keeps this a real check rather than a blanket exemption.
  it('still catches a genuine misread on an errata\'d character', () => {
    const found = crossCheck(extracted(9, 6), {
      healthyStamina: 7,
      injuredStamina: 6,
      errata: ANCIENT_ONE,
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.explained).toBeUndefined();
  });

  it('catches a misread when there is no errata at all', () => {
    const found = crossCheck(extracted(5, 6), { healthyStamina: 7, injuredStamina: 6 });
    expect(found[0]).toMatchObject({ field: 'healthy.stamina', extracted: 5, known: 7 });
    expect(found[0]?.explained).toBeUndefined();
  });
});
