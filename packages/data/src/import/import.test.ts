import { describe, expect, it } from 'vitest';

import { parseCost, parseRange } from './bsdata.js';
import { cerebroToDraft, parsePack } from './cerebro.js';
import type { CharacterDraft } from './draft.js';
import { finalize } from './draft.js';
import { mergeDrafts } from './merge.js';
import { applyOverrides, Override } from './overrides.js';
import { ocrToDraft } from './ocr.js';
import { qualifiedSlug, slugify, splitName } from './slug.js';
import {
  checkTriggerIcons,
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

  /*
   * For 32 characters — Adam Warlock, Ancient One, Dormammu, Arnim Zola and
   * others — the card really does print the same text as the alter ego,
   * because that *is* their civilian name. Treating the repetition as "no
   * alter ego" threw away a value the card carries.
   */
  it('keeps an alias that matches the name — it is still the alter ego', () => {
    const draft = cerebroToDraft({ ID: 1, Name: 'Adam Warlock', Alias: 'Adam Warlock' });
    expect(draft.alterEgo).toBe('Adam Warlock');
  });

  it('is null only when the source gives no alias at all', () => {
    expect(cerebroToDraft({ ID: 1, Name: 'Abomination' }).alterEgo).toBeNull();
    expect(cerebroToDraft({ ID: 1, Name: 'Abomination', Alias: '  ' }).alterEgo).toBeNull();
  });

  it('keeps a real alter ego', () => {
    const draft = cerebroToDraft({ ID: 1, Name: 'Abomination', Alias: 'Emil Blonsky' });
    expect(draft.alterEgo).toBe('Emil Blonsky');
  });

  it('produces an incomplete draft — it has no rules text to give', () => {
    const draft = cerebroToDraft({
      ID: 1,
      Name: 'Abomination',
      Cost: 5,
      Affiliations: 'Criminal Syndicate, Hydra',
      front_health: 7,
    });
    expect(draft.threat).toBe(5);
    expect(draft.affiliations).toEqual(['Criminal Syndicate', 'Hydra']);
    expect(draft.healthy?.attacks).toBeUndefined();

    const finalized = finalize(draft);
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
    const { drafts } = mergeDrafts({ cerebro: [cerebro], bsdata: [bsdata] });
    const merged = drafts[0];

    expect(merged?.name).toBe('Angela'); // Cerebro's casing
    expect(merged?.healthy?.movement).toBe('L'); // BSData's rules data
    expect(merged?.healthy?.cardImage).toBe('ANGELA_healthy.png'); // only Cerebro has it
    expect(merged?.sources).toEqual(['cerebro', 'bsdata']);
  });

  it('does not report case-only name differences as conflicts', () => {
    // BSData uppercases every name. Reporting those would bury the real
    // disagreements under one conflict per character.
    const { conflicts } = mergeDrafts({ cerebro: [cerebro], bsdata: [bsdata] });
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
    const { drafts } = mergeDrafts({ cerebro: [withErrata], bsdata: [bsdata] }); // cerebro 7, bsdata 6
    expect(drafts[0]?.healthy?.stamina).toBe(7);
  });

  it('does not flag a difference that a stamina errata explains', () => {
    const withErrata: CharacterDraft = { ...cerebro, errata: 'Stamina change 6/6 to 7/6' };
    const { conflicts } = mergeDrafts({ cerebro: [withErrata], bsdata: [bsdata] });
    expect(conflicts.filter(c => c.field.endsWith('stamina'))).toEqual([]);
  });

  it('flags a difference with no errata to explain it', () => {
    // No errata text: one of the two sources is simply wrong.
    const { conflicts } = mergeDrafts({ cerebro: [cerebro], bsdata: [bsdata] });
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
    const { drafts } = mergeDrafts({ cerebro: [singleSided], bsdata: [bsWithInjured] });
    expect(drafts[0]?.injured?.stamina).toBe(8);
  });

  it('passes through characters present in only one source', () => {
    const { drafts, stats } = mergeDrafts({
      cerebro: [cerebro, { id: 'bastion', name: 'Bastion', sources: ['cerebro'] }],
      bsdata: [bsdata],
    });
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
      attacks: [{ name: 'Punch', type: 'physical', range: 1, shape: 'range' as const, dice: 5, cost: 0, text: [] }],
      superpowers: [],
    },
    injured: {
      stamina: 6,
      movement: 'M',
      size: 2,
      defense: { physical: 3, energy: 3, mystic: 3 },
      attacks: [{ name: 'Punch', type: 'physical', range: 1, shape: 'range' as const, dice: 5, cost: 0, text: [] }],
      superpowers: [],
    },
    sources: ['bsdata'],
  });

  it('promotes a complete draft', () => {
    const result = finalize(complete());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.sources).toEqual(['bsdata']);
    // Nothing this pipeline produces has been checked against a printed card.
    expect(result.character.verified).toBe(false);
  });

  it('reports exactly which fields are missing rather than throwing', () => {
    const draft = complete();
    delete draft.healthy?.size;
    delete draft.threat;

    const result = finalize(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('threat');
    expect(result.missing).toContain('healthy.size');
  });

  it('treats an attackless character as incomplete, not valid', () => {
    const draft = complete();
    draft.healthy = { ...draft.healthy, attacks: [] };

    const result = finalize(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('healthy.attacks');
  });
});

