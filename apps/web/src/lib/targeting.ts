/**
 * Who the attack being aimed can currently reach.
 *
 * A hint for the eye, not a ruling. It calls the engine's own `edgeDistance`
 * and `hasLineOfSight`, and the engine is still asked when the click lands —
 * so if the two ever disagree, the highlight is wrong and the refusal is
 * right. `docs/ARCHITECTURE.md` §8 is explicit that game state belongs to the
 * engine; this is presentation computed from it, not a second opinion about
 * the rules.
 */

import {
  edgeDistance,
  hasLineOfSight,
  RANGE_INCHES,
  statsAt,
  type GameState,
  type Model,
  type ModelId,
  type RangeBand,
} from '@danger-room/rules';

/** Enemies of `attacker` that `attackName` can reach right now. */
export function targetableBy(
  state: GameState,
  attacker: Model | null,
  attackName: string | null,
): Set<ModelId> {
  if (!attacker || !attackName) return new Set();

  const profile = state.profiles[attacker.characterId];
  if (!profile) return new Set();

  const attack = statsAt(profile, attacker.health).attacks.find(a => a.name === attackName);
  // Beam and Area attacks resolve against a different set of targets and the
  // engine refuses them, so highlighting anything for one would be a lie.
  if (!attack || attack.shape !== 'range' || attack.range === '*') return new Set();

  const reach = RANGE_INCHES[attack.range as RangeBand];

  return new Set(
    Object.values(state.models)
      .filter(
        other =>
          other.owner !== attacker.owner &&
          other.health !== 'ko' &&
          // "A character with a Dazed token ... can't be targeted by attacks."
          !other.dazed &&
          edgeDistance(attacker, other) <= reach &&
          hasLineOfSight(attacker, other, state.terrain).clear,
      )
      .map(model => model.id),
  );
}
