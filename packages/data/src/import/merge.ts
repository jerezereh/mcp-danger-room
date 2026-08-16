/**
 * Merging drafts from multiple sources.
 *
 * The rule is per-field precedence, not whole-record precedence: Cerebro is
 * authoritative for identity and currency (name casing, affiliations, threat,
 * card images, pack), BSData for anything requiring rules text (defenses,
 * attacks, superpowers, movement, size). Neither source wins outright, because
 * neither is better at everything.
 *
 * Where both supply the same field and disagree, the merge records a conflict
 * rather than silently picking a winner. Those conflicts are the highest-value
 * output of the whole pipeline — they mark the records where one source is
 * stale or wrong, which is exactly where a human should look first.
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

/** Fields Cerebro owns when both sources have them. */
const CEREBRO_WINS = new Set(['name', 'alterEgo', 'affiliations', 'packCode', 'packName', 'threat']);

type Pairing = Map<string, { cerebro?: CharacterDraft; bsdata?: CharacterDraft }>;

const groupBy = (drafts: readonly CharacterDraft[]): Map<string, CharacterDraft[]> => {
  const out = new Map<string, CharacterDraft[]>();
  for (const d of drafts) out.set(d.id, [...(out.get(d.id) ?? []), d]);
  return out;
};

/**
 * Pair drafts from the two sources into merge candidates.
 *
 * The subtlety is that a character's *name* does not identify it. Both sources
 * list two characters called "Captain America" (Steve Rogers and Sam Wilson)
 * and two called "Spider-Man" (Peter Parker and Miles Morales) — distinct
 * characters with different stat lines. Keying the pairing on the name slug
 * silently dropped one of each pair.
 *
 * So: pair on the plain slug where it is unambiguous, and fall back to a
 * slug qualified by alter ego only inside a group that actually collides.
 * Qualifying everywhere would be worse — the sources spell alter egos
 * inconsistently, so it would break the join for every character whose name was
 * never ambiguous in the first place.
 */
function pairBySlug(
  cerebroDrafts: readonly CharacterDraft[],
  bsdataDrafts: readonly CharacterDraft[],
): Pairing {
  const cerebro = groupBy(cerebroDrafts);
  const bsdata = groupBy(bsdataDrafts);
  const paired: Pairing = new Map();

  for (const slug of new Set([...cerebro.keys(), ...bsdata.keys()])) {
    const cs = cerebro.get(slug) ?? [];
    const bs = bsdata.get(slug) ?? [];

    // The common case: at most one candidate per side.
    if (cs.length <= 1 && bs.length <= 1) {
      paired.set(slug, {
        ...(cs[0] ? { cerebro: cs[0] } : {}),
        ...(bs[0] ? { bsdata: bs[0] } : {}),
      });
      continue;
    }

    // Ambiguous: re-key this group by alter ego. Anything that still fails to
    // pair passes through on its own qualified id rather than being dropped.
    const qualify = (d: CharacterDraft) => qualifiedSlug(d.name ?? slug, d.alterEgo);

    for (const c of cs) {
      const key = qualify(c);
      paired.set(key, { ...(paired.get(key) ?? {}), cerebro: c });
    }
    for (const b of bs) {
      const key = qualify(b);
      paired.set(key, { ...(paired.get(key) ?? {}), bsdata: b });
    }
  }

  return paired;
}

function pick<T>(
  id: string,
  field: string,
  candidates: { source: DraftSource; value: T | undefined }[],
  conflicts: Conflict[],
): T | undefined {
  const present = candidates.filter(c => c.value !== undefined && c.value !== null);
  if (present.length === 0) return undefined;

  const first = present[0];
  if (!first) return undefined;
  if (present.length === 1) return first.value;

  // Compare structurally — affiliations are arrays, defenses are objects.
  // Case is normalized because BSData uppercases every character name; without
  // this, "ANGELA" vs "Angela" reports as a conflict on nearly every record and
  // buries the disagreements that actually mean something.
  const serialize = (v: unknown) =>
    typeof v === 'string' ? v.toLowerCase() : JSON.stringify(v);
  const disagree = present.some(c => serialize(c.value) !== serialize(first.value));

  if (disagree) {
    conflicts.push({
      id,
      field,
      values: Object.fromEntries(present.map(c => [c.source, c.value])),
    });
  }

  // Precedence applies whether or not they disagreed; ordering of `candidates`
  // encodes it, so the caller decides who leads.
  return first.value;
}

