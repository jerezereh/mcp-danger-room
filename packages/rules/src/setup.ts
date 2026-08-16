/**
 * Game construction.
 *
 * Kept separate from the engine so that tests, the AI, and the server can all
 * build a position directly without replaying a setup phase.
 */

import { BASE_RADIUS_INCHES, SIZE_HEIGHT_INCHES } from './constants.js';
import type { TerrainVolume } from './geometry/los.js';
import { vec3, type Vec3 } from './geometry/vec.js';
import type { CharacterId, ModelId, PlayerId } from './ids.js';
import { createRng } from './rng.js';
import { SCHEMA_VERSION, type GameState, type Model, type PlayerState } from './state.js';

export interface ModelSpec {
  readonly id: ModelId;
  readonly characterId: CharacterId;
  readonly owner: PlayerId;
  readonly pos: Vec3;
  /** Base diameter in mm; defaults to 40mm. */
  readonly baseMm?: number;
  /** MCP character size 1–4; defaults to 2. */
  readonly size?: number;
}

export interface GameSpec {
  readonly seed: number;
  readonly players: readonly { id: PlayerId; displayName: string }[];
  readonly models: readonly ModelSpec[];
  readonly terrain?: readonly TerrainVolume[];
}

export function createModel(spec: ModelSpec): Model {
  const baseMm = spec.baseMm ?? 40;
  const size = spec.size ?? 2;

  return {
    id: spec.id,
    characterId: spec.characterId,
    owner: spec.owner,
    pos: spec.pos,
    facing: 0,
    radius: BASE_RADIUS_INCHES[baseMm] ?? 0.79,
    height: SIZE_HEIGHT_INCHES[size] ?? 2,
    health: 'healthy',
    damage: 0,
    power: 0,
    conditions: [],
    activatedThisRound: false,
    usedThisTurn: [],
    holdingObjective: null,
  };
}

export function createGame(spec: GameSpec): GameState {
  const players: Record<string, PlayerState> = {};
  const models: Record<string, Model> = {};

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
    models[m.id] = createModel(m);
  }

  const first = spec.players[0];

  return {
    schemaVersion: SCHEMA_VERSION,
    rng: createRng(spec.seed),
    phase: 'activation',
    round: 1,
    turnOrder: spec.players.map(p => p.id),
    activePlayer: first ? first.id : null,
    players,
    models,
    terrain: spec.terrain ?? [],
    objectives: [],
    stack: [],
    prompt: null,
    sequence: 0,
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
