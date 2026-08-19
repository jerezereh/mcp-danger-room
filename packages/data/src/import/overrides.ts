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

import {
  AttackShape,
  DamageType,
  PowerCost,
  RangeBand,
  Superpower,
  SuperpowerType,
  type Character,
} from '../schema.js';

/**
 * A correction to one printed ability.
 *
 * Keyed by the ability's current name, so a patch says what it is fixing. Only
 * the fields present change; `text` replaces the whole body, because these
 * corrections are almost always "this icon is the wrong one" and a whole-line
 * replacement is unambiguous where a token-level splice would not be.
 */
const AttackPatch = z
  .object({
    name: z.string().optional(),
    type: DamageType.optional(),
    range: RangeBand.optional(),
    shape: AttackShape.optional(),
    dice: z.number().int().min(0).optional(),
    cost: PowerCost.optional(),
    text: z.array(z.string()).optional(),
  })
  .strict();

const SuperpowerPatch = z
  .object({
    name: z.string().optional(),
    type: SuperpowerType.optional(),
    cost: PowerCost.optional(),
    text: z.string().optional(),
  })
  .strict();

const Abilities = z
  .object({
    attacks: z.record(z.string(), AttackPatch).optional(),
    superpowers: z.record(z.string(), SuperpowerPatch).optional(),
    /** For a keyword line the extractor merged into one entry. */
    addSuperpowers: z.array(Superpower).optional(),
    removeSuperpowers: z.array(z.string()).optional(),
  })
  .strict();

const StatOverride = z
  .object({
    stamina: z.number().int().min(1).optional(),
    movement: z.enum(['S', 'M', 'L']).optional(),
    size: z.number().int().min(1).max(5).optional(),
    defense: z
      .object({
        physical: z.number().int().min(0).optional(),
        energy: z.number().int().min(0).optional(),
        mystic: z.number().int().min(0).optional(),
      })
      .optional(),
  })
  .merge(Abilities)
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
    /**
     * Drop the character entirely. The corpus carries a few {BETA} playtest
     * cards that duplicate a real character and should never be fieldable.
     */
    remove: z.literal(true).optional(),
    name: z.string().optional(),
    alterEgo: z.string().nullable().optional(),
    affiliations: z.array(z.string()).optional(),
    threat: z.number().int().min(0).optional(),
    errata: z.string().nullable().optional(),
    baseMm: z.number().int().optional(),
    healthy: StatOverride.optional(),
    injured: StatOverride.optional(),
  })
  /*
   * Ability patches at the top level apply to both faces. Cards print the same
   * abilities on each side unless the injured side differs, so requiring every
   * correction twice would be a copy-and-paste invitation to fix one face and
   * forget the other. Side-specific corrections go in `healthy` / `injured`.
   */
  .merge(Abilities)
  .strict();

export type Override = z.infer<typeof Override>;

export const OverrideFile = z.object({
  overrides: z.array(Override).default([]),
});

export type Abilities = z.infer<typeof Abilities>;

export interface ApplyResult {
  readonly characters: Character[];
  readonly applied: string[];
  /** Overrides whose id matched nothing — a typo, or a renamed character. */
  readonly unmatched: string[];
  /** Characters an override deleted. */
  readonly removed: string[];
  /** Ability patches whose name matched nothing — the same class of typo. */
  readonly unmatchedAbilities: string[];
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
  const removed: string[] = [];
  /** Ability keys an override asked for, and the ones that actually matched. */
  const wanted = new Set<string>();
  const seen = new Set<string>();

  for (const o of overrides) {
    const target = byId.get(o.id);
    if (!target) {
      unmatched.push(o.id);
      continue;
    }

    if (o.remove) {
      byId.delete(o.id);
      removed.push(o.id);
      applied.push(o.id);
      continue;
    }

    /*
     * Ability patches are keyed by the ability's current name. A key that
     * matches nothing is reported the same way an unmatched character id is:
     * a correction that quietly never happened is worse than a loud typo,
     * because it looks like the data was checked when it was not.
     */
    const patchAbilities = (base: Character['healthy'], patch: Abilities | undefined) => {
      if (!patch) return base;

      const attacks = base.attacks.map(a => {
        const p = patch.attacks?.[a.name];
        if (!p) return a;
        seen.add(`${o.id}/attack/${a.name}`);
        return { ...a, ...p };
      });

      let superpowers = base.superpowers.map(sp => {
        const p = patch.superpowers?.[sp.name];
        if (!p) return sp;
        seen.add(`${o.id}/superpower/${sp.name}`);
        return { ...sp, ...p };
      });

      if (patch.removeSuperpowers) {
        const drop = new Set(patch.removeSuperpowers);
        for (const name of drop) seen.add(`${o.id}/superpower/${name}`);
        superpowers = superpowers.filter(sp => !drop.has(sp.name));
      }
      if (patch.addSuperpowers) superpowers = [...superpowers, ...patch.addSuperpowers];

      return { ...base, attacks, superpowers };
    };

    for (const name of Object.keys(o.attacks ?? {})) wanted.add(`${o.id}/attack/${name}`);
    for (const name of Object.keys(o.superpowers ?? {})) wanted.add(`${o.id}/superpower/${name}`);
    for (const s of ['healthy', 'injured'] as const) {
      for (const name of Object.keys(o[s]?.attacks ?? {})) wanted.add(`${o.id}/attack/${name}`);
      for (const name of Object.keys(o[s]?.superpowers ?? {})) {
        wanted.add(`${o.id}/superpower/${name}`);
      }
      for (const name of o[s]?.removeSuperpowers ?? []) wanted.add(`${o.id}/superpower/${name}`);
    }
    for (const name of o.removeSuperpowers ?? []) wanted.add(`${o.id}/superpower/${name}`);

    const side = (base: Character['healthy'], patch: z.infer<typeof StatOverride> | undefined) => {
      // Both-sides patches first, then anything specific to this face.
      const withShared = patchAbilities(base, o);
      const stats = patch
        ? {
            ...withShared,
            ...(patch.stamina !== undefined ? { stamina: patch.stamina } : {}),
            ...(patch.movement !== undefined ? { movement: patch.movement } : {}),
            ...(patch.size !== undefined ? { size: patch.size } : {}),
            ...(patch.defense ? { defense: { ...withShared.defense, ...patch.defense } } : {}),
          }
        : withShared;
      return patchAbilities(stats, patch);
    };

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

  return {
    characters: [...byId.values()],
    applied,
    unmatched,
    removed,
    unmatchedAbilities: [...wanted].filter(k => !seen.has(k)).sort(),
  };
}
