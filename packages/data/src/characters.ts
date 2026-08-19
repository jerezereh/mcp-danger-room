/**
 * The character corpus.
 *
 * Validated at module load. A malformed card is a build-time failure rather
 * than a mystery at the table — worth the startup cost given the corpus is
 * hand-assembled over a long period.
 *
 * `characters.json` is generated — `npm run import:cards` rebuilds it from
 * Cerebro, BSData, Jarvis and the OCR extractions, then applies overrides.json
 * and house style. Do not hand-edit it; corrections go in overrides.json,
 * which is applied last and survives a re-import.
 */

import raw from './characters.json' with { type: 'json' };
import { Character, type Character as CharacterType } from './schema.js';

export const characters: CharacterType[] = Character.array().parse(raw.characters);

export const charactersById = new Map(characters.map(c => [c.id, c]));

/** Characters still awaiting a check against the physical card. */
export const unverified = characters.filter(c => !c.verified);
