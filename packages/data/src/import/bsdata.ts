/**
 * BSData — the community BattleScribe catalogue.
 *
 * Complements Cerebro exactly: this is where defenses, attacks, superpowers and
 * rules text come from. Its weakness is currency — the catalogue stopped being
 * updated in late 2024, so recent releases are absent entirely.
 *
 * Two files are needed. The `.gst` game system holds the category entries
 * (every affiliation) and cost types; the `.cat` catalogue holds the characters
 * themselves and references categories by id. Parsing the catalogue alone gives
 * you characters with no affiliations.
 *
 * One BattleScribe quirk worth knowing: profile `typeName` values are padded
 * with leading spaces to control sort order in the app — `"    Character"`, not
 * `"Character"`. Every comparison here trims first.
 */

import { XMLParser } from 'fast-xml-parser';

import type {
  Attack,
  AttackShape,
  PowerCost,
  RangeBand,
  StatBlock,
  Superpower,
} from '../schema.js';
import type { CharacterDraft, StatBlockDraft } from './draft.js';
import { linkBlankWord } from '../symbols.js';
import { slugify, splitName } from './slug.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Characteristics carry their value as element text; keep it addressable.
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
});

type Node = Record<string, unknown>;

/** BattleScribe nests single children as objects and multiples as arrays. */
function many(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Node[];
}

/** Walk every node in the tree, depth-first. */
function* walk(node: unknown): Generator<Node> {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  yield node as Node;
  for (const value of Object.values(node as Node)) yield* walk(value);
}

const attr = (node: Node, name: string): string | undefined => {
  const value = node[`@${name}`];
  return value === undefined ? undefined : String(value);
};

const typeName = (node: Node): string => (attr(node, 'typeName') ?? '').trim();

const text = (node: Node): string => {
  const value = node['#text'];
  return value === undefined || value === null ? '' : String(value).trim();
};

/** Characteristics of one profile, keyed by their (trimmed) name. */
function characteristics(profile: Node): Record<string, string> {
  const out: Record<string, string> = {};
  for (const wrapper of many(profile['characteristics'])) {
    for (const c of many(wrapper['characteristic'])) {
      const name = (attr(c, 'name') ?? '').trim();
      if (name) out[name] = text(c);
    }
  }
  return out;
}

const int = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Split a printed range into its shape and its band.
 *
 * BSData writes what the card prints: "4", "B4" (Beam 4), "A2" (Area 2), and
 * once "A*", an Area whose size its rules text defines.
 *
 * This used to be a bare `int()`, which returned undefined for every prefixed
 * value and fell back to 1 — so all 46 Beam and Area attacks in the catalogue
 * were stored as range-1 melee. Nothing flagged it, because 1 is a legal range.
 */
export function parseRange(raw: string | undefined): {
  range: RangeBand;
  shape: AttackShape;
} | null {
  const match = (raw ?? '').trim().match(/^([BA])?\s*(\d+|\*)$/i);
  if (!match) return null;

  const shape: AttackShape =
    match[1]?.toUpperCase() === 'B' ? 'beam' : match[1]?.toUpperCase() === 'A' ? 'area' : 'range';

  const band = match[2] as string;
  if (band === '*') return { range: '*', shape };

  const n = Number.parseInt(band, 10);
  return n >= 1 && n <= 5 ? { range: n, shape } : null;
}

/**
 * A printed power cost: a number, or "X" when the player chooses the amount.
 *
 * "-" means the power has no cost. Both used to parse as undefined and land on
 * 0, which is right for "-" and wrong for "X" — it made 22 variable-cost powers
 * read as free.
 */
export function parseCost(raw: string | undefined): PowerCost {
  const v = (raw ?? '').trim();
  if (v.toUpperCase() === 'X') return 'X';
  return int(v) ?? 0;
}

/** BSData writes damage types as short codes; the schema uses full words. */
const DAMAGE_TYPES: Record<string, Attack['type']> = {
  phys: 'physical',
  ph: 'physical',
  physical: 'physical',
  enrg: 'energy',
  en: 'energy',
  e: 'energy',
  energy: 'energy',
  mystic: 'mystic',
  myst: 'mystic',
  my: 'mystic',
  m: 'mystic',
};

