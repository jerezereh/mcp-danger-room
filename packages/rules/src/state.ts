/**
 * Game state.
 *
 * Three invariants hold everywhere in this package:
 *
 *  1. State is plain JSON. No class instances, no closures, no Maps, no Dates.
 *     It has to survive `structuredClone`, a WebSocket, and localStorage.
 *  2. State is complete. Anything the engine needs to resume mid-resolution
 *     lives here — including the continuation stack. There is no engine
 *     instance holding private fields on the side.
 *  3. State is never mutated in place by callers. The engine returns new state.
 */

import type { TerrainVolume } from './geometry/los.js';
import type { Vec3 } from './geometry/vec.js';
import type { CardId, CharacterId, ModelId, PlayerId } from './ids.js';
import type { RngState } from './rng.js';

export type ModelHealth = 'healthy' | 'injured' | 'ko';

export type ConditionKind =
  | 'bleed'
  | 'incinerate'
  | 'poison'
  | 'shock'
  | 'stagger'
  | 'stun'
  | 'slow'
  | 'root'
  | 'hex';

export interface Condition {
  readonly kind: ConditionKind;
  /** Some conditions stack; most do not. */
  readonly stacks: number;
  /** Who applied it — matters for a few interactions. */
  readonly source: ModelId | null;
}

/** A character instance on the table. */
export interface Model {
  readonly id: ModelId;
  readonly characterId: CharacterId;
  readonly owner: PlayerId;

  readonly pos: Vec3;
  /** Facing in radians. Only a few effects care, but rotation is free to store. */
  readonly facing: number;
  readonly radius: number;
  readonly height: number;

  readonly health: ModelHealth;
  readonly damage: number;
  readonly power: number;
  readonly conditions: readonly Condition[];

  /** Reset each round; drives the alternating-activation loop. */
  readonly activatedThisRound: boolean;
  /** Superpowers already used this turn, by name — many are once-per-turn. */
  readonly usedThisTurn: readonly string[];
  readonly holdingObjective: string | null;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly squad: readonly ModelId[];
  readonly victoryPoints: number;
  /** Tactic cards still in hand. */
  readonly tacticCards: readonly CardId[];
  readonly threatSpent: number;
  /** MCP's catch-up mechanic. */
  readonly hasPriority: boolean;
}

export interface ObjectiveMarker {
  readonly id: string;
  readonly pos: Vec3;
  readonly kind: 'extract' | 'secure';
  readonly heldBy: ModelId | null;
}

export type Phase =
  | 'setup'
  | 'priority'
  | 'activation'
  | 'cleanup'
  | 'finished';

/**
 * A suspended step of resolution, represented as *data* rather than a closure.
 *
 * This is the load-bearing decision in the whole engine. MCP is full of
 * interrupts — reactions that fire mid-attack, effects that modify a roll
 * already made — so resolution has to be able to pause, hand control to the
 * other player, and pick up exactly where it left off. If those continuations
 * were JavaScript closures the state would stop being serializable, and with it
 * would go replays, spectating, reconnection, and server authority.
 */
export type Frame =
  | { readonly kind: 'activation'; readonly modelId: ModelId; readonly actionsRemaining: number }
  | {
      readonly kind: 'attack';
      readonly step: AttackStep;
      readonly attackerId: ModelId;
      readonly targetId: ModelId;
      readonly attackName: string;
      readonly attackDice: number;
      readonly defenseDice: number;
      readonly successes: number | null;
    }
  | {
      readonly kind: 'reactionWindow';
      readonly window: ReactionWindow;
      readonly pendingPlayers: readonly PlayerId[];
    }
  | { readonly kind: 'applyDamage'; readonly modelId: ModelId; readonly amount: number }
  | { readonly kind: 'checkKO'; readonly modelId: ModelId };

export type AttackStep =
  | 'declare'
  | 'modifyAttackDice'
  | 'rollAttack'
  | 'modifyAttackResults'
  | 'rollDefense'
  | 'modifyDefenseResults'
  | 'compare'
  | 'applyDamage'
  | 'afterAttack';

export type ReactionWindow =
  | 'beforeAttackRoll'
  | 'afterAttackRoll'
  | 'beforeDamage'
  | 'afterAttackResolved'
  | 'onKO';

/** What the engine is currently waiting for a human (or bot) to decide. */
export type Prompt =
  | { readonly kind: 'chooseActivation'; readonly player: PlayerId; readonly options: readonly ModelId[] }
  | { readonly kind: 'chooseAction'; readonly player: PlayerId; readonly modelId: ModelId }
  | {
      readonly kind: 'declareReaction';
      readonly player: PlayerId;
      readonly window: ReactionWindow;
      readonly options: readonly { modelId: ModelId; superpower: string; cost: number }[];
    }
  | { readonly kind: 'rollPriority'; readonly players: readonly PlayerId[] };

export interface GameState {
  /** Bumped on breaking shape changes so old saves can be migrated. */
  readonly schemaVersion: number;
  readonly rng: RngState;

  readonly phase: Phase;
  readonly round: number;
  readonly turnOrder: readonly PlayerId[];
  readonly activePlayer: PlayerId | null;

  readonly players: Readonly<Record<string, PlayerState>>;
  readonly models: Readonly<Record<string, Model>>;
  readonly terrain: readonly TerrainVolume[];
  readonly objectives: readonly ObjectiveMarker[];

  /** Continuation stack. Empty means nothing is mid-resolution. */
  readonly stack: readonly Frame[];
  /** Non-null means the engine is blocked awaiting input. */
  readonly prompt: Prompt | null;

  /** Monotonic; every emitted event carries the sequence it was emitted at. */
  readonly sequence: number;
}

export const SCHEMA_VERSION = 1;

export function getModel(state: GameState, id: ModelId): Model | undefined {
  return state.models[id];
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players[id];
}

/** Models that can still be activated this round, for the given player. */
export function activatableModels(state: GameState, player: PlayerId): ModelId[] {
  return Object.values(state.models)
    .filter(m => m.owner === player && !m.activatedThisRound && m.health !== 'ko')
    .map(m => m.id);
}
