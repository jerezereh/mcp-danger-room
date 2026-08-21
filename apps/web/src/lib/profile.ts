/**
 * Corpus → engine.
 *
 * `packages/rules` imports nothing, so it cannot look a character up. Stats
 * reach it as a `CharacterProfile` supplied at setup — see `profile.ts` in the
 * rules package for why. This module is the one place that crosses from card
 * data to engine input, and it is deliberately a copy rather than a reference:
 * the profile a game is played with travels in its save, so a later correction
 * to the corpus cannot retroactively change a finished game.
 *
 * The two shapes are structurally almost identical, which is the point. What
 * this function actually does is narrow the corpus's looser types — a range of
 * `number | '*'` into the engine's `RangeBand | '*'` — and drop everything the
 * engine has no use for yet (rules text, superpowers, card images).
 */

import { reactionFor, type Character, type StatBlock } from '@danger-room/data';
import type {
  AttackProfile,
  CharacterId,
  CharacterProfile,
  RangeBand,
  StatProfile,
  SuperpowerProfile,
} from '@danger-room/rules';

const RANGE_BANDS: readonly RangeBand[] = [1, 2, 3, 4, 5];

/**
 * The corpus types range as `number | '*'` because that is what the cards
 * print. Anything outside 1–5 is a data defect rather than a rule, so it is
 * clamped into the band the tool can actually measure rather than crashing a
 * game that was otherwise fine.
 */
function toRangeBand(range: number | '*'): RangeBand | '*' {
  if (range === '*') return '*';
  return RANGE_BANDS.find(band => band === range) ?? 1;
}

function toAttack(attack: StatBlock['attacks'][number]): AttackProfile {
  return {
    name: attack.name,
    type: attack.type,
    range: toRangeBand(attack.range),
    shape: attack.shape,
    dice: attack.dice,
    cost: attack.cost,
  };
}

/**
 * Superpowers travel with their structured trigger attached, or with `null`.
 *
 * Null is the common case and it is deliberate: 200 reactive superpowers are
 * printed prose and only a handful have been written up in
 * `packages/data/src/reactions.ts`. Carrying the rest anyway means the engine
 * can say what a character *has* — and the gap stays visible instead of
 * looking like the character simply has no powers.
 */
function toSuperpower(
  characterId: string,
  power: StatBlock['superpowers'][number],
): SuperpowerProfile {
  return {
    name: power.name,
    type: power.type,
    cost: power.cost,
    reaction: power.type === 'reactive' ? reactionFor(characterId, power.name) : null,
  };
}

function toStats(characterId: string, block: StatBlock): StatProfile {
  return {
    stamina: block.stamina,
    movement: block.movement,
    size: block.size,
    defense: block.defense,
    attacks: block.attacks.map(toAttack),
    superpowers: block.superpowers.map(power => toSuperpower(characterId, power)),
  };
}

/** The engine-facing profile for a character in the corpus. */
export function profileFor(character: Character): CharacterProfile {
  return {
    characterId: character.id as CharacterId,
    name: character.name,
    baseMm: character.baseMm,
    healthy: toStats(character.id, character.healthy),
    injured: toStats(character.id, character.injured),
  };
}
