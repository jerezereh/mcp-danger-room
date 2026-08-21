/**
 * Structured triggers for reactive superpowers.
 *
 * MCP superpowers are natural language. The corpus stores what the card prints
 * — *"When this character is targeted by a {PHYS} or {ENRG} attack, it may use
 * this superpower. Add two dice to this character's defense roll against that
 * attack."* — and there are 200 reactive ones, no two worded quite alike. No
 * parser turns that into rules reliably, and one that half-works is worse than
 * none, because a superpower that fires at the wrong moment is a wrong game
 * rather than a missing feature.
 *
 * So the structure is written by hand, here, and matched to the printed text
 * by character and name. The engine is given the result at setup, exactly as
 * it is given stats — see `profile.ts` in the rules package.
 *
 * ## The rule for adding an entry
 *
 * **The entry must express the superpower's *entire* printed effect.** If a
 * power adds dice *and* prevents the target being pushed, and `ReactionEffect`
 * cannot say the second part, it does not belong here yet. A power with no
 * entry is still carried on the profile and shown to the player; it is simply
 * never offered, which reads as "not implemented" rather than as a rule that
 * quietly does half of what the card says.
 *
 * The nine below were found by matching the full text of every reactive
 * superpower in the corpus against the one shape the effect union can
 * currently express, then checked by eye. Everything else is deliberately
 * absent. Widening `ReactionEffect` is what unlocks the next family.
 */

import type { ReactionProfile } from '@danger-room/rules';

/** Structured triggers for one character, keyed by the superpower's printed name. */
export type CharacterReactions = Readonly<Record<string, ReactionProfile>>;

/**
 * "Add N dice to this character's defense roll against that attack."
 *
 * `damageTypes` empty means the printed trigger has no type gate.
 */
const defensiveShield = (
  count: number,
  damageTypes: ReactionProfile['damageTypes'] = [],
): ReactionProfile => ({
  timing: 'targeted',
  role: 'target',
  damageTypes,
  effect: { kind: 'addDefenseDice', count },
});

const PHYSICAL_OR_ENERGY = ['physical', 'energy'] as const;

/**
 * Every superpower the engine currently knows how to run.
 *
 * Keyed by character id, then by the superpower's name exactly as the corpus
 * records it — including its oddities. Two are worth knowing about, because
 * they look like bugs and are faithful transcriptions of a defective source:
 * Black Panther's power is recorded as "VIBRANIUM ARMOR - Injured" on *both*
 * faces, and Colossus's as "BOZHE MOI - Healthy" on both. Correcting those
 * belongs in the corpus (`overrides.json`), not here — if the name is fixed
 * there, this table has to follow.
 */
export const REACTIONS: Readonly<Record<string, CharacterReactions>> = {
  'black-bolt': {
    'ANTI-GRAVITON FIELD': defensiveShield(2),
  },
  'black-panther': {
    'VIBRANIUM ARMOR - Injured': defensiveShield(2, PHYSICAL_OR_ENERGY),
  },
  'captain-america-first-avenger': {
    'PERFECT BLOCK': defensiveShield(2),
  },
  'captain-america-sam-wilson': {
    'VIBRANIUM SHIELD': defensiveShield(2, PHYSICAL_OR_ENERGY),
  },
  'captain-america-steve-rogers': {
    'VIBRANIUM SHIELD': defensiveShield(2, PHYSICAL_OR_ENERGY),
  },
  colossus: {
    'BOZHE MOI - Healthy': defensiveShield(2, PHYSICAL_OR_ENERGY),
  },
  quasar: {
    'Force Field': defensiveShield(2, PHYSICAL_OR_ENERGY),
  },
  shocker: {
    'VIBRATIONAL SHIELD': defensiveShield(2, PHYSICAL_OR_ENERGY),
  },
  'steve-rogers-captain-america': {
    'VIBRANIUM SHIELD': defensiveShield(2, PHYSICAL_OR_ENERGY),
  },
};

/** The structured trigger for a superpower, or null if none is written yet. */
export function reactionFor(characterId: string, superpowerName: string): ReactionProfile | null {
  return REACTIONS[characterId]?.[superpowerName] ?? null;
}

/** How many superpowers have a structured trigger. Reported by the defect scan. */
export const implementedReactionCount = Object.values(REACTIONS).reduce(
  (total, powers) => total + Object.keys(powers).length,
  0,
);
