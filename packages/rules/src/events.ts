/**
 * Events — the observable record of what happened.
 *
 * Actions are intent; events are consequence. Every event is appended to the
 * game log with a sequence number, and the client animates *from events* rather
 * than by diffing state. That separation is what lets the board show "Spider-Man
 * rolled 4 successes, Venom blocked 2, 2 damage dealt" as three beats instead of
 * one silent state swap.
 *
 * Events are also the trigger surface: reactions and passives subscribe to event
 * types, which is how MCP's "when X happens, you may Y" wording maps onto code.
 */

import type { DieFace } from './dice.js';
import type { Vec3 } from './geometry/vec.js';
import type { ModelId, PlayerId } from './ids.js';
import type { ReactionTiming } from './profile.js';
import type { ConditionKind } from './state.js';

interface EventBase {
  readonly sequence: number;
}

export type GameEvent = EventBase &
  (
    | { readonly type: 'ROUND_STARTED'; readonly round: number }
    | { readonly type: 'PRIORITY_ASSIGNED'; readonly player: PlayerId }
    | { readonly type: 'TURN_PASSED'; readonly player: PlayerId }
    | { readonly type: 'ACTIVATION_STARTED'; readonly modelId: ModelId }
    | { readonly type: 'ACTIVATION_ENDED'; readonly modelId: ModelId }
    | { readonly type: 'MODEL_MOVED'; readonly modelId: ModelId; readonly from: Vec3; readonly to: Vec3 }
    | { readonly type: 'POWER_GAINED'; readonly modelId: ModelId; readonly amount: number }
    | { readonly type: 'POWER_SPENT'; readonly modelId: ModelId; readonly amount: number }
    | {
        readonly type: 'ATTACK_DECLARED';
        readonly attackerId: ModelId;
        readonly targetId: ModelId;
        readonly attackName: string;
      }
    | {
        readonly type: 'DICE_ROLLED';
        readonly modelId: ModelId;
        readonly mode: 'attack' | 'defense';
        readonly faces: readonly DieFace[];
        readonly successes: number;
      }
    | { readonly type: 'DAMAGE_DEALT'; readonly modelId: ModelId; readonly amount: number }
    /** Damage reached Stamina: out for the round, flips at Cleanup. */
    | { readonly type: 'MODEL_DAZED'; readonly modelId: ModelId }
    /** The Cleanup Phase flip onto the Injured side. */
    | { readonly type: 'MODEL_INJURED'; readonly modelId: ModelId }
    | { readonly type: 'MODEL_KO'; readonly modelId: ModelId }
    | { readonly type: 'CONDITION_APPLIED'; readonly modelId: ModelId; readonly condition: ConditionKind }
    | { readonly type: 'CONDITION_REMOVED'; readonly modelId: ModelId; readonly condition: ConditionKind }
    | { readonly type: 'REACTION_WINDOW_OPENED'; readonly timing: ReactionTiming }
    | {
        readonly type: 'REACTION_USED';
        readonly modelId: ModelId;
        readonly superpower: string;
        readonly timing: ReactionTiming;
      }
    | { readonly type: 'OBJECTIVE_SCORED'; readonly player: PlayerId; readonly points: number }
    | { readonly type: 'GAME_ENDED'; readonly winner: PlayerId | null }
  );

export type GameEventType = GameEvent['type'];

/**
 * A plain `Omit<GameEvent, 'sequence'>` collapses the union down to its common
 * keys, which would let any event be emitted with any payload. Distributing
 * over the union preserves each variant's own fields.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event as emitted by the engine, before a sequence number is stamped on. */
export type GameEventInput = DistributiveOmit<GameEvent, 'sequence'>;


export type EventNameLookup = {
  readonly nameOf: (id: string) => string;
  readonly playerOf: (id: string) => string;
};

export function describeEvent(event: GameEvent, lookup: EventNameLookup): string {
  switch (event.type) {
    case 'ROUND_STARTED':
      return `Round ${event.round} begins.`;
    case 'PRIORITY_ASSIGNED':
      return `${lookup.playerOf(event.player)} takes priority.`;
    case 'TURN_PASSED':
      return `${lookup.playerOf(event.player)} passes.`;
    case 'ACTIVATION_STARTED':
      return `${lookup.nameOf(event.modelId)} activates.`;
    case 'ACTIVATION_ENDED':
      return `${lookup.nameOf(event.modelId)} finishes activating.`;
    case 'MODEL_MOVED':
      return `${lookup.nameOf(event.modelId)} moves to (${event.to.x.toFixed(1)}, ${event.to.y.toFixed(1)}).`;
    case 'POWER_GAINED':
      return `${lookup.nameOf(event.modelId)} gains ${event.amount} power.`;
    case 'POWER_SPENT':
      return `${lookup.nameOf(event.modelId)} spends ${event.amount} power.`;
    case 'ATTACK_DECLARED':
      return `${lookup.nameOf(event.attackerId)} attacks ${lookup.nameOf(event.targetId)} with ${event.attackName}.`;
    case 'DICE_ROLLED':
      return `${lookup.nameOf(event.modelId)} rolls ${event.mode}: ${event.successes} success${
        event.successes === 1 ? '' : 'es'
      } (${event.faces.join(', ')}).`;
    case 'DAMAGE_DEALT':
      return `${lookup.nameOf(event.modelId)} takes ${event.amount} damage.`;
    case 'MODEL_DAZED':
      return `${lookup.nameOf(event.modelId)} is Dazed.`;
    case 'MODEL_INJURED':
      return `${lookup.nameOf(event.modelId)} flips to its injured side.`;
    case 'MODEL_KO':
      return `${lookup.nameOf(event.modelId)} is KO'd.`;
    case 'CONDITION_APPLIED':
      return `${lookup.nameOf(event.modelId)} gains ${event.condition}.`;
    case 'CONDITION_REMOVED':
      return `${lookup.nameOf(event.modelId)} loses ${event.condition}.`;
    case 'REACTION_WINDOW_OPENED':
      return `Reaction window: ${event.timing}.`;
    case 'REACTION_USED':
      return `${lookup.nameOf(event.modelId)} uses ${event.superpower}.`;
    case 'OBJECTIVE_SCORED':
      return `${lookup.playerOf(event.player)} scores ${event.points} VP.`;
    case 'GAME_ENDED':
      return event.winner ? `${lookup.playerOf(event.winner)} wins.` : 'The game ends in a draw.';
  }
}

export const describe = (event: GameEvent, lookup: EventNameLookup): string => describeEvent(event, lookup);
