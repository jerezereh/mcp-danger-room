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

export const Attack = z.object({
  name: z.string().min(1),
  type: DamageType,
  /** Range band 1–5. Melee attacks use 1. */
  range: z.number().int().min(1).max(5),
  /** Dice in the attack pool. */
  dice: z.number().int().min(0).max(12),
  /** Power cost to use. */
  cost: z.number().int().min(0),
  /** Rules text, retaining {symbol} tokens for the renderer. */
  text: z.array(z.string()).default([]),
});
export type Attack = z.infer<typeof Attack>;

export const Superpower = z.object({
  name: z.string().min(1),
  type: SuperpowerType,
  cost: z.number().int().min(0),
  text: z.string(),
});
export type Superpower = z.infer<typeof Superpower>;

/** One side of a character card. */
export const StatBlock = z.object({
  cardImage: z.string().nullable(),
  stamina: z.number().int().min(1),
  movement: MovementTemplate,
  size: z.number().int().min(1).max(4),
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
  /** Base diameter in mm. */
  baseMm: z.number().int().default(40),
  healthy: StatBlock,
  injured: StatBlock,
  /** Where this data came from, so gaps are auditable. */
  source: z.enum(['legacy-import', 'manual', 'scraped']).default('manual'),
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
