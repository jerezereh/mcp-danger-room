/**
 * Split a transforming character into its modes.
 *
 * Six characters print four faces rather than two — Ant-Man and Wasp shrink,
 * Emma Frost turns to diamond, Ms. Marvel embiggens, the Hood is possessed,
 * Captain Marvel goes Binary. BSData flattens both modes into one character
 * and marks each ability with the mode it belongs to: "NORMAL - CHANGE SIZE",
 * "TINY - HITCH A RIDE". Read literally, Ant-Man has six superpowers, three of
 * which he cannot use.
 *
 * The prefix is the only signal, and it is not a reliable one on its own:
 * plenty of characters prefix an ability without transforming — Black Bolt's
 * "WHISPER - ", Wolverine's "WILD RAGE - ". What distinguishes a mode is the
 * presence of a NORMAL prefix, which no non-transforming character uses.
 */

import type { Character, Form, StatBlock } from '../schema.js';

/**
 * The id an alternate mode's extraction is filed under.
 *
 * An underscore, because character ids match ^[a-z0-9-]+$ and can never
 * contain one — so a form job cannot collide with a character, and splitting
 * the id back apart is exact.
 *
 * It also has to survive the Batch API, whose custom_id must match
 * ^[a-zA-Z0-9_-]{1,64}$. A '#' seemed clearer and was rejected outright, so
 * the form name is stripped to alphanumerics for the same reason.
 */
export const formJobId = (characterId: string, formName: string) =>
  `${characterId}_${formName.replace(/[^A-Za-z0-9]/g, '')}`;

/**
 * Is this extraction an alternate mode rather than a character?
 *
 * Character ids match ^[a-z0-9-]+$, so an underscore can only have come from
 * `formJobId`. Both the extractor and the importer ask this, because a form
 * record that leaks into the character merge becomes a draft with no threat,
 * fails to finalize, lands in needs-data, and gets resubmitted as paid work on
 * the next run.
 */
export const isFormExtraction = (id: string) => id.includes('_');

const PREFIX = /^([A-Z][A-Za-z' ]{2,20}) - /;
const DEFAULT_MODE = 'NORMAL';

/** Title case, so "TINY" reads as "Tiny" beside the rest of the corpus. */
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .trim();

const modeOf = (name: string) => name.match(PREFIX)?.[1];
const strip = (name: string) => name.replace(PREFIX, '');

/** The alternate mode's name, or undefined if this character does not transform. */
export function alternateMode(character: Character): string | undefined {
  const modes = new Set<string>();
  for (const side of [character.healthy, character.injured]) {
    for (const a of side.attacks) {
      const m = modeOf(a.name);
      if (m) modes.add(m);
    }
    for (const p of side.superpowers) {
      const m = modeOf(p.name);
      if (m) modes.add(m);
    }
  }
  if (!modes.has(DEFAULT_MODE)) return undefined;
  modes.delete(DEFAULT_MODE);
  // Exactly one alternate, or this is not the pattern we understand.
  return modes.size === 1 ? [...modes][0] : undefined;
}

/**
 * Keep only the abilities belonging to `mode`, with the prefix removed.
 *
 * An unprefixed ability belongs to both modes: it is printed once and applies
 * whichever face is showing.
 */
function abilitiesFor(side: StatBlock, mode: string, cardImage: string | null): StatBlock {
  const mine = (name: string) => {
    const m = modeOf(name);
    return m === undefined || m === mode;
  };
  return {
    ...side,
    cardImage,
    attacks: side.attacks.filter(a => mine(a.name)).map(a => ({ ...a, name: strip(a.name) })),
    superpowers: side.superpowers
      .filter(p => mine(p.name))
      .map(p => ({ ...p, name: strip(p.name) })),
  };
}

/**
 * Cerebro names the alternate form's injured face; the healthy one follows the
 * same pattern. Deriving it beats guessing at a second field that is not there.
 */
const healthyFrom = (injured: string | null): string | null =>
  injured ? injured.replace(/_injured(\.[a-z]+)$/i, '_healthy$1') : null;

/**
 * Rewrite a transforming character into a default mode plus its alternate.
 *
 * Returns the character unchanged when it does not transform, so this is safe
 * to run across the whole corpus.
 */
export function splitForms(character: Character, altInjuredImage: string | null): Character {
  const alternate = alternateMode(character);
  if (!alternate) return character;

  const form: Form = {
    name: titleCase(alternate),
    healthy: abilitiesFor(character.healthy, alternate, healthyFrom(altInjuredImage)),
    injured: abilitiesFor(character.injured, alternate, altInjuredImage),
  };

  return {
    ...character,
    healthy: abilitiesFor(character.healthy, DEFAULT_MODE, character.healthy.cardImage),
    injured: abilitiesFor(character.injured, DEFAULT_MODE, character.injured.cardImage),
    forms: [...character.forms, form],
  };
}

/** The stat box of one alternate mode, as the extractor read it. */
export interface FormStats {
  healthy: Pick<StatBlock, 'stamina' | 'movement' | 'size' | 'defense'>;
  injured: Pick<StatBlock, 'stamina' | 'movement' | 'size' | 'defense'>;
}

/**
 * Give each alternate mode the stat box printed on its own card.
 *
 * Splitting a transforming character divides its abilities but has nothing to
 * divide its numbers with: Cerebro carries one stamina per character and
 * BSData never separated the modes, so an alternate mode inherited the
 * default's stat box. Four of the six were wrong that way — Ant-Man shrinks to
 * Size 1 and Short movement, Ms. Marvel grows to Size 4, Emma Frost's diamond
 * form trades mystic defense for physical.
 *
 * The scan is the only record of those numbers, so they come from the
 * extractor. Only the stat box: the abilities stay as BSData split them, which
 * is a better source for rules text than a vision model reading a card.
 */
export function applyFormStats(
  character: Character,
  stats: ReadonlyMap<string, FormStats>,
): Character {
  if (character.forms.length === 0) return character;

  let used = false;
  const forms = character.forms.map(form => {
    const read = stats.get(formJobId(character.id, form.name));
    if (!read) return form;
    used = true;
    return {
      ...form,
      healthy: { ...form.healthy, ...read.healthy },
      injured: { ...form.injured, ...read.injured },
    };
  });

  return used
    ? { ...character, forms, sources: [...new Set([...character.sources, 'ocr' as const])] }
    : character;
}
