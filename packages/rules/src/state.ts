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

import type { DieFace } from './dice.js';
import type { TerrainVolume } from './geometry/los.js';
import type { Vec3 } from './geometry/vec.js';
import type { CardId, CharacterId, ModelId, PlayerId } from './ids.js';
import type {
  CharacterProfile,
  DamageType,
  ReactionTiming,
  StatProfile,
} from './profile.js';
import { statsAt } from './profile.js';
import type { RngState } from './rng.js';

/**
 * Which side of the Stat Card a character is on.
 *
 * Deliberately *not* where Dazed lives. Being Dazed and being on the Injured
 * side are two different things that the engine used to collapse into one: a
 * character whose damage reaches its Stamina becomes **Dazed**, keeps its
 * damage and its healthy stat card, and only flips to Injured during the
 * Cleanup Phase. Flipping immediately gave it the injured card's stats — often
 * a different Stamina and different attacks — for the rest of the round.
 */
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
  readonly characterName: string;
  readonly owner: PlayerId;

  readonly pos: Vec3;
  /** Facing in radians. Only a few effects care, but rotation is free to store. */
  readonly facing: number;
  readonly radius: number;
  readonly height: number;

  readonly health: ModelHealth;
  /**
   * Dazed: out for the rest of the Round, and flipped at Cleanup.
   *
   * A Dazed character cannot be activated, does not contribute to scoring,
   * and keeps its damage until the Cleanup Phase clears it. Orthogonal to
   * `health`, which is the card face.
   */
  readonly dazed: boolean;
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

/**
 * Only 'activation' and 'finished' are currently reachable. The round loop
 * runs priority and cleanup to completion inside a single `resolve()` pass, so
 * neither is ever observable as a resting state; they are declared for the
 * point at which a player has a decision to make in one of them.
 */
/**
 * "Each round is broken down into three phases: Power, Activation, and
 * Cleanup."
 *
 * Power and Cleanup run to completion inside a single `resolve()` pass — there
 * is nothing in either that a player currently decides — so in practice a game
 * at rest is always in 'activation' or 'finished'. They are real phases rather
 * than bookkeeping because effects trigger during each, and the ordering
 * within Cleanup is load-bearing: priority passes *before* Activated tokens
 * are removed.
 */
export type Phase =
  | 'setup'
  | 'power'
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
  | AttackFrame
  | ReactionWindowFrame
  | {
      readonly kind: 'applyDamage';
      readonly modelId: ModelId;
      readonly amount: number;
      /**
       * Who caused it, or null when nothing did.
       *
       * Needed because Power is gained only from *enemy* effects — a character
       * hurt by its own superpower or by the board gains nothing. Without
       * attribution the engine cannot tell those apart, and self-damage would
       * quietly pay for the next reaction.
       */
      readonly source: ModelId | null;
    }
  /** Has this character's damage reached its Stamina? */
  | { readonly kind: 'checkDazed'; readonly modelId: ModelId };

/**
 * An attack in flight.
 *
 * Carries everything the remaining steps need, because the whole thing has to
 * survive being written to disk and read back mid-resolution — a reaction
 * window can park between any two steps. Hence dice as arrays of faces rather
 * than as a roll object, and no references to anything outside state.
 */
export interface AttackFrame {
  readonly kind: 'attack';
  readonly step: AttackStep;
  readonly attackerId: ModelId;
  readonly targetId: ModelId;
  readonly attackName: string;
  /** Fixed at declaration: it decides which defense stat applies. */
  readonly damageType: DamageType;
  /** Power cost, spent at step 3. */
  readonly cost: number;
  /** Pool sizes. Effects may change these up to the moment they are rolled. */
  readonly attackDice: number;
  readonly defenseDice: number;
  /** The initial rolls (steps 6 and 7), null until rolled. */
  readonly attackFaces: readonly DieFace[] | null;
  readonly defenseFaces: readonly DieFace[] | null;
  /** Dice added by resolving criticals (step 8). */
  readonly attackBonusFaces: readonly DieFace[] | null;
  readonly defenseBonusFaces: readonly DieFace[] | null;
  /** Counted at step 10. */
  readonly attackSuccesses: number | null;
  readonly defenseSuccesses: number | null;
  /** The difference, floored at zero. Null until step 10. */
  readonly damage: number | null;
}

/**
 * A pause for reactions.
 *
 * `pendingPlayers` is ordered, and the order is a rule: every window in the
 * sequence says "beginning with the attacker". A player with nothing eligible
 * is never added, so a window with no possible reactions costs nothing.
 */
export interface ReactionWindowFrame {
  readonly kind: 'reactionWindow';
  readonly timing: ReactionTiming;
  /** The attack this window interrupts — eligibility is relative to it. */
  readonly attackerId: ModelId;
  readonly targetId: ModelId;
  readonly damageType: DamageType;
  readonly pendingPlayers: readonly PlayerId[];
  /**
   * Reactions already used *in this window*, as `modelId::superpower`.
   *
   * Scoped to the window rather than the turn, and the distinction is a rule:
   * the book lets a character use more than one effect in a window, and almost
   * none of the printed defensive superpowers carry a once-per-Turn
   * restriction. Recording use on the model instead meant a defender who
   * shielded the first of two attacks in an enemy activation was denied the
   * shield against the second.
   *
   * It exists at all because the player keeps their place in the queue after
   * declaring, so without it a free reaction could be declared forever.
   */
  readonly used: readonly string[];
}

