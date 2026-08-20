/**
 * Game construction.
 *
 * Kept separate from the engine so that tests, the AI, and the server can all
 * build a position directly without replaying a setup phase.
 */

import { POWER_PER_ROUND, radiusForBaseMm, SIZE_HEIGHT_INCHES } from './constants.js';
import type { TerrainVolume } from './geometry/los.js';
import { vec3, type Vec3 } from './geometry/vec.js';
import type { CharacterId, ModelId, PlayerId } from './ids.js';
import type { CharacterProfile } from './profile.js';
import { createRng } from './rng.js';
import {
  activatableModels,
  mayPassTurn,
  SCHEMA_VERSION,
  type GameState,
  type Model,
  type PlayerState,
  type Prompt,
} from './state.js';

export interface ModelSpec {
  readonly id: ModelId;
  readonly characterId: CharacterId;
  readonly owner: PlayerId;
  readonly pos: Vec3;
  /**
   * The character's printed stats. Supplied by the caller because the engine
   * cannot look one up — see `profile.ts`.
   *
   * Optional so tests and fixtures stay terse. Omitting it substitutes a
   * training dummy, which is a stand-in with no card behind it rather than a
   * real character with wrong numbers.
   */
  readonly profile?: CharacterProfile;
  /** Base diameter in mm. Defaults to the profile's. */
  readonly baseMm?: number;
  /** MCP character size 1–5. Defaults to the profile's healthy-face size. */
  readonly size?: number;
  /**
   * Power the model starts with, *before* the round-1 Power Phase adds its
   * own. A model given 3 here begins the game holding 4.
   *
   * Mainly a test affordance now that Power is generated properly: it puts a
   * character straight into a position it would otherwise take three rounds of
   * being punched to reach.
   */
  readonly power?: number;
}

export interface GameSpec {
  readonly seed: number;
  readonly players: readonly { id: PlayerId; displayName: string }[];
  readonly models: readonly ModelSpec[];
  readonly terrain?: readonly TerrainVolume[];
}

/**
 * A stand-in profile for a model with no card data behind it.
 *
 * Every placeholder stat the engine used to hardcode — 5 attack dice, 3
 * defense, stamina 6 — now lives here and nowhere else, so a game played
 * against real cards contains none of them and a game played without card data
 * says so in its own name.
 *
 * Takes the id it is standing in for, so the profile a model is played with
 * always matches the character it claims to be.
 */
export function trainingProfile(characterId: CharacterId): CharacterProfile {
  const stats = {
    stamina: 6,
    movement: 'M',
    size: 2,
    defense: { physical: 3, energy: 3, mystic: 3 },
    attacks: [{ name: 'STRIKE', type: 'physical', range: 2, shape: 'range', dice: 5, cost: 0 }],
    superpowers: [],
  } as const;

  return { characterId, name: 'Training Dummy', baseMm: 40, healthy: stats, injured: stats };
}

export function createModel(spec: ModelSpec): Model {
  const profile = spec.profile ?? trainingProfile(spec.characterId);
  const baseMm = spec.baseMm ?? profile.baseMm;
  const size = spec.size ?? profile.healthy.size;

  return {
    id: spec.id,
    characterId: spec.characterId,
    owner: spec.owner,
    pos: spec.pos,
    facing: 0,
    radius: radiusForBaseMm(baseMm),
    height: SIZE_HEIGHT_INCHES[size] ?? size,
    health: 'healthy',
    dazed: false,
    damage: 0,
    power: spec.power ?? 0,
    conditions: [],
    activatedThisRound: false,
    usedThisTurn: [],
    holdingObjective: null,
  };
}