describe('OCR cross-check', () => {
  const extracted = (over: Partial<ExtractedCard> = {}): ExtractedCard => ({
    name: 'Angela',
    alterEgo: null,
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
      crossCheck(extracted(), { name: 'Angela', healthyStamina: 6 }),
    ).toEqual([]);
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

describe('manual overrides', () => {
  const base = () => ({
    id: 'toad',
    name: 'Toad',
    alterEgo: null,
    affiliations: ['Brotherhood of Mutants'],
    packCode: 'CP12',
    packName: null,
    threat: 2,
    errata: null,
    baseMm: 40,
    healthy: {
      cardImage: null,
      stamina: 4,
      movement: 'M' as const,
      size: 2,
      defense: { physical: 3, energy: 2, mystic: 2 },
      attacks: [
        { name: 'Kick', type: 'physical' as const, range: 1, shape: 'range' as const, dice: 4, cost: 0, text: [] },
      ],
      superpowers: [],
    },
    injured: {
      cardImage: null,
      stamina: 4,
      movement: 'M' as const,
      size: 2,
      defense: { physical: 3, energy: 2, mystic: 2 },
      attacks: [
        { name: 'Kick', type: 'physical' as const, range: 1, shape: 'range' as const, dice: 4, cost: 0, text: [] },
      ],
      superpowers: [],
    },
    sources: ['jarvis' as const],
    verified: false,
  });

  it('patches one field without restating the card', () => {
    const { characters, applied } = applyOverrides(
      [base()],
      [{ id: 'toad', reason: 'checked against the printed card', healthy: { stamina: 5 } }],
    );

    expect(applied).toEqual(['toad']);
    expect(characters[0]?.healthy.stamina).toBe(5);
    // Everything else survives — an override is a patch, not a replacement.
    expect(characters[0]?.healthy.defense).toEqual({ physical: 3, energy: 2, mystic: 2 });
    expect(characters[0]?.healthy.attacks).toHaveLength(1);
    expect(characters[0]?.injured.stamina).toBe(4);
  });

  it('deep-merges a single defense value', () => {
    const { characters } = applyOverrides(
      [base()],
      [{ id: 'toad', reason: 'errata', healthy: { defense: { mystic: 4 } } }],
    );
    expect(characters[0]?.healthy.defense).toEqual({ physical: 3, energy: 2, mystic: 4 });
  });

  // Overrides are the only route to verified:true — a flag a machine can set
  // for itself records nothing.
  it('is the only way a record becomes verified', () => {
    const { characters } = applyOverrides(
      [base()],
      [{ id: 'toad', reason: 'compared against my copy of the card', verified: true }],
    );
    expect(characters[0]?.verified).toBe(true);
  });

  it('reports an id that matched nothing instead of ignoring it', () => {
    // A typo'd id would otherwise look like a correction that silently never
    // happened — the worst failure mode for a hand-maintained file.
    const { applied, unmatched } = applyOverrides(
      [base()],
      [{ id: 'toadd', reason: 'typo' }],
    );
    expect(applied).toEqual([]);
    expect(unmatched).toEqual(['toadd']);
  });

  it('leaves characters untouched when there are no overrides', () => {
    const { characters } = applyOverrides([base()], []);
    expect(characters[0]).toEqual(base());
  });

  it('requires a reason', () => {
    expect(Override.safeParse({ id: 'toad' }).success).toBe(false);
    expect(Override.safeParse({ id: 'toad', reason: 'why' }).success).toBe(true);
  });

  it('rejects unknown fields rather than silently dropping them', () => {
    expect(
      Override.safeParse({ id: 'toad', reason: 'x', stamina: 5 }).success,
    ).toBe(false);
  });
});

describe('OCR as a merge source', () => {
  const cerebro: CharacterDraft = {
    id: 'angela',
    name: 'Angela',
    threat: 5,
    healthy: { cardImage: 'ANGELA_healthy.png', stamina: 7 },
    sources: ['cerebro'],
  };
  const bsdata: CharacterDraft = {
    id: 'angela',
    name: 'ANGELA',
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

  const ocr = ocrToDraft({
    id: 'angela',
    card: {
      name: 'ANGELA',
      alterEgo: null,
      healthy: {
        stamina: 99,
        movement: 'S',
        size: 4,
        defense: { physical: 9, energy: 9, mystic: 9 },
        attacks: [
          { name: 'OCR Attack', type: 'physical', range: 2, shape: 'range' as const, dice: 5, cost: 0, text: ['read off the card'] },
        ],
        superpowers: [{ name: 'OCR Power', type: 'innate', cost: 0, text: '' }],
      },
      injured: {
        stamina: 99,
        movement: 'S',
        size: 4,
        defense: { physical: 9, energy: 9, mystic: 9 },
        attacks: [],
        superpowers: [],
      },
      legibility: 'clear',
      notes: '',
    },
  });

  /*
   * OCR reads the physical card, so it is blind to errata, and it is the only
   * source that can hallucinate. It must never win against a curated source —
   * these deliberately absurd values would be visible immediately if it did.
   */
  it('never overrides a curated source', () => {
    const { drafts } = mergeDrafts({ cerebro: [cerebro], bsdata: [bsdata], ocr: [ocr] });
    const merged = drafts[0];

    expect(merged?.healthy?.stamina).toBe(7); // Cerebro, not OCR's 99
    expect(merged?.healthy?.movement).toBe('L'); // BSData, not OCR's 'S'
    expect(merged?.healthy?.size).toBe(2); // BSData, not OCR's 4
    expect(merged?.healthy?.defense).toEqual({ physical: 4, energy: 4, mystic: 4 });
  });

  it('supplies rules text where no other source has any', () => {
    // The whole reason OCR exists: characters released after BSData froze.
    const { drafts } = mergeDrafts({ cerebro: [cerebro], ocr: [ocr] });

    expect(drafts[0]?.healthy?.attacks?.[0]?.name).toBe('OCR Attack');
    expect(drafts[0]?.healthy?.superpowers?.[0]?.name).toBe('OCR Power');
    expect(drafts[0]?.sources).toContain('ocr');
  });

  it('yields to BSData for rules text when both have it', () => {
    const { drafts } = mergeDrafts({ bsdata: [bsdata], ocr: [ocr] });
    expect(drafts[0]?.healthy?.attacks).toEqual([]);
  });
});

/*
 * Beam, Area and variable costs.
 *
 * All three used to be parsed with a bare integer parse that returned undefined
 * and fell through to a default. The defaults were legal values — range 1 and
 * cost 0 — so 46 Beam/Area attacks became melee and 22 variable-cost powers
 * became free, with nothing to flag either.
 */
describe('parseRange', () => {
  it('reads an ordinary range', () => {
    expect(parseRange('4')).toEqual({ range: 4, shape: 'range' });
  });

  it('reads a Beam', () => {
    expect(parseRange('B4')).toEqual({ range: 4, shape: 'beam' });
  });

  it('reads an Area', () => {
    expect(parseRange('A2')).toEqual({ range: 2, shape: 'area' });
  });

  it('keeps the literal for an Area whose size its text defines', () => {
    expect(parseRange('A*')).toEqual({ range: '*', shape: 'area' });
  });

  it('does not silently turn a prefixed range into melee', () => {
    // The exact regression: parseInt('B3') is NaN, which fell through to 1.
    expect(parseRange('B3')?.range).toBe(3);
    expect(parseRange('B3')?.shape).toBe('beam');
  });

  it('reports unreadable input rather than guessing', () => {
    expect(parseRange('wat')).toBeNull();
    expect(parseRange('')).toBeNull();
    expect(parseRange(undefined)).toBeNull();
    // Out of band — a real misparse, not a shape we do not know yet.
    expect(parseRange('9')).toBeNull();
  });
});

describe('parseCost', () => {
  it('reads a number', () => {
    expect(parseCost('3')).toBe(3);
  });

  it('treats "-" as no cost', () => {
    expect(parseCost('-')).toBe(0);
  });

  it('preserves a variable cost rather than making it free', () => {
    expect(parseCost('X')).toBe('X');
    expect(parseCost('x')).toBe('X');
  });
});


/*
 * Trigger icons are always dice results, so a prefix carrying anything else is
 * a misread that needs no reference data to spot. This matters because the
 * misreads produce *valid* tokens — run 3 read the Wild coil as {ENRG} and
 * {RNG}, and the Hit burst as {PWR}, 42 times — and a wrong-but-valid token is
 * indistinguishable from a right one by eye.
 */
describe('checkTriggerIcons', () => {
  const card = (text: string[]) =>
    ({
      healthy: { attacks: [{ name: 'Punch', text }], superpowers: [] },
      injured: { attacks: [], superpowers: [] },
    }) as unknown as Parameters<typeof checkTriggerIcons>[0];

  it('accepts a prefix of dice results', () => {
    expect(checkTriggerIcons(card(['{WILD} <b>Stun</b>: does a thing.']))).toEqual([]);
    expect(checkTriggerIcons(card(['{CRIT} {HIT} <b>Ricochet</b>: does a thing.']))).toEqual([]);
  });

  it('catches the Wild coil misread as Energy or Range', () => {
    expect(checkTriggerIcons(card(['{ENRG} <b>Degeneration</b>: x.']))[0]?.offenders).toEqual([
      'ENRG',
    ]);
    expect(checkTriggerIcons(card(['{RNG} <b>Throw</b>: x.']))[0]?.offenders).toEqual(['RNG']);
  });

  it('catches the Hit burst misread as the Power star', () => {
    expect(checkTriggerIcons(card(['{PWR} <b>Hostile Takeover</b>: x.']))[0]?.offenders).toEqual([
      'PWR',
    ]);
  });

  it('leaves {UNKNOWN} alone — an honest flag is not a misread', () => {
    expect(checkTriggerIcons(card(['{UNKNOWN} <b>Push</b>: x.']))).toEqual([]);
  });

  it('ignores a bullet with no leading icons', () => {
    expect(checkTriggerIcons(card(['After this attack is resolved, gains {PWR}.']))).toEqual([]);
  });
});
