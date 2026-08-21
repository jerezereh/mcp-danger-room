import { describe, expect, it } from 'vitest';

import type { Action } from './actions.js';
import { applyAll } from './engine.js';
import type { GameEvent } from './events.js';
import type { TerrainVolume } from './geometry/los.js';
import { vec3, type Vec3 } from './geometry/vec.js';
import type { CardId, CharacterId, ModelId, PlayerId } from './ids.js';
import { SAVE_FORMAT_VERSION } from './persistence.js';
import type {
  AttackProfile,
  CharacterProfile,
  ReactionEffect,
  ReactionProfile,
  StatProfile,
  SuperpowerProfile,
} from './profile.js';
import type { RngState } from './rng.js';
import { createSparringGame } from './setup.js';
import {
  SCHEMA_VERSION,
  type Condition,
  type Frame,
  type GameResult,
  type GameState,
  type Model,
  type ObjectiveMarker,
  type PlayerState,
  type Prompt,
} from './state.js';

/**
 * Guards for `SAVE_FORMAT_VERSION` and `SCHEMA_VERSION`.
 *
 * Three constants answer "is your build compatible with mine?", and all three
 * have been missed. `SAVE_FORMAT_VERSION` twice, until its comment was
 * rewritten to state the trigger properly. `PROTOCOL_VERSION` three times — see
 * `packages/protocol/src/versioning.test.ts`, which guards it.
 *
 * Every miss had the same shape: the constant guards something the author was
 * not thinking about while changing it. No test can know that a rule changed,
 * but a test *can* pin the surface each constant guards and put the constant in
 * the same assertion, so the number is on screen the moment the surface moves.
 *
 * **These tests are meant to fail.** A failure is not a bug report; it is the
 * question "did you mean to change this, and did you bump the number?". Update
 * the expected value in the same edit as the bump.
 */

const p1 = 'p1' as PlayerId;
const p2 = 'p2' as PlayerId;
const m1 = 'm1' as ModelId;
const m2 = 'm2' as ModelId;
const m3 = 'm3' as ModelId;
const m4 = 'm4' as ModelId;

// ---------------------------------------------------------------------------
// SAVE_FORMAT_VERSION — the outcome a replay has to reproduce
// ---------------------------------------------------------------------------

/**
 * A fixed script on a fixed seed.
 *
 * Chosen to touch everything a replay depends on: two attacks (the die, the
 * defense roll, damage, and the Power a hit generates), a Medium move of 4.5"
 * that was illegal when that tool was 4", attacks at 2.43" edge-to-edge that
 * become illegal if Range 2 shrinks below it, and enough turns to reach a
 * second round.
 */
const SCRIPT: readonly Action[] = [
  { type: 'ACTIVATE', player: p1, modelId: m1 },
  { type: 'ATTACK', player: p1, attackerId: m1, targetId: m2, attackName: 'STRIKE' },
  { type: 'END_ACTIVATION', player: p1 },
  { type: 'ACTIVATE', player: p2, modelId: m2 },
  { type: 'ATTACK', player: p2, attackerId: m2, targetId: m1, attackName: 'STRIKE' },
  { type: 'END_ACTIVATION', player: p2 },
  { type: 'ACTIVATE', player: p1, modelId: m3 },
  { type: 'MOVE', player: p1, modelId: m3, template: 'M', path: [vec3(14, 12.5, 0)] },
  { type: 'END_ACTIVATION', player: p1 },
  { type: 'ACTIVATE', player: p2, modelId: m4 },
  { type: 'END_ACTIVATION', player: p2 },
];

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

