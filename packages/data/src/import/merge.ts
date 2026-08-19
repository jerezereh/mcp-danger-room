/**
 * Merging drafts from multiple sources.
 *
 * The rule is per-field precedence, not per-record: no source is best at
 * everything, so each field takes the source that is actually authoritative
 * for it.
 *
 *   Jarvis   current stats — stamina (healthy), defenses, speed, size, threat,
 *            base size, affiliations. The most current source, and the only one
 *            that reliably reflects recent errata.
 *   Cerebro  injured stamina, card image filenames, pack code, errata text.
 *   BSData   attacks and superpowers. The only source with rules text, and
 *            frozen since late 2024, so it loses every stat contest.
 *
 * Where two sources both supply a field and disagree, the merge records a
 * conflict rather than silently picking a winner. Those conflicts are the
 * highest-value output of the pipeline — they mark where a source is stale or
 * wrong, which is where a human should look first.
 */

import type { CharacterDraft, DraftSource, StatBlockDraft } from './draft.js';
import { qualifiedSlug } from './slug.js';

export interface Conflict {
  readonly id: string;
  readonly field: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface MergeResult {
  readonly drafts: CharacterDraft[];
  readonly conflicts: Conflict[];
  readonly stats: {
    readonly total: number;
    readonly matched: number;
    readonly onlyIn: Readonly<Record<string, number>>;
  };
}

export interface MergeInputs {
  readonly cerebro?: readonly CharacterDraft[];
  readonly bsdata?: readonly CharacterDraft[];
  readonly jarvis?: readonly CharacterDraft[];
  readonly ocr?: readonly CharacterDraft[];
}

type Slot = {
  cerebro?: CharacterDraft;
  bsdata?: CharacterDraft;
  jarvis?: CharacterDraft;
  ocr?: CharacterDraft;
};
type Pairing = Map<string, Slot>;

const groupBy = (drafts: readonly CharacterDraft[]): Map<string, CharacterDraft[]> => {
  const out = new Map<string, CharacterDraft[]>();
  for (const d of drafts) out.set(d.id, [...(out.get(d.id) ?? []), d]);
  return out;
};

/**
 * Pair drafts from every source into merge candidates.
 *
 * The subtlety is that a character's *name* does not identify it. The sources
 * list two characters called "Captain America" (Steve Rogers and Sam Wilson)
 * and two called "Spider-Man" (Peter Parker and Miles Morales) — distinct
 * characters with different stat lines. Keying on the name slug silently
 * dropped one of each pair.
 *
 * So: pair on the plain slug where it is unambiguous, and fall back to a slug
 * qualified by alter ego only inside a group that actually collides.
 * Qualifying everywhere would be worse — the sources spell alter egos
 * inconsistently, so it would break the join for everyone else.
 */
function pairBySlug(inputs: MergeInputs): Pairing {
  const grouped: [keyof Slot, Map<string, CharacterDraft[]>][] = [
    ['cerebro', groupBy(inputs.cerebro ?? [])],
    ['bsdata', groupBy(inputs.bsdata ?? [])],
    ['jarvis', groupBy(inputs.jarvis ?? [])],
    ['ocr', groupBy(inputs.ocr ?? [])],
  ];

  const slugs = new Set(grouped.flatMap(([, g]) => [...g.keys()]));
  const paired: Pairing = new Map();

  for (const slug of slugs) {
    const candidates = grouped.map(([source, g]) => [source, g.get(slug) ?? []] as const);
    const ambiguous = candidates.some(([, list]) => list.length > 1);

    if (!ambiguous) {
      /*
       * Merge rather than assign. Jarvis publishes slugs that are *already*
       * qualified ("captain-america-sam-wilson"), while Cerebro and BSData
       * produce the bare "captain-america" and only get qualified when they
       * collide. Those two land on the same key from different iterations of
       * this loop, so overwriting here silently discarded whichever arrived
       * first — splitting one character into two half-records.
       */
      const slot: Slot = { ...(paired.get(slug) ?? {}) };
      for (const [source, list] of candidates) if (list[0]) slot[source] = list[0];
      paired.set(slug, slot);
      continue;
    }

    // Ambiguous: re-key this group by alter ego. Anything that still fails to
    // pair passes through on its own qualified id rather than being dropped.
    for (const [source, list] of candidates) {
      for (const d of list) {
        const key = qualifiedSlug(d.name ?? slug, d.alterEgo);
        paired.set(key, { ...(paired.get(key) ?? {}), [source]: d });
      }
    }
  }

  return paired;
}

/**
 * Take the first source that has a value, recording a conflict if the others
 * disagree.
 *
 * `candidates` is in precedence order — the caller decides who wins, and the
 * winner is returned whether or not there was a disagreement.
 */
function pick<T>(
  id: string,
  field: string,
  candidates: { source: DraftSource; value: T | undefined }[],
  conflicts: Conflict[],
): T | undefined {
  const present = candidates.filter(c => c.value !== undefined && c.value !== null);
  const first = present[0];
  if (!first) return undefined;
  if (present.length === 1) return first.value;

  /*
   * Compare by meaning, not representation. Three normalizations, each for a
   * difference that is real in the data but carries no information:
   *
   *  - case, because BSData uppercases every character name
   *  - array order, because the sources list affiliations in different orders
   *    ("Web Warriors, Defenders" vs "Defenders, Web Warriors")
   *  - nothing else — a genuine difference in content still reports.
   *
   * Without these, nearly every record conflicts and the disagreements that
   * matter are impossible to find.
   */
  const serialize = (v: unknown): string => {
    if (typeof v === 'string') return v.toLowerCase();
    if (Array.isArray(v)) return JSON.stringify([...v].map(serialize).sort());
    return JSON.stringify(v);
  };
  if (present.some(c => serialize(c.value) !== serialize(first.value))) {
    conflicts.push({
      id,
      field,
      values: Object.fromEntries(present.map(c => [c.source, c.value])),
    });
  }

  return first.value;
}

/** Does this character's errata text mention a stamina change? */
const mentionsStamina = (errata: string | null | undefined): boolean =>
  /stamina/i.test(errata ?? '');

/**
 * Stamina, in precedence order Jarvis → Cerebro → BSData.
 *
 * Jarvis leads because it tracks errata most closely; Cerebro is next and is
 * the only source for the *injured* value (Jarvis exposes healthy only);
 * BSData, frozen since 2024, is a last resort.
 *
 * Two special cases:
 *  - Cerebro reports `0` for single-sided cards (Hulk, Apocalypse, Omega
 *    Sentinel, The Immortal Hulk, Weapon X). Taken literally that fails schema
 *    validation and drops those characters entirely, so it is read as absent.
 *  - A difference that a stamina errata explains is expected, not a defect, and
 *    is not reported.
 */
function pickStamina(
  id: string,
  label: string,
  values: { jarvis?: number; cerebro?: number; bsdata?: number; ocr?: number },
  hasStaminaErrata: boolean,
  conflicts: Conflict[],
): number | undefined {
  const usable = (n: number | undefined) => (n !== undefined && n > 0 ? n : undefined);

  const ordered: { source: DraftSource; value: number | undefined }[] = [
    { source: 'jarvis', value: usable(values.jarvis) },
    { source: 'cerebro', value: usable(values.cerebro) },
    { source: 'bsdata', value: usable(values.bsdata) },
    { source: 'ocr', value: usable(values.ocr) },
  ];

  const present = ordered.filter(c => c.value !== undefined);
  const winner = present[0]?.value;
  if (winner === undefined) return undefined;

  if (!hasStaminaErrata && present.some(c => c.value !== winner)) {
    conflicts.push({
      id,
      field: `${label}.stamina`,
      values: {
        ...Object.fromEntries(present.map(c => [c.source, c.value])),
        note: 'differs with no stamina errata to explain it — one source is wrong',
      },
    });
  }

  return winner;
}

function mergeSide(
  id: string,
  label: string,
  slot: Slot,
  side: 'healthy' | 'injured',
  hasStaminaErrata: boolean,
  conflicts: Conflict[],
): StatBlockDraft | undefined {
  const c = slot.cerebro?.[side];
  const b = slot.bsdata?.[side];
  const j = slot.jarvis?.[side];
  const o = slot.ocr?.[side];
  if (!c && !b && !j && !o) return undefined;

  return {
    // Only Cerebro carries image filenames.
    cardImage: c?.cardImage ?? b?.cardImage ?? null,
    /*
     * OCR is last everywhere. It reads the physical card and is therefore
     * blind to errata, and it is the only source that can hallucinate — so it
     * fills gaps and never overrides a curated source.
     */
    stamina: pickStamina(
      id,
      label,
      { jarvis: j?.stamina, cerebro: c?.stamina, bsdata: b?.stamina, ocr: o?.stamina },
      hasStaminaErrata,
      conflicts,
    ),
    movement: j?.movement ?? b?.movement ?? c?.movement ?? o?.movement,
    size: j?.size ?? b?.size ?? c?.size ?? o?.size,
    defense: j?.defense ?? b?.defense ?? c?.defense ?? o?.defense,
    // BSData is the curated rules text; OCR covers the characters it predates.
    attacks: b?.attacks ?? o?.attacks ?? c?.attacks,
    superpowers: b?.superpowers ?? o?.superpowers ?? c?.superpowers,
  };
}

/**
 * Merge drafts from every available source, keyed by slug.
 *
 * Sources are optional: dropping Jarvis degrades the pipeline to Cerebro +
 * BSData rather than breaking it, which matters because Jarvis access is
 * provisional.
 *
 * Characters present in only one source pass through untouched — a
 * Cerebro-only record is a recent release awaiting rules text (the OCR
 * extractor's queue), and a BSData-only record is usually a compound entry
 * like "hand-ninjas-elektra-shadowland-daredevil".
 */
export function mergeDrafts(inputs: MergeInputs): MergeResult {
  const conflicts: Conflict[] = [];
  const paired = pairBySlug(inputs);

  const drafts: CharacterDraft[] = [];
  let matched = 0;
  const onlyIn: Record<string, number> = { cerebro: 0, bsdata: 0, jarvis: 0, ocr: 0 };

  for (const [id, slot] of [...paired.entries()].sort()) {
    const sources = (['cerebro', 'bsdata', 'jarvis', 'ocr'] as const).filter(s => slot[s]);
    if (sources.length > 1) matched++;
    else if (sources[0]) onlyIn[sources[0]] = (onlyIn[sources[0]] ?? 0) + 1;

    const { cerebro, bsdata, jarvis } = slot;
    const staminaErrata = mentionsStamina(cerebro?.errata);

    /** Highest-precedence-first for fields where currency matters most. */
    const current = <T>(field: string, get: (d: CharacterDraft) => T | undefined) =>
      pick(
        id,
        field,
        [
          { source: 'jarvis' as DraftSource, value: jarvis ? get(jarvis) : undefined },
          { source: 'cerebro' as DraftSource, value: cerebro ? get(cerebro) : undefined },
          { source: 'bsdata' as DraftSource, value: bsdata ? get(bsdata) : undefined },
        ],
        conflicts,
      );

    drafts.push({
      id,
      // Cerebro and Jarvis both use proper casing; BSData uppercases.
      name: cerebro?.name ?? jarvis?.name ?? bsdata?.name ?? slot.ocr?.name,
      alterEgo:
        cerebro?.alterEgo ?? jarvis?.alterEgo ?? bsdata?.alterEgo ?? slot.ocr?.alterEgo ?? null,
      /*
       * Affiliations come from Jarvis or Cerebro only. BSData is excluded
       * because it is both stale (missing affiliations added after 2024) and
       * differently granular — it splits "Servants of the Apocalypse" into
       * per-Horseman entries that no other source has. Including it would
       * report a conflict on most characters and change nothing.
       */
      affiliations:
        pick(
          id,
          'affiliations',
          [
            { source: 'jarvis' as DraftSource, value: jarvis?.affiliations },
            { source: 'cerebro' as DraftSource, value: cerebro?.affiliations },
          ],
          conflicts,
        ) ??
        bsdata?.affiliations ??
        [],
      packCode: cerebro?.packCode ?? null,
      packName: cerebro?.packName ?? null,
      threat: current('threat', d => d.threat),
      ...(jarvis?.baseMm !== undefined ? { baseMm: jarvis.baseMm } : {}),
      healthy: mergeSide(id, 'healthy', slot, 'healthy', staminaErrata, conflicts),
      injured: mergeSide(id, 'injured', slot, 'injured', staminaErrata, conflicts),
      ...(cerebro?.errata ? { errata: cerebro.errata } : {}),
      ...(cerebro?.altCardImage ? { altCardImage: cerebro.altCardImage } : {}),
      ...(cerebro?.tags ? { tags: cerebro.tags } : {}),
      sources: [...sources],
    });
  }

  return { drafts, conflicts, stats: { total: drafts.length, matched, onlyIn } };
}
