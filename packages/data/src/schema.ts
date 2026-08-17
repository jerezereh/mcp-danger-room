/**
 * Card schemas.
 *
 * Card data is the project's largest and longest-lived asset, and it will be
 * assembled by hand and by scraper over months. Validating it at load time with
 * Zod means a typo in a stat block fails loudly at import rather than silently
 * producing a character who cannot be attacked.
 *
 * The shape below normalizes the prototype's JSON in two ways:
 *
 *  - Attacks and superpowers become *arrays* rather than the numbered fields
 *    `Attack1..Attack4` / `Superpower1..Superpower6`, which forced every
 *    character into a fixed shape padded with nulls.
 *  - Healthy and injured become two entries of the same `StatBlock` schema
 *    rather than 30-odd `healthyX`/`injuredX` sibling fields.
 */

import { z } from 'zod';

/** Damage and defense types. */
export const DamageType = z.enum(['physical', 'energy', 'mystic']);
export type DamageType = z.infer<typeof DamageType>;

export const MovementTemplate = z.enum(['S', 'M', 'L']);
export type MovementTemplate = z.infer<typeof MovementTemplate>;

export const SuperpowerType = z.enum([
  'active',
  'reactive',
  'passive',
  'innate',
  'affiliation',
  'leadership',
]);
export type SuperpowerType = z.infer<typeof SuperpowerType>;

/**
 * A printed power cost.
 *
 * Almost always a number, but 22 superpowers print "X": the player chooses how
 * much Power to spend and the rules text supplies the bound ("spend up to 3").
 * There is no numeric value to store.
 *
 * Modelling this as a plain number silently turned all 22 into cost 0 — free —
 * because that is where a failed parse lands. The literal is preserved instead,
 * so a consumer that cannot handle a variable cost fails loudly at the type
 * level rather than quietly charging nothing.
 */
export const PowerCost = z.union([z.number().int().min(0), z.literal('X')]);
export type PowerCost = z.infer<typeof PowerCost>;

/**
 * How an attack is delivered.
 *
 * Cards print this as a prefix on the range value: bare "4" is an ordinary
 * attack, "B4" a Beam, "A2" an Area. The three resolve against different sets
 * of targets, so the prefix is a rule, not decoration.
 */
export const AttackShape = z.enum(['range', 'beam', 'area']);
export type AttackShape = z.infer<typeof AttackShape>;

/** Range band 1–5, or "*" for the one Area attack whose size its text defines. */
export const RangeBand = z.union([z.number().int().min(1).max(5), z.literal('*')]);
export type RangeBand = z.infer<typeof RangeBand>;

export const Attack = z.object({
  name: z.string().min(1),
  type: DamageType,
  /** Range band 1–5. Melee attacks use 1. */
  range: RangeBand,
  /** Beam and Area attacks hit differently; the card prints B or A on `range`. */
  shape: AttackShape.default('range'),
  /** Dice in the attack pool. */
  dice: z.number().int().min(0).max(12),
  /** Power cost to use. */
  cost: PowerCost,
  /** Rules text, retaining {symbol} tokens for the renderer. */
  text: z.array(z.string()).default([]),
});
export type Attack = z.infer<typeof Attack>;

export const Superpower = z.object({
  name: z.string().min(1),
  type: SuperpowerType,
  cost: PowerCost,
  text: z.string(),
});
export type Superpower = z.infer<typeof Superpower>;

/** One side of a character card. */
export const StatBlock = z.object({
  cardImage: z.string().nullable(),
  stamina: z.number().int().min(1),
  movement: MovementTemplate,
  /**
   * Size class 1–5. 5 is real and rare — Dormammu and the two Sentinel MK4
   * variants. Capping this at 4 kept all three out of the corpus entirely.
   */
  size: z.number().int().min(1).max(5),
  defense: z.object({
    physical: z.number().int().min(0),
    energy: z.number().int().min(0),
    mystic: z.number().int().min(0),
  }),
  attacks: z.array(Attack).default([]),
  superpowers: z.array(Superpower).default([]),
});
export type StatBlock = z.infer<typeof StatBlock>;

export const Character = z.object({
  /** Stable kebab-case key. Never derived from display name at runtime. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  alterEgo: z.string().nullable(),
  affiliations: z.array(z.string()).default([]),
  /**
   * The product pack this character was released in, e.g. "CP162".
   *
   * NOT a cost. The prototype stored this as a numeric `cp` field described as
   * "Character Points" and the roster builder validated squads against a CP
   * budget — a rule this game does not have. The number is a pack identifier,
   * which doubles as a character id on some community sources.
   */
  packCode: z.string().nullable().default(null),
  packName: z.string().nullable().default(null),
  /** Squad cost in Threat. The game's only character cost. */
  threat: z.number().int().min(0),
  /**
   * Official errata, where the current stat line differs from the printed card.
   *
   * AMG revises stats after release. A card that reads Stamina 6 may currently
   * be 7 — this records that, so a discrepancy between the corpus and a card in
   * someone's hand is explainable rather than alarming.
   */
  errata: z.string().nullable().default(null),
  /** Base diameter in mm. */
  baseMm: z.number().int().default(40),
  healthy: StatBlock,
  injured: StatBlock,
  /**
   * Every source that contributed to this record, so provenance is auditable.
   *
   * An array rather than one value, because a merged character genuinely comes
   * from several: Jarvis for current stats, Cerebro for images and errata,
   * BSData for rules text. A single label had to pick one and was misleading —
   * it reported all 196 characters as "bsdata" when most of their stats came
   * from Jarvis.
   *
   * None of these imply a human has checked the result; that is `verified`.
   */
  sources: z
    .array(z.enum(['legacy-import', 'manual', 'scraped', 'cerebro', 'bsdata', 'jarvis', 'ocr']))
    .default([]),
  /** False until a human has checked it against the physical card. */
  verified: z.boolean().default(false),
});
export type Character = z.infer<typeof Character>;

export const TacticCard = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  type: z.enum(['team', 'basic', 'crisis', 'injury']),
  cost: z.number().int().min(0).default(0),
  /** Restricted to characters or affiliations, when applicable. */
  requires: z.array(z.string()).default([]),
  text: z.string(),
});
export type TacticCard = z.infer<typeof TacticCard>;

export const CrisisCard = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  kind: z.enum(['extract', 'secure']),
  /** Threat limit this crisis sets for the game. */
  threat: z.number().int().min(0),
  text: z.string(),
});
export type CrisisCard = z.infer<typeof CrisisCard>;

export const CardDatabase = z.object({
  characters: z.array(Character).default([]),
  tactics: z.array(TacticCard).default([]),
  crises: z.array(CrisisCard).default([]),
});
export type CardDatabase = z.infer<typeof CardDatabase>;

/** Parse and throw on any violation. Use at load time, not per render. */
export function parseDatabase(raw: unknown): CardDatabase {
  return CardDatabase.parse(raw);
}
