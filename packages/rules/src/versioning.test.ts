import { describe, expect, it } from 'vitest';

import type { Action } from './actions.js';
import { applyAll } from './engine.js';
import { vec3 } from './geometry/vec.js';
import type { ModelId, PlayerId } from './ids.js';
import { SAVE_FORMAT_VERSION } from './persistence.js';
import { createSparringGame } from './setup.js';
import type { GameEvent } from './events.js';
import { SCHEMA_VERSION, type GameState, type Model, type PlayerState } from './state.js';

/**
 * Guards for the version constants.
 *
 * Three constants in this repo answer "is your build compatible with mine?",
 * and all three have been missed at least once:
 *
 *   `SAVE_FORMAT_VERSION`  a save is a seed and a list of intents, so anything
 *                          that changes intent → outcome changes the format.
 *                          Missed twice before its comment was rewritten to say
 *                          so, and its own text records that.
 *   `SCHEMA_VERSION`       the shape of `GameState`.
 *   `PROTOCOL_VERSION`     what crosses the wire. Missed for the die's sixth
 *                          face and again for the corrected distances; caught
 *                          in review the third time.
 *
 * The pattern in every miss was the same: the constant is guarding something
 * the author was not thinking about while changing it. No test can know that a
 * rule changed — but a test *can* pin the surface each constant guards, and put
 * the constant in the same assertion, so the number is on screen at the moment
 * the surface moves.
 *
 * **These tests are meant to fail.** A failure here is not a bug report; it is
 * the question "did you mean to change this, and if so did you bump the
 * number?". Update the expected value in the same edit as the bump.
 */

const p1 = 'p1' as PlayerId;
const p2 = 'p2' as PlayerId;
const [m1, m2, m3, m4] = ['m1', 'm2', 'm3', 'm4'] as ModelId[];

/**
 * A fixed script on a fixed seed.
 *
 * Chosen to touch everything a save's replay depends on: two attacks (the die,
 * the defense roll, damage, and the Power a hit generates), a Medium move of
 * 4.5" (illegal when that tool was 4"), attacks at 2.43" edge-to-edge (illegal
 * if Range 2 shrinks below that), and enough turns to reach a second round.
 */
const SCRIPT: readonly Action[] = [
  { type: 'ACTIVATE', player: p1, modelId: m1 as ModelId },
  {
    type: 'ATTACK',
    player: p1,
    attackerId: m1 as ModelId,
    targetId: m2 as ModelId,
    attackName: 'STRIKE',
  },
  { type: 'END_ACTIVATION', player: p1 },
  { type: 'ACTIVATE', player: p2, modelId: m2 as ModelId },
  {
    type: 'ATTACK',
    player: p2,
    attackerId: m2 as ModelId,
    targetId: m1 as ModelId,
    attackName: 'STRIKE',
  },
  { type: 'END_ACTIVATION', player: p2 },
  { type: 'ACTIVATE', player: p1, modelId: m3 as ModelId },
  { type: 'MOVE', player: p1, modelId: m3 as ModelId, template: 'M', path: [vec3(14, 12.5, 0)] },
  { type: 'END_ACTIVATION', player: p1 },
  { type: 'ACTIVATE', player: p2, modelId: m4 as ModelId },
  { type: 'END_ACTIVATION', player: p2 },
];

/** Everything a replay of the same log has to reproduce, in one readable object. */
function outcomeOf(state: GameState, events: readonly GameEvent[]) {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;

  return {
    round: state.round,
    phase: state.phase,
    result: state.result,
    // The RNG position, so a change in how many dice are drawn shows up even
    // when the faces drawn happen to land the same way.
    rng: state.rng.seed,
    models: Object.values(state.models)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        m =>
          `${m.id} ${m.health}${m.dazed ? '/dazed' : ''} dmg=${m.damage} pwr=${m.power} ` +
          `@${m.pos.x.toFixed(2)},${m.pos.y.toFixed(2)} r=${m.radius.toFixed(4)}`,
      ),
    events: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
  };
}

const keysOf = <T extends object>(shape: T): string[] => Object.keys(shape).sort();

