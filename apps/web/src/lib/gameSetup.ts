/**
 * Building a game the client can actually play.
 *
 * `sparringSpec` lives in the rules package, which has no access to the
 * corpus, so its models come with no card data and play as training dummies.
 * That is right for the engine's own tests — they should not need 233
 * characters to check that a move is too long — and wrong for the client,
 * where the whole point is that Spider-Man rolls what his card says.
 *
 * So the client takes the same shared opening position and attaches real
 * profiles to it. Client, server, and tests still start from literally the
 * same coordinates; only the stat blocks differ.
 *
 * TODO(#9): replaced by the players' drafted squads once squads can be taken
 * from the roster builder into a game.
 */

import { charactersById } from '@danger-room/data';
import { sparringSpec, type GameSpec } from '@danger-room/rules';

import { profileFor } from './profile.js';

/** Attach corpus profiles to every model in a spec that has a card behind it. */
export function withProfiles(spec: GameSpec): GameSpec {
  return {
    ...spec,
    models: spec.models.map(model => {
      const character = charactersById.get(model.characterId);
      // A model with no card keeps the engine's training dummy rather than
      // failing to load. The board says who it is; the stats say what it is.
      return character ? { ...model, profile: profileFor(character) } : model;
    }),
  };
}

/** The opening position, played with real card data. */
export const playableSparringSpec = (seed: number): GameSpec => withProfiles(sparringSpec(seed));
