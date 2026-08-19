/**
 * Jarvis' Protocol — jarvis-protocol.com.
 *
 * The most current of the three sources, and the only one that reliably
 * reflects recent errata. Where Cerebro and BSData disagree, Jarvis is the
 * tiebreak: it caught Cassandra Nova's 2026 re-errata that neither of the
 * others had, and it corrects Cerebro on characters where Cerebro is itself
 * stale (Malekith, Thor Prince of Asgard).
 *
 * What it provides: current stamina (healthy side only), all three defenses,
 * speed, size, threat, base size in mm, affiliations, and a stable slug. No
 * rules text — attacks and superpowers still come from BSData.
 *
 * ## Access
 *
 * `/api/characters` is unauthenticated but rejects requests without a
 * same-origin `Referer`. That check is a deliberate signal from the
 * maintainers that they would rather this endpoint were not scripted against,
 * so treat it accordingly:
 *
 *   - responses are cached on disk; one fetch per import run at most
 *   - a descriptive User-Agent identifies the client rather than hiding it
 *   - nothing here polls, retries aggressively, or runs on a schedule
 *
 * This is a stopgap while permission is sought. If the maintainers offer a
 * blessed feed or ask that this stop, replace or delete this file — the merge
 * treats Jarvis as optional and the pipeline degrades to Cerebro + BSData
 * without it.
 */

import type { CharacterDraft } from './draft.js';
import { slugify } from './slug.js';

export const JARVIS_BASE = 'https://www.jarvis-protocol.com';

/** One record as Jarvis returns it. Only the fields we consume are typed. */
export interface JarvisCharacter {
  id: number;
  slug: string;
  name: string;
  alterEgo?: string | null;
  /** Healthy-side stamina. The injured side is not exposed on this endpoint. */
  stamina?: number;
  speed?: string;
  size?: number;
  physicalDefense?: number;
  energyDefense?: number;
  mysticDefense?: number;
  threatLevel?: number;
  /** Base diameter in mm — no other source carries this. */
  baseSize?: number;
  affiliations?: { name?: string; slug?: string }[];
  boxSets?: string[];
  releaseDate?: string;
  isGrunt?: boolean;
}

const MOVEMENT: Record<string, 'S' | 'M' | 'L'> = { s: 'S', m: 'M', l: 'L' };

export function jarvisToDraft(raw: JarvisCharacter): CharacterDraft {
  // Kept even when it matches the name — see the note in cerebro.ts.
  const alterEgo = raw.alterEgo?.trim();
  const movement = MOVEMENT[(raw.speed ?? '').trim().toLowerCase()];

  const defense = {
    ...(raw.physicalDefense !== undefined ? { physical: raw.physicalDefense } : {}),
    ...(raw.energyDefense !== undefined ? { energy: raw.energyDefense } : {}),
    ...(raw.mysticDefense !== undefined ? { mystic: raw.mysticDefense } : {}),
  };

  // Jarvis exposes one stamina value (the healthy side), but its defenses,
  // speed and size apply to both sides, so they are attached to each.
  const shared = {
    ...(movement ? { movement } : {}),
    ...(raw.size !== undefined ? { size: raw.size } : {}),
    ...(Object.keys(defense).length > 0 ? { defense } : {}),
  };

  return {
    // Jarvis publishes its own slug; prefer it over deriving one, but fall
    // back so a record with an unexpected shape still joins.
    id: raw.slug?.trim() || slugify(raw.name),
    name: raw.name.trim(),
    alterEgo: alterEgo || null,
    affiliations: (raw.affiliations ?? [])
      .map(a => a.name?.trim())
      .filter((n): n is string => Boolean(n)),
    ...(raw.threatLevel !== undefined ? { threat: raw.threatLevel } : {}),
    ...(raw.baseSize !== undefined ? { baseMm: raw.baseSize } : {}),
    healthy: { ...shared, ...(raw.stamina !== undefined ? { stamina: raw.stamina } : {}) },
    injured: { ...shared },
    sources: ['jarvis'],
  };
}

/**
 * Fetch the character list.
 *
 * `Referer` is required or the endpoint returns 403. The User-Agent names this
 * project so the traffic is attributable rather than anonymous.
 */
export async function fetchJarvisCharacters(base = JARVIS_BASE): Promise<JarvisCharacter[]> {
  const response = await fetch(`${base}/api/characters`, {
    headers: {
      Accept: 'application/json',
      // Jarvis localizes affiliation names — without this it can return
      // "Défenseurs" and "Gardiens de la Galaxie", which match nothing in the
      // other sources and turn every character into an affiliation conflict.
      // Never rely on the server's default locale for a data import.
      'Accept-Language': 'en',
      Referer: `${base}/`,
      'User-Agent': 'mcp-danger-room card importer (github.com/jerezereh/mcp-danger-room)',
    },
  });

  if (response.status === 403) {
    throw new Error(
      'Jarvis returned 403. The endpoint requires a same-origin Referer; if this ' +
        'persists the maintainers may have tightened access — see the note at the ' +
        'top of jarvis.ts before working around it.',
    );
  }
  if (!response.ok) throw new Error(`Jarvis /api/characters returned ${response.status}`);

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('Jarvis /api/characters did not return an array.');

  // Grunts are summoned tokens (Hand Ninjas and similar), not roster
  // characters, and have no card of their own.
  return (body as JarvisCharacter[]).filter(c => !c.isGrunt);
}