const SUPERPOWER_TYPES: Record<string, Superpower['type']> = {
  active: 'active',
  activated: 'active',
  reactive: 'reactive',
  reaction: 'reactive',
  innate: 'innate',
  // Not a distinct type — see the note on SuperpowerType. BSData has never
  // actually emitted this, but the mapping existed and would have been wrong.
  affiliation: 'leadership',
  leadership: 'leadership',
};

/**
 * The profile's `typeName` attribute — the structural, authoritative answer.
 *
 * Every superpower profile carries one, and unlike the `Type` characteristic it
 * cannot be filled in wrong by a contributor typing in the wrong box. That is
 * not hypothetical: Omega Red's DEATH SPORES has its entire rules text pasted
 * into `Type` and an empty `Special Rules`, which made it the corpus's only
 * "passive" power and left it with no text at all.
 */
const SUPERPOWER_TYPE_BY_PROFILE: Record<string, Superpower['type']> = {
  'Active Superpowers': 'active',
  'Reactive Superpowers': 'reactive',
  'Innate Superpowers': 'innate',
  Leadership: 'leadership',
};

const MOVEMENT: Record<string, StatBlock['movement']> = {
  s: 'S',
  m: 'M',
  l: 'L',
  short: 'S',
  medium: 'M',
  long: 'L',
};

// Blank is the one die result with no icon, so BSData spells it out. Linking
// it here is what makes it a die result downstream rather than prose.
const clean = (raw: string): string => linkBlankWord(raw.replace(/\{.*?\}/g, m => m).trim());

export interface BsdataWarning {
  readonly character: string;
  readonly message: string;
}

export interface BsdataResult {
  readonly drafts: CharacterDraft[];
  readonly warnings: BsdataWarning[];
}

/**
 * Parse a BattleScribe catalogue plus its game system into character drafts.
 *
 * Takes file *contents*, not paths, so it stays pure and testable.
 */