describe('SAVE_FORMAT_VERSION', () => {
  it('still produces the game this version claims to produce', () => {
    const replay = applyAll(createSparringGame(7), [...SCRIPT]);

    // A rejection here is the same signal as a changed fingerprint, arriving
    // less prettily: an action that was legal when this was written no longer
    // is, so a saved log containing it will not replay either.
    expect(
      replay.ok,
      replay.ok ? '' : `${replay.rejection?.code}: ${replay.rejection?.message}`,
    ).toBe(true);
    if (!replay.ok) return;

    expect({
      SAVE_FORMAT_VERSION,
      outcome: outcomeOf(replay.state, replay.events),
    }).toEqual({
      // Bump both halves together. The version belongs in this assertion rather
      // than its own, because a fingerprint that changes without the number
      // changing is exactly the bug this file exists to catch — and a developer
      // fixing the expected outcome has to look straight at the version to do it.
      SAVE_FORMAT_VERSION: 5,
      outcome: {
        round: 2,
        phase: 'activation',
        result: null,
        rng: 2903413569,
        models: [
          'm1 healthy dmg=2 pwr=4 @12.00,18.00 r=0.7874',
          'm2 healthy dmg=1 pwr=3 @16.00,18.00 r=0.7874',
          'm3 healthy dmg=0 pwr=2 @14.00,12.50 r=0.7874',
          'm4 healthy dmg=0 pwr=2 @26.00,24.00 r=0.7874',
        ],
        events: {
          ACTIVATION_ENDED: 4,
          ACTIVATION_STARTED: 4,
          ATTACK_DECLARED: 2,
          DAMAGE_DEALT: 2,
          DICE_ROLLED: 4,
          MODEL_MOVED: 1,
          POWER_GAINED: 6,
          ROUND_STARTED: 1,
        },
      },
    });
  });
});

describe('SCHEMA_VERSION', () => {
  /*
   * `Record<keyof T, true>` rather than a hand-written list: adding a field to
   * `GameState` is a *compile* error here until it is listed, which is a firmer
   * reminder than a failing assertion and arrives before the test even runs.
   * Removing one is an error too.
   */
  const GAME_STATE: Record<keyof GameState, true> = {
    schemaVersion: true,
    rng: true,
    phase: true,
    result: true,
    round: true,
    turnOrder: true,
    activePlayer: true,
    players: true,
    models: true,
    profiles: true,
    terrain: true,
    objectives: true,
    lastActivatedBy: true,
    stack: true,
    prompt: true,
    sequence: true,
  };

  const MODEL: Record<keyof Model, true> = {
    id: true,
    characterId: true,
    owner: true,
    pos: true,
    facing: true,
    radius: true,
    height: true,
    health: true,
    dazed: true,
    damage: true,
    power: true,
    conditions: true,
    activatedThisRound: true,
    usedThisTurn: true,
    holdingObjective: true,
  };

  const PLAYER: Record<keyof PlayerState, true> = {
    id: true,
    displayName: true,
    squad: true,
    victoryPoints: true,
    tacticCards: true,
    threatSpent: true,
    hasPriority: true,
  };

  it('still describes the state shape this version claims to describe', () => {
    expect({
      SCHEMA_VERSION,
      gameState: keysOf(GAME_STATE),
      model: keysOf(MODEL),
      player: keysOf(PLAYER),
    }).toEqual({
      SCHEMA_VERSION: 2,
      gameState: [
        'activePlayer',
        'lastActivatedBy',
        'models',
        'objectives',
        'phase',
        'players',
        'profiles',
        'prompt',
        'result',
        'rng',
        'round',
        'schemaVersion',
        'sequence',
        'stack',
        'terrain',
        'turnOrder',
      ],
      model: [
        'activatedThisRound',
        'characterId',
        'conditions',
        'damage',
        'dazed',
        'facing',
        'health',
        'height',
        'holdingObjective',
        'id',
        'owner',
        'pos',
        'power',
        'radius',
        'usedThisTurn',
      ],
      player: [
        'displayName',
        'hasPriority',
        'id',
        'squad',
        'tacticCards',
        'threatSpent',
        'victoryPoints',
      ],
    });
  });

  it('stamps the current version onto a new game', () => {
    expect(createSparringGame().schemaVersion).toBe(SCHEMA_VERSION);
  });
});