/**
 * The attack sequence, one value per printed step.
 *
 * Named after the rulebook so the machine can be read against the book — see
 * issue #5 for the transcription. Step 1, "choose an attack", is not here: it
 * is validated when the ATTACK action arrives, before any frame exists, since
 * an attack the character cannot afford is never declared at all.
 */
export type AttackStep =
  /** 2 — target declared and Range measured; reactions to being targeted. */
  | 'declareTarget'
  /** 3 — pay the Power cost, or the attack ends. */
  | 'payPower'
  /** 4 — attack pool, never fewer than one die. */
  | 'createAttackPool'
  /** 5 — defense pool from the matching defense stat, never fewer than one. */
  | 'createDefensePool'
  /** 6 — the initial attack roll. */
  | 'rollAttack'
  /** 7 — the initial defense roll. */
  | 'rollDefense'
  /** 8 — one extra die per Critical in each initial roll. Does not cascade. */
  | 'resolveCriticals'
  /** 9 — rerolls and changes, beginning with the attacker. */
  | 'modifyDice'
  /** 10 — count successes and subtract. */
  | 'compareResults'
  /** 11 — effects that trigger before Damage. */
  | 'beforeDamage'
  /** 12 — Damage, capped at the target's remaining Stamina. */
  | 'applyDamage'
  /** 13 — the attack is resolved. */
  | 'attackResolved'
  /** 14 — effects that trigger after an attack. */
  | 'afterAttack';

/** Re-exported so consumers need only one import for the reaction vocabulary. */
export type { ReactionTiming } from './profile.js';

/** What the engine is currently waiting for a human (or bot) to decide. */
export type Prompt =
  | {
      readonly kind: 'chooseActivation';
      readonly player: PlayerId;
      readonly options: readonly ModelId[];
      /**
       * "A player can end their turn without activating a character if at the
       * start of their turn they have fewer non-Grunt characters without
       * Activated or Dazed tokens on the battlefield than their opponent."
       *
       * A real tactical choice — passing makes the opponent commit first — so
       * it belongs in the prompt rather than being decided for the player.
       */
      readonly mayPass: boolean;
    }
  | { readonly kind: 'chooseAction'; readonly player: PlayerId; readonly modelId: ModelId }
  | {
      readonly kind: 'declareReaction';
      readonly player: PlayerId;
      readonly timing: ReactionTiming;
      /**
       * Genuinely usable reactions, not merely printed ones: filtered by
       * trigger, by damage type, by who is the target, and by whether the
       * model can actually pay. An empty list never reaches a player — the
       * window skips them instead.
       */
      readonly options: readonly {
        readonly modelId: ModelId;
        readonly superpower: string;
        readonly cost: number;
      }[];
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
  /**
   * Printed card stats, keyed by CharacterId.
   *
   * Normalized rather than copied onto each Model: two models of the same
   * character share one entry, and profiles never change during a game. See
   * `profile.ts` for why they live in state at all.
   */
  readonly profiles: Readonly<Record<string, CharacterProfile>>;
  readonly terrain: readonly TerrainVolume[];
  readonly objectives: readonly ObjectiveMarker[];

  /**
   * Who activated most recently, for the Cleanup Phase.
   *
   * "If the player that activated the last character of the Activation Phase
   * has the Priority token, they pass it to their opponent." Passing a turn
   * does not count — only actually activating somebody.
   */
  readonly lastActivatedBy: PlayerId | null;

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

export function getProfile(state: GameState, model: Model): CharacterProfile | undefined {
  return state.profiles[model.characterId];
}

/**
 * The stat block currently in force for a model — the healthy or injured face
 * of its card, whichever it is on.
 */
export function getStats(state: GameState, model: Model): StatProfile | undefined {
  const profile = state.profiles[model.characterId];
  return profile ? statsAt(profile, model.health) : undefined;
}

/**
 * Models that can still be activated this round, for the given player.
 *
 * "activate one character that does not have an Activated or Dazed token."
 */
export function activatableModels(state: GameState, player: PlayerId): ModelId[] {
  return Object.values(state.models)
    .filter(m => m.owner === player && !m.activatedThisRound && !m.dazed && m.health !== 'ko')
    .map(m => m.id);
}

/**
 * May this player pass instead of activating?
 *
 * Legal only when they have fewer characters left to activate than their
 * opponent. A player with none left therefore always may — which is also what
 * ends the Activation Phase, since when *neither* player can activate, neither
 * can pass either.
 *
 * TODO(verify): the rule says "fewer non-Grunt characters". Grunts are not
 * modelled, so every character counts.
 */
export function mayPassTurn(state: GameState, player: PlayerId): boolean {
  const mine = activatableModels(state, player).length;
  const theirs = state.turnOrder
    .filter(other => other !== player)
    .reduce((most, other) => Math.max(most, activatableModels(state, other).length), 0);
  return mine < theirs;
}

/** A model's printed name, falling back to its id when it has no card. */
export const nameOf = (state: GameState, id: string): string => {
  const model = state.models[id];
  if (!model) return id;

  return model.characterName || state.profiles[model.characterId]?.name || id;
};

export const playerOf = (state: GameState, id: string): string =>
  state.players[id]?.displayName ?? id;