export function parseBsdata(catalogueXml: string, gameSystemXml: string): BsdataResult {
  const warnings: BsdataWarning[] = [];

  // Categories (affiliations) and cost types live in the game system file.
  const gst = parser.parse(gameSystemXml) as Node;
  const categories = new Map<string, string>();
  for (const node of walk(gst)) {
    if ('@id' in node && '@name' in node && node['@name'] !== undefined) {
      // categoryEntry nodes are the only ones we look up by id, and a stray
      // collision is harmless — the id is only consulted via categoryLink.
      const id = attr(node, 'id');
      const name = attr(node, 'name');
      if (id && name && !categories.has(id)) categories.set(id, name);
    }
  }

  const cat = parser.parse(catalogueXml) as Node;

  // A character is any selectionEntry that owns at least one Character profile.
  const entries: Node[] = [];
  for (const node of walk(cat)) {
    if (!('@name' in node) || !('profiles' in node)) continue;
    const profiles = [...walk(node['profiles'])].filter(p => '@typeName' in p);
    if (profiles.some(p => typeName(p) === 'Character')) entries.push(node);
  }

  const drafts: CharacterDraft[] = [];

  for (const entry of entries) {
    const rawName = attr(entry, 'name') ?? '';
    const { name, alterEgo } = splitName(rawName);
    const id = slugify(rawName);
    if (!id) continue;

    const profiles = [...walk(entry['profiles'])].filter(p => '@typeName' in p);

    const sides = profiles.filter(p => typeName(p) === 'Character');
    const attacks = profiles.filter(p => typeName(p) === 'Attacks');
    const powers = profiles.filter(p => typeName(p).endsWith('Superpowers') || typeName(p) === 'Leadership');

    const toAttack = (p: Node): Attack | null => {
      const c = characteristics(p);
      const attackName = (attr(p, 'name') ?? '').trim();
      if (!attackName) return null;

      const rawType = (c['Type'] ?? '').replace(/[{}]/g, '').trim().toLowerCase();
      const type = DAMAGE_TYPES[rawType];
      if (!type) {
        warnings.push({ character: rawName, message: `unknown attack type "${c['Type']}" on ${attackName}` });
      }

      const parsedRange = parseRange(c['Range']);
      if (!parsedRange && c['Range'] !== undefined) {
        warnings.push({
          character: rawName,
          message: `unreadable range "${c['Range']}" on ${attackName}`,
        });
      }

      return {
        name: attackName,
        type: type ?? 'physical',
        range: parsedRange?.range ?? 1,
        shape: parsedRange?.shape ?? 'range',
        dice: int(c['Strength']) ?? 0,
        cost: parseCost(c['Cost']),
        text: (c['Special Rules'] ?? '')
          .split('\n')
          .map(line => clean(line.replace(/^-\s*/, '')))
          .filter(Boolean),
      };
    };

    const toSuperpower = (p: Node): Superpower | null => {
      const c = characteristics(p);
      const powerName = (attr(p, 'name') ?? '').trim();
      if (!powerName) return null;

      const declared = (c['Type'] ?? '').trim();
      // The profile's own type wins; the Type characteristic only fills gaps.
      // Leadership profiles never carry one at all.
      const type =
        SUPERPOWER_TYPE_BY_PROFILE[typeName(p)] ?? SUPERPOWER_TYPES[declared.toLowerCase()];
      if (!type) {
        warnings.push({
          character: rawName,
          message: `unknown superpower type "${declared}" on ${powerName} — assuming innate`,
        });
      }

      /*
       * Recover rules text from the Type field when it holds prose.
       *
       * A contributor filled the wrong box for DEATH SPORES: its rules text is
       * in `Type` and `Special Rules` is empty. Taking the text as printed and
       * saying so is better than shipping a superpower with no text, which is
       * what the corpus did.
       */
      const rules = clean(c['Special Rules'] ?? '');
      const misplaced =
        rules === '' && declared !== '' && SUPERPOWER_TYPES[declared.toLowerCase()] === undefined;
      if (misplaced) {
        warnings.push({
          character: rawName,
          message: `rules text found in the Type field on ${powerName} — using it as the text`,
        });
      }

      return {
        name: powerName,
        type: type ?? 'innate',
        // Innate powers use "-" to mean no cost; "X" means the player chooses.
        cost: parseCost(c['Cost']),
        text: misplaced ? clean(declared) : rules,
      };
    };

    const buildSide = (profile: Node | undefined): StatBlockDraft | undefined => {
      if (!profile) return undefined;
      const c = characteristics(profile);
      const movement = MOVEMENT[(c['Speed'] ?? '').replace(/[{}]/g, '').trim().toLowerCase()];
      if (!movement) {
        warnings.push({ character: rawName, message: `unknown speed "${c['Speed']}"` });
      }

      return {
        stamina: int(c['Stamina']),
        movement: movement ?? 'M',
        size: int(c['Size']),
        defense: {
          physical: int(c['Physical Defense']),
          energy: int(c['Energy Defense']),
          mystic: int(c['Mystic Defense']),
        },
        // BSData does not separate healthy from injured attacks/superpowers —
        // both sides share the character's full list. Attaching the same list to
        // each side matches how the cards actually read.
        attacks: attacks.map(toAttack).filter((a): a is Attack => a !== null),
        superpowers: powers.map(toSuperpower).filter((s): s is Superpower => s !== null),
      };
    };

    const threat = int(characteristics(sides[0] ?? {})['Threat']);
    const affiliations = [...walk(entry)]
      // TODO(#33): this should be restricted to categoryLink nodes. It used to
      // read `&& 'categoryLink' !== undefined`, comparing a string literal to
      // undefined — always true, so the clause did nothing and every node with
      // a targetId reaches the lookup. Dropped rather than guessed at, because
      // it changes what the import produces.
      .filter(n => '@targetId' in n)
      .map(n => categories.get(attr(n, 'targetId') ?? ''))
      .filter((n): n is string => Boolean(n) && n !== 'Character' && n !== 'Characters');

    if (sides.length === 1) {
      warnings.push({ character: rawName, message: 'only one Character profile (no injured side)' });
    }

    drafts.push({
      id,
      name,
      alterEgo,
      affiliations: [...new Set(affiliations)],
      ...(threat === undefined ? {} : { threat }),
      healthy: buildSide(sides[0]),
      injured: buildSide(sides[1] ?? sides[0]),
      sources: ['bsdata'],
    });
  }

  return { drafts, warnings };
}