export function createGame(spec: GameSpec): GameState {
  const players: Record<string, PlayerState> = {};
  const models: Record<string, Model> = {};
  const profiles: Record<string, CharacterProfile> = {};

  for (const p of spec.players) {
    players[p.id] = {
      id: p.id,
      displayName: p.displayName,
      squad: spec.models.filter(m => m.owner === p.id).map(m => m.id),
      victoryPoints: 0,
      tacticCards: [],
      threatSpent: 0,
      hasPriority: false,
    };
  }

  for (const m of spec.models) {
    // Round 1 opens with a Power Phase like every other round, so every
    // character is already holding its first Power by the time anybody acts.
    // Granted here rather than by the engine because `createGame` builds a
    // resting position and emits no events; the round-1 grant is therefore the
    // one that never appears in the log.
    const model = createModel(m);
    models[m.id] = { ...model, power: model.power + POWER_PER_ROUND };
    // Keyed by the *model's* characterId rather than the profile's, so a model
    // standing in for a character it has no card for still resolves. Two
    // models of the same character share one entry; if their specs disagree,
    // the last one wins, which is the only answer that keeps the map a map.
    profiles[m.characterId] = m.profile ?? trainingProfile(m.characterId);
  }

  // Priority for round 1 goes to the first player listed. Thereafter it is
  // passed at Cleanup rather than rolled for — see `passPriority`.
  //
  // TODO(verify): who holds it to begin with. It is settled during deployment,
  // which the engine does not model.
  const first = spec.players[0];
  const activePlayer = first ? first.id : null;

  if (first) players[first.id] = { ...(players[first.id] as PlayerState), hasPriority: true };

  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    rng: createRng(spec.seed),
    phase: 'activation',
    round: 1,
    turnOrder: spec.players.map(p => p.id),
    activePlayer,
    players,
    models,
    profiles,
    terrain: spec.terrain ?? [],
    objectives: [],
    lastActivatedBy: null,
    stack: [],
    prompt: null,
    sequence: 0,
  };

  // A game parks its opening prompt rather than starting blank. The client
  // reads `prompt` to find out whose turn it is and what is legal; a null one
  // means "nothing is expected of anybody", which is never true at the start
  // of a game.
  return { ...state, prompt: openingPrompt(state) };
}

function openingPrompt(state: GameState): Prompt | null {
  const player = state.activePlayer;
  if (player === null) return null;
  return {
    kind: 'chooseActivation',
    player,
    options: activatableModels(state, player),
    mayPass: mayPassTurn(state, player),
  };
}

/**
 * Terrain for the sparring position.
 *
 * Deliberately placed so at least one pairing is blocked and another is clear —
 * an empty table cannot show whether line of sight works at all.
 */
export const SPARRING_TERRAIN: TerrainVolume[] = [
  {
    id: 'crate-a',
    pos: vec3(18, 12, 0),
    radius: 1.8,
    height: 4,
    size: 3,
    blocksLineOfSight: true,
  },
  {
    id: 'wall-b',
    pos: vec3(22, 22, 0),
    radius: 2.4,
    height: 6,
    size: 4,
    blocksLineOfSight: true,
  },
  {
    id: 'rubble-c',
    pos: vec3(9, 25, 0),
    radius: 2,
    height: 1,
    size: 1,
    // Low scatter: present on the table, but never blocks a trace.
    blocksLineOfSight: false,
  },
];

/**
 * The default opening position.
 *
 * Exported as a spec rather than a built state so the client, the server, and
 * the tests all start from literally the same setup — a save produced by one
 * loads in the others.
 *
 * TODO(squads): replaced by the players' drafted squads once drafting exists.
 */
export function sparringSpec(seed = 1): GameSpec {
  return {
    seed,
    players: [
      { id: 'p1' as PlayerId, displayName: 'Player One' },
      { id: 'p2' as PlayerId, displayName: 'Player Two' },
    ],
    models: [
      {
        id: 'm1' as ModelId,
        characterId: 'amazing-spider-man' as CharacterId,
        owner: 'p1' as PlayerId,
        pos: vec3(12, 18, 0),
      },
      {
        id: 'm2' as ModelId,
        characterId: 'black-panther' as CharacterId,
        owner: 'p2' as PlayerId,
        pos: vec3(16, 18, 0),
      },
      {
        id: 'm3' as ModelId,
        characterId: 'ancient-one' as CharacterId,
        owner: 'p1' as PlayerId,
        pos: vec3(14, 8, 0),
      },
      {
        id: 'm4' as ModelId,
        characterId: 'angela' as CharacterId,
        owner: 'p2' as PlayerId,
        pos: vec3(26, 24, 0),
      },
    ],
    terrain: SPARRING_TERRAIN,
  };
}

/** A small position with terrain, used by tests and by the client's local game. */
export function createSparringGame(seed = 1): GameState {
  return createGame(sparringSpec(seed));
}