function mergeSide(
  id: string,
  label: string,
  cerebro: StatBlockDraft | undefined,
  bsdata: StatBlockDraft | undefined,
  conflicts: Conflict[],
): StatBlockDraft | undefined {
  if (!cerebro && !bsdata) return undefined;

  return {
    // Only Cerebro has image filenames.
    cardImage: cerebro?.cardImage ?? bsdata?.cardImage ?? null,
    /*
     * Stamina is the one stat both sources carry, so it is the only field that
     * genuinely cross-validates — and they disagree on most characters, almost
     * always by exactly 1 with Cerebro higher.
     *
     * That systematic offset means the two are measuring different things
     * (Cerebro's field is named `front_health`, not stamina), not that one has
     * sloppy data. BSData leads here because it is the rules-focused source and
     * because the independently hand-entered legacy corpus agreed with it
     * (Amazing Spider-Man: legacy 6, BSData 6, Cerebro 7).
     *
     * TODO(verify): confirm against a printed card which definition is Stamina.
     * Every conflict is reported, so flipping this is a one-line change.
     */
    stamina: pick(
      id,
      `${label}.stamina`,
      [
        { source: 'bsdata', value: bsdata?.stamina },
        { source: 'cerebro', value: cerebro?.stamina },
      ],
      conflicts,
    ),
    movement: bsdata?.movement ?? cerebro?.movement,
    size: bsdata?.size ?? cerebro?.size,
    defense: bsdata?.defense ?? cerebro?.defense,
    attacks: bsdata?.attacks ?? cerebro?.attacks,
    superpowers: bsdata?.superpowers ?? cerebro?.superpowers,
  };
}

/**
 * Merge Cerebro and BSData drafts, keyed by slug.
 *
 * Characters present in only one source pass through untouched — a Cerebro-only
 * record is a recent release awaiting rules text (the OCR extractor's queue),
 * and a BSData-only record is usually a compound entry like
 * "hand-ninjas-elektra-shadowland-daredevil" or a renamed character.
 */
export function mergeDrafts(
  cerebroDrafts: readonly CharacterDraft[],
  bsdataDrafts: readonly CharacterDraft[],
): MergeResult {
  const conflicts: Conflict[] = [];
  const byId = pairBySlug(cerebroDrafts, bsdataDrafts);

  const drafts: CharacterDraft[] = [];
  let matched = 0;
  const onlyIn: Record<string, number> = { cerebro: 0, bsdata: 0 };

  for (const [id, { cerebro, bsdata }] of [...byId.entries()].sort()) {
    if (cerebro && bsdata) matched++;
    else if (cerebro) onlyIn['cerebro'] = (onlyIn['cerebro'] ?? 0) + 1;
    else onlyIn['bsdata'] = (onlyIn['bsdata'] ?? 0) + 1;

    // Candidate order encodes precedence per field.
    const order = <T>(field: string, c: T | undefined, b: T | undefined) =>
      pick(
        id,
        field,
        CEREBRO_WINS.has(field)
          ? [
              { source: 'cerebro' as DraftSource, value: c },
              { source: 'bsdata' as DraftSource, value: b },
            ]
          : [
              { source: 'bsdata' as DraftSource, value: b },
              { source: 'cerebro' as DraftSource, value: c },
            ],
        conflicts,
      );

    drafts.push({
      id,
      name: order('name', cerebro?.name, bsdata?.name),
      alterEgo: order('alterEgo', cerebro?.alterEgo, bsdata?.alterEgo) ?? null,
      affiliations: order('affiliations', cerebro?.affiliations, bsdata?.affiliations) ?? [],
      packCode: cerebro?.packCode ?? null,
      packName: cerebro?.packName ?? null,
      threat: order('threat', cerebro?.threat, bsdata?.threat),
      healthy: mergeSide(id, 'healthy', cerebro?.healthy, bsdata?.healthy, conflicts),
      injured: mergeSide(id, 'injured', cerebro?.injured, bsdata?.injured, conflicts),
      ...(cerebro?.tags ? { tags: cerebro.tags } : {}),
      sources: [...(cerebro ? (['cerebro'] as const) : []), ...(bsdata ? (['bsdata'] as const) : [])],
    });
  }

  return {
    drafts,
    conflicts,
    stats: { total: drafts.length, matched, onlyIn },
  };
}
