/**
 * Human corrections, applied last.
 *
 * Every automated source is wrong somewhere, and when a person has checked a
 * value against the printed card there needs to be somewhere to put it that a
 * re-import will not overwrite. That is this file's job: overrides.json is
 * hand-maintained, is applied after the merge, and beats all three sources.
 *
 * It is also the only path to `verified: true`. Nothing the importers or the
 * OCR extractor produce may set it — verification means a human looked, and a
 * flag a machine can set for itself records nothing.
 *
 * Keep it small. An override is a patch over a source that got something
 * wrong; if a whole class of values is wrong, fix the merge instead.
 */

import { z } from 'zod';

import type { Character } from '../schema.js';

const StatOverride = z
  .object({
    stamina: z.number().int().min(1).optional(),
    movement: z.enum(['S', 'M', 'L']).optional(),
    size: z.number().int().min(1).max(4).optional(),
    defense: z
      .object({
        physical: z.number().int().min(0).optional(),
        energy: z.number().int().min(0).optional(),
        mystic: z.number().int().min(0).optional(),
      })
      .optional(),
  })
  .strict();

export const Override = z
  .object({
    id: z.string(),
    /**
     * Why this override exists and what backs it. Required — an unexplained
     * override is indistinguishable from a mistake six months later.
     */
    reason: z.string().min(1),
    /** Set true only when a person has compared this against a printed card. */
    verified: z.boolean().optional(),
    name: z.string().optional(),
    alterEgo: z.string().nullable().optional(),
    affiliations: z.array(z.string()).optional(),
    threat: z.number().int().min(0).optional(),
    errata: z.string().nullable().optional(),
    baseMm: z.number().int().optional(),
    healthy: StatOverride.optional(),
    injured: StatOverride.optional(),
  })
  .strict();

export type Override = z.infer<typeof Override>;

export const OverrideFile = z.object({
  overrides: z.array(Override).default([]),
});

export interface ApplyResult {
  readonly characters: Character[];
  readonly applied: string[];
  /** Overrides whose id matched nothing — a typo, or a renamed character. */
  readonly unmatched: string[];
}

/**
 * Apply overrides to finalized characters.
 *
 * Deep-merges the stat blocks so an override can correct one number without
 * restating the whole card, and reports ids that matched nothing rather than
 * silently ignoring them — a typo'd id would otherwise look like a correction
 * that quietly never happened.
 */
export function applyOverrides(
  characters: readonly Character[],
  overrides: readonly Override[],
): ApplyResult {
  const byId = new Map(characters.map(c => [c.id, { ...c }]));
  const applied: string[] = [];
  const unmatched: string[] = [];

  for (const o of overrides) {
    const target = byId.get(o.id);
    if (!target) {
      unmatched.push(o.id);
      continue;
    }

    const side = (base: Character['healthy'], patch: z.infer<typeof StatOverride> | undefined) =>
      patch
        ? {
            ...base,
            ...(patch.stamina !== undefined ? { stamina: patch.stamina } : {}),
            ...(patch.movement !== undefined ? { movement: patch.movement } : {}),
            ...(patch.size !== undefined ? { size: patch.size } : {}),
            ...(patch.defense ? { defense: { ...base.defense, ...patch.defense } } : {}),
          }
        : base;

    byId.set(o.id, {
      ...target,
      ...(o.name !== undefined ? { name: o.name } : {}),
      ...(o.alterEgo !== undefined ? { alterEgo: o.alterEgo } : {}),
      ...(o.affiliations !== undefined ? { affiliations: o.affiliations } : {}),
      ...(o.threat !== undefined ? { threat: o.threat } : {}),
      ...(o.errata !== undefined ? { errata: o.errata } : {}),
      ...(o.baseMm !== undefined ? { baseMm: o.baseMm } : {}),
      healthy: side(target.healthy, o.healthy),
      injured: side(target.injured, o.injured),
      ...(o.verified !== undefined ? { verified: o.verified } : {}),
    });
    applied.push(o.id);
  }

  return { characters: [...byId.values()], applied, unmatched };
}
