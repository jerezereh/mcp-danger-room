/**
 * Character profiles — printed card stats, as the engine sees them.
 *
 * The engine cannot look a character up. `packages/rules` imports nothing, so
 * it has no access to the corpus (see docs/ARCHITECTURE.md §6) and a profile
 * has to be *passed in at setup* rather than resolved at resolution time.
 *
 * Consequences, all of them wanted:
 *
 *  - `applyAction` keeps its two-argument signature. No call site, no server,
 *    and no future AI worker has to carry a copy of the corpus around.
 *  - State stays self-contained and serializable.
 *  - A save keeps replaying correctly after a corpus correction changes a
 *    character's printed stats, because the profile the game was actually
 *    played with travels in the save. `persistence.ts` stores the `GameSpec`,
 *    and the profiles are part of it.
 *
 * The cost is duplication between corpus and state, and larger saves. That is
 * the trade being accepted; the alternative — `applyAction(state, action,
 * cards)` — avoids the duplication but makes every replay depend on which
 * version of the corpus is installed.
 *
 * These types deliberately mirror `@danger-room/data`'s `StatBlock` without
 * importing it. They are structurally compatible, so the mapping is a copy;
 * they are declared separately because the dependency may not point that way.
 */

import type { MovementTemplate } from './constants.js';
import type { RangeBand } from './geometry/measure.js';
import type { CharacterId } from './ids.js';

export type DamageType = 'physical' | 'energy' | 'mystic';

/**
 * A printed power cost. Almost always a number, but some profiles print "X" —
 * the player chooses how much Power to spend and the rules text supplies the
 * bound. There is no numeric value to store, and flattening it to 0 would make
 * those free.
 */
export type PowerCost = number | 'X';

/**
 * How an attack is delivered. Cards print this as a prefix on the range value:
 * bare "4" is an ordinary attack, "B4" a Beam, "A2" an Area. The three resolve
 * against different sets of targets, so the prefix is a rule, not decoration.
 *
 * Only 'range' is implemented. Beam and Area are accepted into the profile so
 * the data is not lossy, and rejected at declaration.
 */
export type AttackShape = 'range' | 'beam' | 'area';

export interface AttackProfile {
  readonly name: string;
  /** Which of the target's three defense stats this attack is rolled against. */
  readonly type: DamageType;
  /** Range band 1–5, or '*' for the rare Area attack whose text defines it. */
  readonly range: RangeBand | '*';
  readonly shape: AttackShape;
  /** Dice in the attack pool. */
  readonly dice: number;
  readonly cost: PowerCost;
}

/**
 * When a reaction may interrupt, named after the step of the attack sequence
 * it sits in. See issue #5 for the sequence as printed.
 *
 * These are the *windows the engine opens*. Which superpowers may be used in
 * one is decided by the superpower's own `ReactionProfile`.
 */
export type ReactionTiming =
  /** Step 2 — "when a character has been targeted by an attack". */
  | 'targeted'
  /** Step 9 — "each character may use ... effects to reroll or change dice". */
  | 'modifyDice'
  /** Step 11 — "effects that occur before Damage". */
  | 'beforeDamage'
  /** Step 14 — "effects that occur after an attack". */
  | 'afterAttack';

/**
 * What using a reaction actually does.
 *
 * A deliberately small union. MCP superpowers are natural language and there
 * are two hundred reactive ones; the point is not to cover them but to prove
 * the frame architecture carries a real one end to end, then grow the union
 * one printed effect at a time. Anything not expressible here is left with no
 * `ReactionProfile` and is never offered.
 *
 * The next variant is almost certainly a reroll, since step 9 of the attack
 * sequence is entirely about rerolling and changing dice (#12). Whatever
 * implements it must consult `isRerollable` in `dice.ts`: a Failure cannot be
 * rerolled, and 40 superpowers in the corpus reroll something.
 */
export type ReactionEffect =
  | { readonly kind: 'addDefenseDice'; readonly count: number }
  | { readonly kind: 'addAttackDice'; readonly count: number };

/**
 * The structured trigger for a reactive superpower.
 *
 * Hand-authored rather than parsed. The corpus stores triggers as printed
 * prose — "When this character is targeted by a {PHYS} or {ENRG} attack, it
 * may use this superpower" — and no amount of pattern matching turns two
 * hundred of those into reliable rules. So a human writes the structure, the
 * corpus keeps the text, and the two are matched by name.
 */
export interface ReactionProfile {
  readonly timing: ReactionTiming;
  /** Whose part in the attack lets this fire. */
  readonly role: 'target' | 'attacker';
  /**
   * Fires only against these damage types. Empty means any type.
   *
   * This exists because the single most common printed trigger is gated on
   * exactly this — "targeted by a {PHYS} or {ENRG} attack" — and a reaction
   * offered against the wrong damage type is a wrong rule, not a rough edge.
   */
  readonly damageTypes: readonly DamageType[];
  readonly effect: ReactionEffect;
}

export type SuperpowerType = 'active' | 'reactive' | 'innate' | 'leadership';

export interface SuperpowerProfile {
  readonly name: string;
  readonly type: SuperpowerType;
  readonly cost: PowerCost;
  /**
   * Null when nothing structured is known for this superpower — which is the
   * overwhelming majority. It is carried anyway so the engine can say what a
   * character *has*, and so the gap is visible rather than silent.
   */
  readonly reaction: ReactionProfile | null;
}

/** One side of a character card: the stats that apply at one health state. */
export interface StatProfile {
  readonly stamina: number;
  readonly movement: MovementTemplate;
  /** Size class 1–5. 5 is real and rare — Dormammu and two Sentinel variants. */
  readonly size: number;
  readonly defense: Readonly<Record<DamageType, number>>;
  readonly attacks: readonly AttackProfile[];
  readonly superpowers: readonly SuperpowerProfile[];
}

/**
 * A character's full printed profile.
 *
 * Healthy and injured are genuinely different stat blocks — different stamina,
 * often different defense, sometimes different attacks — so both travel and
 * the engine reads the one matching the model's current health.
 */
export interface CharacterProfile {
  readonly characterId: CharacterId;
  readonly name: string;
  /** Base diameter in mm. Drives the model's radius, which range measures from. */
  readonly baseMm: number;
  readonly healthy: StatProfile;
  readonly injured: StatProfile;
}

/** The stat block in force for a model at the given health state. */
export function statsAt(
  profile: CharacterProfile,
  health: 'healthy' | 'injured' | 'ko',
): StatProfile {
  return health === 'healthy' ? profile.healthy : profile.injured;
}

/** Find a named attack on a stat block. Names are matched exactly as printed. */
export function findAttack(stats: StatProfile, name: string): AttackProfile | undefined {
  return stats.attacks.find(a => a.name === name);
}

/** Find a named superpower on a stat block. */
export function findSuperpower(stats: StatProfile, name: string): SuperpowerProfile | undefined {
  return stats.superpowers.find(s => s.name === name);
}

/**
 * Reactive superpowers on this stat block that could fire in the given window.
 *
 * Structure only — this answers "does this power trigger here at all", not
 * "can this model afford it" or "is it the right model". Those need state and
 * belong in the engine.
 */
export function reactionsFor(
  stats: StatProfile,
  timing: ReactionTiming,
  role: ReactionProfile['role'],
  damageType: DamageType,
): SuperpowerProfile[] {
  return stats.superpowers.filter(power => {
    const reaction = power.reaction;
    if (!reaction) return false;
    if (reaction.timing !== timing || reaction.role !== role) return false;
    return reaction.damageTypes.length === 0 || reaction.damageTypes.includes(damageType);
  });
}