describe('SAVE_FORMAT_VERSION', () => {
  it('still produces the game this version claims to produce', () => {
    const replay = applyAll(createSparringGame(7), [...SCRIPT]);

    // A rejection is the same signal as a changed fingerprint, arriving less
    // prettily: an action that was legal when this was written no longer is, so
    // a saved log containing it will not replay either.
    expect(
      replay.ok,
      replay.ok ? '' : `${replay.rejection.code}: ${replay.rejection.message}`,
    ).toBe(true);
    if (!replay.ok) return;

    expect({
      SAVE_FORMAT_VERSION,
      outcome: outcomeOf(replay.state, replay.events),
    }).toEqual({
      // The version belongs in this assertion rather than its own: a
      // fingerprint that changes without the number changing is exactly the bug
      // this file exists to catch, and a developer fixing the expected outcome
      // has to look straight at the version to do it.
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

// ---------------------------------------------------------------------------
// SCHEMA_VERSION — the shape of everything inside a GameState
// ---------------------------------------------------------------------------

/**
 * One fully-populated value per type, typed as that type.
 *
 * Samples rather than `Record<keyof T, true>` key lists, which is the second
 * pass at this file: key lists caught a *new* field and nothing else. A sample
 * is checked by the compiler in three directions at once —
 *
 *   added required field  → "missing property" on the sample
 *   removed or renamed    → "unknown property" (excess property check)
 *   retyped               → the literal no longer assignable
 *
 * — and the runtime fingerprint below turns any of that into a version
 * question. The gap left is a field added as *optional*, which changes nothing
 * here; that is also the one change old readers survive, so it is the right
 * thing to be quiet about.
 */
const VEC: Vec3 = { x: 1, y: 2, z: 3 };
const RNG: RngState = { seed: 1 };
const RESULT: GameResult = { winner: p1, reason: 'wipeout' };
const CONDITION: Condition = { kind: 'bleed', stacks: 1, source: m2 };
const OBJECTIVE: ObjectiveMarker = { id: 'o1', pos: VEC, kind: 'extract', heldBy: null };
const TERRAIN: TerrainVolume = {
  id: 't1',
  pos: VEC,
  radius: 1,
  height: 2,
  size: 3,
  blocksLineOfSight: true,
};

const ATTACK: AttackProfile = {
  name: 'STRIKE',
  type: 'physical',
  range: 2,
  shape: 'range',
  dice: 5,
  cost: 0,
};
const REACTION_EFFECTS: {
  readonly [K in ReactionEffect['kind']]: Extract<ReactionEffect, { kind: K }>;
} = {
  addDefenseDice: { kind: 'addDefenseDice', count: 1 },
  addAttackDice: { kind: 'addAttackDice', count: 1 },
};
const REACTION: ReactionProfile = {
  timing: 'targeted',
  role: 'target',
  damageTypes: ['physical'],
  effect: REACTION_EFFECTS.addDefenseDice,
};
const SUPERPOWER: SuperpowerProfile = {
  name: 'SHIELD',
  type: 'reactive',
  cost: 2,
  reaction: REACTION,
};
const STATS: StatProfile = {
  stamina: 6,
  movement: 'M',
  size: 2,
  defense: { physical: 3, energy: 3, mystic: 3 },
  attacks: [ATTACK],
  superpowers: [SUPERPOWER],
};
const PROFILE: CharacterProfile = {
  characterId: 'alpha' as CharacterId,
  name: 'Alpha',
  baseMm: 40,
  healthy: STATS,
  injured: STATS,
};

const MODEL: Model = {
  id: m1,
  characterId: 'alpha' as CharacterId,
  owner: p1,
  pos: VEC,
  facing: 0,
  radius: 0.7874,
  height: 2,
  health: 'healthy',
  dazed: false,
  damage: 0,
  power: 1,
  conditions: [CONDITION],
  activatedThisRound: false,
  usedThisTurn: ['SHIELD'],
  holdingObjective: null,
};

const PLAYER: PlayerState = {
  id: p1,
  displayName: 'One',
  squad: [m1],
  victoryPoints: 0,
  tacticCards: ['card' as CardId],
  threatSpent: 0,
  hasPriority: true,
};

const FRAMES: { readonly [K in Frame['kind']]: Extract<Frame, { kind: K }> } = {
  activation: { kind: 'activation', modelId: m1, actionsRemaining: 2 },
  attack: {
    kind: 'attack',
    step: 'declareTarget',
    attackerId: m1,
    targetId: m2,
    attackName: 'STRIKE',
    damageType: 'physical',
    cost: 0,
    attackDice: 5,
    defenseDice: 3,
    attackFaces: null,
    defenseFaces: null,
    attackBonusFaces: null,
    defenseBonusFaces: null,
    attackSuccesses: null,
    defenseSuccesses: null,
    damage: null,
  },
  reactionWindow: {
    kind: 'reactionWindow',
    timing: 'targeted',
    attackerId: m1,
    targetId: m2,
    damageType: 'physical',
    pendingPlayers: [p2],
    used: ['m2::SHIELD'],
  },
  applyDamage: { kind: 'applyDamage', modelId: m2, amount: 2, source: m1 },
  checkDazed: { kind: 'checkDazed', modelId: m2 },
};

const PROMPTS: { readonly [K in Prompt['kind']]: Extract<Prompt, { kind: K }> } = {
  chooseActivation: { kind: 'chooseActivation', player: p1, options: [m1], mayPass: false },
  chooseAction: { kind: 'chooseAction', player: p1, modelId: m1 },
  declareReaction: {
    kind: 'declareReaction',
    player: p2,
    timing: 'targeted',
    options: [{ modelId: m2, superpower: 'SHIELD', cost: 2 }],
  },
  rollPriority: { kind: 'rollPriority', players: [p1, p2] },
};

const STATE: GameState = {
  schemaVersion: SCHEMA_VERSION,
  rng: RNG,
  phase: 'activation',
  result: RESULT,
  round: 1,
  turnOrder: [p1, p2],
  activePlayer: p1,
  players: { p1: PLAYER },
  models: { m1: MODEL },
  profiles: { alpha: PROFILE },
  terrain: [TERRAIN],
  objectives: [OBJECTIVE],
  lastActivatedBy: null,
  stack: [FRAMES.activation],
  prompt: PROMPTS.chooseAction,
  sequence: 0,
};

const shape = (value: object): string => Object.keys(value).sort().join(',');

const shapes = (samples: Readonly<Record<string, object>>): string[] =>
  Object.entries(samples)
    .map(([tag, value]) => `${tag}(${shape(value)})`)
    .sort();

describe('SCHEMA_VERSION', () => {
  it('still describes the state shape this version claims to describe', () => {
    expect({
      SCHEMA_VERSION,
      gameState: shape(STATE),
      model: shape(MODEL),
      player: shape(PLAYER),
      frames: shapes(FRAMES),
      prompts: shapes(PROMPTS),
      nested: shapes({
        condition: CONDITION,
        objective: OBJECTIVE,
        result: RESULT,
        rng: RNG,
        terrain: TERRAIN,
        vec3: VEC,
      }),
      profile: shapes({
        attack: ATTACK,
        character: PROFILE,
        reaction: REACTION,
        stats: STATS,
        superpower: SUPERPOWER,
        ...REACTION_EFFECTS,
      }),
    }).toEqual({
      SCHEMA_VERSION: 2,
      gameState:
        'activePlayer,lastActivatedBy,models,objectives,phase,players,profiles,prompt,result,rng,' +
        'round,schemaVersion,sequence,stack,terrain,turnOrder',
      model:
        'activatedThisRound,characterId,conditions,damage,dazed,facing,health,height,' +
        'holdingObjective,id,owner,pos,power,radius,usedThisTurn',
      player: 'displayName,hasPriority,id,squad,tacticCards,threatSpent,victoryPoints',
      frames: [
        'activation(actionsRemaining,kind,modelId)',
        'applyDamage(amount,kind,modelId,source)',
        'attack(attackBonusFaces,attackDice,attackFaces,attackName,attackSuccesses,attackerId,' +
          'cost,damage,damageType,defenseBonusFaces,defenseDice,defenseFaces,defenseSuccesses,' +
          'kind,step,targetId)',
        'checkDazed(kind,modelId)',
        'reactionWindow(attackerId,damageType,kind,pendingPlayers,targetId,timing,used)',
      ],
      prompts: [
        'chooseAction(kind,modelId,player)',
        'chooseActivation(kind,mayPass,options,player)',
        'declareReaction(kind,options,player,timing)',
        'rollPriority(kind,players)',
      ],
      nested: [
        'condition(kind,source,stacks)',
        'objective(heldBy,id,kind,pos)',
        'result(reason,winner)',
        'rng(seed)',
        'terrain(blocksLineOfSight,height,id,pos,radius,size)',
        'vec3(x,y,z)',
      ],
      profile: [
        'addAttackDice(count,kind)',
        'addDefenseDice(count,kind)',
        'attack(cost,dice,name,range,shape,type)',
        'character(baseMm,characterId,healthy,injured,name)',
        'reaction(damageTypes,effect,role,timing)',
        'stats(attacks,defense,movement,size,stamina,superpowers)',
        'superpower(cost,name,reaction,type)',
      ],
    });
  });

  it('stamps the current version onto a new game', () => {
    expect(createSparringGame().schemaVersion).toBe(SCHEMA_VERSION);
  });
});
