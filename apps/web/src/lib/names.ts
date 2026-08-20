/**
 * Naming things in text a person reads.
 *
 * The engine deals in ids — `m1`, `p2` — and correctly so: an event is a wire
 * format and a `ModelId` is what identifies a model. Turning one into
 * "Amazing Spider-Man (P1)" needs the current `GameState` and a decision about
 * how it should read, neither of which belongs in the engine. This lives in
 * the client because both things that need it are here: the in-game log and
 * the demo narrator.
 *
 * Names come from the profile the game is actually being played with, not from
 * a second copy stored on the model. One string, one source. A model whose
 * profile is a training dummy reads as a training dummy, which is ugly and
 * true — it is playing generic stats and saying otherwise would be the same
 * confident-wrong-answer failure as a placeholder stat block.
 */

import { getProfile, type GameState, type ModelId, type PlayerId } from '@danger-room/rules';

/** A model's printed name, falling back to its id when nothing is known. */
export function nameOf(state: GameState, id: ModelId): string {
  const model = state.models[id];
  if (!model) return id;
  return getProfile(state, model)?.name ?? model.characterId;
}

/** A player's display name, falling back to its id. */
export function playerOf(state: GameState, id: PlayerId): string {
  return state.players[id]?.displayName ?? id;
}

/**
 * Which side a player is, as the short tag a log line can carry.
 *
 * Taken from turn order rather than from the id, so it stays right whatever
 * the players are called.
 */
export function sideOf(state: GameState, id: PlayerId): string {
  const index = state.turnOrder.indexOf(id);
  return index < 0 ? '?' : `P${index + 1}`;
}

/**
 * A model as a log line should name it: "Amazing Spider-Man (P1)".
 *
 * The side tag is what makes the log readable when both players field the same
 * character, which is legal and not unusual.
 *
 * It is *not* enough on its own. Two characters print an innate superpower
 * letting a player take two of them — Prime Sentinel's "Bastion's Legion" and
 * Sentinel MK4's "MASTER MOLD", both reading "when building a Roster or a
 * Squad, a player may include 2 of this character instead of the normal 1" —
 * so two models with the same name on the *same* side are legal. An earlier
 * version of this function assumed they were not, on the strength of
 * `validateSquad` rejecting duplicates, which is itself the bug (#29).
 *
 * So the ordinal appears only when a name is genuinely ambiguous for a side,
 * which keeps every ordinary line clean and makes the rare one readable.
 */
export function labelOf(state: GameState, id: ModelId): string {
  const model = state.models[id];
  if (!model) return id;

  const name = nameOf(state, id);
  const side = sideOf(state, model.owner);

  const namesakes = Object.values(state.models).filter(
    other => other.owner === model.owner && nameOf(state, other.id) === name,
  );
  if (namesakes.length <= 1) return `${name} (${side})`;

  return `${name} #${namesakes.findIndex(other => other.id === id) + 1} (${side})`;
}
