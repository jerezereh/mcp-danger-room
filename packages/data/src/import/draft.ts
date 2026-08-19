/**
 * Character drafts.
 *
 * No single source has a complete character. Cerebro has breadth, currency and
 * card images but no rules text; BSData has full stat blocks but is ~20 months
 * stale and misses recent releases; OCR fills whatever is left. So the import
 * pipeline works in *drafts* — partial records that accumulate fields — and
 * only validates against the real `Character` schema at the very end.
 *
 * The alternative, making every field on `Character` optional, would weaken the
 * type everything else in the app depends on. Keeping drafts separate means the
 * runtime schema stays strict.
 */

import type { Attack, Character, StatBlock, Superpower } from '../schema.js';

export type DraftSource =
  | 'cerebro'
  | 'bsdata'
  | 'jarvis'
  | 'ocr'
  | 'manual';

export interface StatBlockDraft {
  cardImage?: string | null;
  stamina?: number;
  movement?: StatBlock['movement'];
  size?: number;
  defense?: Partial<StatBlock['defense']>;
  attacks?: Attack[];
  superpowers?: Superpower[];
}

export interface CharacterDraft {
  id: string;
  name?: string;
  alterEgo?: string | null;
  affiliations?: string[];
  packCode?: string | null;
  packName?: string | null;
  threat?: number;
  baseMm?: number;
  /** The alternate form's injured card image, on transforming characters. */
  altCardImage?: string | null;
  healthy?: StatBlockDraft;
  injured?: StatBlockDraft;
  /** Every source that contributed a field, in merge order. */
  sources: DraftSource[];
  /** Free-form search tags, currently only from Cerebro. */
  tags?: string[];
  /**
   * Official errata text, from Cerebro.
   *
   * Load-bearing rather than decorative: it is what explains why the printed
   * card and the current stat line differ, and the OCR extractor needs it to
   * know that a card reading 6 where we expect 7 is errata, not a misread.
   */
  errata?: string | null;
}

export type FinalizeResult =
  | { readonly ok: true; readonly character: Character }
  | { readonly ok: false; readonly id: string; readonly missing: readonly string[] };

const STAT_FIELDS = ['stamina', 'movement', 'size'] as const;

function missingFromSide(side: StatBlockDraft | undefined, label: string): string[] {
  if (!side) return [`${label} (entirely absent)`];

  const gaps = STAT_FIELDS.filter(f => side[f] === undefined).map(f => `${label}.${f}`);
  for (const d of ['physical', 'energy', 'mystic'] as const) {
    if (side.defense?.[d] === undefined) gaps.push(`${label}.defense.${d}`);
  }
  // An attackless character is almost certainly a bad parse rather than a real
  // character, so treat it as a gap rather than shipping a model that cannot act.
  if (!side.attacks || side.attacks.length === 0) gaps.push(`${label}.attacks`);
  return gaps;
}

/**
 * Promote a draft to a real Character, or report exactly what is missing.
 *
 * Reporting the gaps rather than throwing is what lets the pipeline emit a
 * partial corpus plus a worklist, instead of failing the whole import because
 * one character released after BSData stopped updating.
 */
export function finalize(draft: CharacterDraft, sources?: readonly DraftSource[]): FinalizeResult {
  const missing: string[] = [];
  if (!draft.name) missing.push('name');
  if (draft.threat === undefined) missing.push('threat');
  missing.push(...missingFromSide(draft.healthy, 'healthy'));
  missing.push(...missingFromSide(draft.injured, 'injured'));

  if (missing.length > 0) return { ok: false, id: draft.id, missing };

  const side = (s: StatBlockDraft): StatBlock => ({
    cardImage: s.cardImage ?? null,
    stamina: s.stamina as number,
    movement: s.movement as StatBlock['movement'],
    size: s.size as number,
    defense: {
      physical: s.defense?.physical as number,
      energy: s.defense?.energy as number,
      mystic: s.defense?.mystic as number,
    },
    attacks: s.attacks ?? [],
    superpowers: s.superpowers ?? [],
  });

  return {
    ok: true,
    character: {
      id: draft.id,
      name: draft.name as string,
      alterEgo: draft.alterEgo ?? null,
      affiliations: draft.affiliations ?? [],
      packCode: draft.packCode ?? null,
      packName: draft.packName ?? null,
      threat: draft.threat as number,
      baseMm: draft.baseMm ?? 40,
      // Populated later by splitForms, for the six characters that transform.
      forms: [],
      errata: draft.errata ?? null,
      healthy: side(draft.healthy as StatBlockDraft),
      injured: side(draft.injured as StatBlockDraft),
      sources: [...(sources ?? draft.sources)],
      // Nothing this pipeline produces has been checked against a printed card.
      verified: false,
    },
  };
}
