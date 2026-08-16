/**
 * Cerebro — the community card index at api.cerebromcp.com.
 *
 * Public, unauthenticated JSON. Broad and current: every released character
 * with affiliations, threat, stamina, card image filenames and search tags.
 *
 * What it does NOT have: defenses, attacks, superpowers, or any rules text. It
 * is an index, not a rules database — so a Cerebro-only character is always an
 * incomplete draft, and the pipeline's job is to fill the rest from BSData or
 * OCR.
 *
 * Field names are Cerebro's, not ours, and are mapped once here.
 */

import type { CharacterDraft } from './draft.js';
import { slugify } from './slug.js';

export const CEREBRO_BASE = 'https://api.cerebromcp.com';

/** One record as Cerebro returns it. Only the fields we consume are typed. */
export interface CerebroCharacter {
  ID: number | string;
  Name: string;
  Alias?: string;
  Affiliations?: string;
  /** Threat — the game's only character cost. */
  Cost?: number | string;
  /** Product pack, e.g. "CP162: Abomination and Wrecking Crew". NOT a cost. */
  CP?: string;
  Card_Healthy?: string;
  Card_Injured?: string;
  front_health?: number | string;
  back_health?: number | string;
  thumbnail?: string;
  tags?: string;
  Date?: string;
}

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

/**
 * Split "CP162: Abomination and Wrecking Crew" into code and name.
 *
 * The number is a pack identifier that doubles as a character id on some
 * community sources — it is not a cost, and the schema names it accordingly.
 */
export function parsePack(cp: string | undefined): { code: string | null; name: string | null } {
  if (!cp) return { code: null, name: null };

  const match = cp.match(/^\s*([A-Za-z]+\d+)\s*:\s*(.*)$/);
  if (!match) return { code: cp.trim() || null, name: null };

  const [, code = '', name = ''] = match;
  return { code: code.trim() || null, name: name.trim() || null };
}

/**
 * Cerebro record → draft.
 *
 * `front_health`/`back_health` are the only stat fields available, so each side
 * gets a stat block carrying stamina and the card image and nothing else. That
 * is enough for the merge to attach rules text to later, and enough for the
 * OCR cross-check to have something to verify against.
 */
export function toDraft(raw: CerebroCharacter): CharacterDraft {
  const pack = parsePack(raw.CP);
  const alias = raw.Alias?.trim();

  return {
    id: slugify(raw.Name),
    name: raw.Name.trim(),
    // Cerebro repeats the name in Alias when a character has no alter ego.
    alterEgo: alias && alias !== raw.Name.trim() ? alias : null,
    affiliations: list(raw.Affiliations),
    packCode: pack.code,
    packName: pack.name,
    threat: num(raw.Cost),
    healthy: {
      cardImage: raw.Card_Healthy?.trim() || null,
      ...(num(raw.front_health) === undefined ? {} : { stamina: num(raw.front_health) }),
    },
    injured: {
      cardImage: raw.Card_Injured?.trim() || null,
      ...(num(raw.back_health) === undefined ? {} : { stamina: num(raw.back_health) }),
    },
    tags: list(raw.tags),
    sources: ['cerebro'],
  };
}

export async function fetchCerebroCharacters(
  base = CEREBRO_BASE,
): Promise<CerebroCharacter[]> {
  const response = await fetch(`${base}/characters`);
  if (!response.ok) {
    throw new Error(`Cerebro /characters returned ${response.status}`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('Cerebro /characters did not return an array.');
  return body as CerebroCharacter[];
}

/** Raw passthrough for the endpoints we store but do not yet model. */
export async function fetchCerebroRaw(endpoint: string, base = CEREBRO_BASE): Promise<unknown> {
  const response = await fetch(`${base}/${endpoint}`);
  if (!response.ok) throw new Error(`Cerebro /${endpoint} returned ${response.status}`);
  return response.json();
}
