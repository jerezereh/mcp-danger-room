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
