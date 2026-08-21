/**
 * Saving and loading.
 *
 * The durable format is the *action log*, not the state:
 *
 *     { formatVersion, seed, setup, actions[] }
 *
 * State is a derived cache, reconstructed by folding `applyAction` over the
 * log. This is sound because the engine is deterministic — the same seed plus
 * the same actions always produces the same game, and `engine.test.ts` guards
 * that property.
 *
 * The reason to do it this way is decoupling. If a save were a serialized
 * GameState, then every change to the state shape would be a save migration —
 * including changes to how suspended resolution is represented, which is still
 * an open question (see the frame-stack vs generators discussion). Persisting
 * actions instead means the continuation representation is never written to
 * disk, so that decision can be revisited without invalidating a single save.
 *
 * The bonus is that a replay *is* a save file, and so is a bug report.
 */

import type { Action } from './actions.js';
import { applyAction, type Result } from './engine.js';
import { createGame, type GameSpec } from './setup.js';
import type { GameState } from './state.js';

/**
 * Bumped whenever the same seed and the same actions stop producing the same
 * game.
 *
 * That is a wider trigger than it first looks, and stating it as "when the
 * shape changes" has now been wrong twice. A save is a seed plus a list of
 * *intents*; the outcomes are recomputed on load. So anything the engine uses
 * to turn intents into outcomes is part of this format — the shape of
 * `SavedGame`, `GameSpec` and `Action`, but equally the rules, the constants,
 * and the die.
 *
 * The failure mode when this is missed is the quiet one. A shape change breaks
 * replay loudly, with a DIVERGED at the first action the engine no longer
 * accepts. A *rules* change usually leaves every action still legal — you may
 * still activate that model, still declare that attack — so the replay
 * succeeds and silently hands back a game that never happened.
 *
 * v2: `GameSpec` models carry a `profile`, and `Action` gained `PASS_TURN`.
 * A v1 log replays into a game whose characters have none of their printed
 * attacks, so an ATTACK naming a real attack is rejected — which surfaced as
 * DIVERGED pointing at an arbitrary action, reading as a corrupt save rather
 * than an old one.
 *
 * v3: the die gained its sixth face. The pool size is unchanged, so the same
 * RNG indices are drawn and four of the eight now land on different symbols —
 * a v2 replay produces different rolls, different damage, and a different
 * board, with every action still legal and nothing to complain about.
 * `dice.test.ts` pins the seed-to-faces mapping so the next change to the die
 * fails there rather than here.
 *
 * v4: the measured distances replaced the invented ones (#10). Range bands,
 * movement tools and base radii all moved, and every one of them decides
 * whether an action is legal. A v3 MOVE of 4.5" was rejected when the Medium
 * tool was 4" and is accepted now that it is 5"; a v3 ATTACK at Range 3 that
 * could not reach 5.5" reaches it now. Both directions are worse than a
 * refusal: the rejected ones diverge at an arbitrary action, and the newly
 * legal ones replay clean into a game that could not have been played.
 * `constants.test.ts` pins the distances so the next change to them fails
 * there rather than here.
 */
export const SAVE_FORMAT_VERSION = 4;

export interface SavedGame {
  readonly formatVersion: number;
  /** Everything needed to reconstruct the opening position. */
  readonly setup: GameSpec;
  /** Every action applied since, in order. */
  readonly actions: readonly Action[];
  /** Advisory only — never trusted during load. */
  readonly meta?: {
    readonly savedAt?: number;
    readonly label?: string;
  };
}

/**
 * A game plus the log that produced it.
 *
 * Callers hold this rather than a bare GameState so the log stays in step with
 * the state it describes. `record` is the only way to advance it, which makes
 * divergence between the two structurally difficult.
 */
export interface GameSession {
  readonly setup: GameSpec;
  readonly state: GameState;
  readonly actions: readonly Action[];
}

export function startSession(setup: GameSpec): GameSession {
  return { setup, state: createGame(setup), actions: [] };
}

export type RecordResult =
  | { readonly ok: true; readonly session: GameSession; readonly result: Result }
  | { readonly ok: false; readonly result: Result };

/**
 * Apply an action and append it to the log.
 *
 * Rejected actions are deliberately *not* logged. The log is a record of what
 * happened, not of what was attempted — if rejections were replayed they would
 * have to re-reject identically forever, which would freeze every validation
 * rule in the engine at the version that first saw them.
 */
export function record(session: GameSession, action: Action): RecordResult {
  const result = applyAction(session.state, action);
  if (!result.ok) return { ok: false, result };

  return {
    ok: true,
    result,
    session: {
      setup: session.setup,
      state: result.state,
      actions: [...session.actions, action],
    },
  };
}

export function save(session: GameSession, label?: string): SavedGame {
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    setup: session.setup,
    actions: [...session.actions],
    meta: { savedAt: Date.now(), ...(label === undefined ? {} : { label }) },
  };
}

export type LoadResult =
  | { readonly ok: true; readonly session: GameSession }
  | { readonly ok: false; readonly error: LoadError };

export interface LoadError {
  readonly code: 'UNSUPPORTED_VERSION' | 'MALFORMED' | 'DIVERGED';
  readonly message: string;
  /** Index of the offending action, for DIVERGED and for MALFORMED entries. */
  readonly atAction?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A position with three finite coordinates.
 *
 * Checking only that it is an object is not enough: `pos: {}` passes that and
 * then propagates NaN through every distance in the game, which is quieter and
 * worse than an exception — moves get rejected with arithmetic nobody can
 * explain rather than the save being reported as broken.
 */
const isVec3 = (v: unknown): boolean =>
  isObject(v) && (['x', 'y', 'z'] as const).every(axis => Number.isFinite(v[axis]));

/**
 * Structural validation of a save, before any of it is trusted.
 *
 * Deliberately shallow — it checks the shape the engine will actually
 * dereference, not every field of every action. Anything deeper than this
 * belongs in a Zod schema, and would duplicate the `Action` union in a second
 * place that could drift from the first.
 */
function checkShape(saved: SavedGame): LoadError | null {
  const setup = saved.setup as unknown;
  if (!isObject(setup)) {
    return { code: 'MALFORMED', message: 'Save setup is not an object.' };
  }
  if (typeof setup['seed'] !== 'number' || !Number.isFinite(setup['seed'])) {
    return { code: 'MALFORMED', message: 'Save setup has no usable seed.' };
  }
  if (!Array.isArray(setup['players']) || !Array.isArray(setup['models'])) {
    return { code: 'MALFORMED', message: 'Save setup is missing players or models.' };
  }
  if (setup['terrain'] !== undefined && !Array.isArray(setup['terrain'])) {
    return { code: 'MALFORMED', message: 'Save setup has malformed terrain.' };
  }

  // Terrain positions are dereferenced by every line-of-sight trace, and are
  // the same silent-NaN hazard as a model's.
  for (const [index, volume] of ((setup['terrain'] as unknown[]) ?? []).entries()) {
    if (!isObject(volume) || !isVec3(volume['pos'])) {
      return { code: 'MALFORMED', message: `Terrain ${index} has no usable position.` };
    }
  }

  for (const [index, model] of (setup['models'] as unknown[]).entries()) {
    const bad = checkModelShape(model, index);
    if (bad) return bad;
  }

  for (const [index, action] of saved.actions.entries()) {
    if (!isObject(action) || typeof action['type'] !== 'string') {
      return {
        code: 'MALFORMED',
        atAction: index,
        message: `Action ${index} is not a well-formed action.`,
      };
    }
  }

  return null;
}

/**
 * A model entry, and the profile hanging off it.
 *
 * Checked because the engine dereferences these without asking. A model whose
 * profile is present but truncated — `"profile": {}` in a hand-edited file —
 * used to throw out of `createModel` while reading `profile.healthy.size`,
 * which is not a failure mode a Load button should have.
 */
function checkModelShape(model: unknown, index: number): LoadError | null {
  const malformed = (message: string): LoadError => ({ code: 'MALFORMED', message });

  if (!isObject(model)) return malformed(`Model ${index} is not an object.`);
  if (typeof model['id'] !== 'string') return malformed(`Model ${index} has no id.`);
  if (!isVec3(model['pos'])) return malformed(`Model ${index} has no usable position.`);

  const profile = model['profile'];
  if (profile === undefined) return null;
  if (!isObject(profile)) return malformed(`Model ${index} has a malformed profile.`);

  for (const face of ['healthy', 'injured'] as const) {
    const stats = profile[face];
    if (!isObject(stats)) {
      return malformed(`Model ${index} has no ${face} stats in its profile.`);
    }
    if (typeof stats['stamina'] !== 'number' || typeof stats['size'] !== 'number') {
      return malformed(`Model ${index} has malformed ${face} stats.`);
    }
    if (!isObject(stats['defense'])) {
      return malformed(`Model ${index} has no ${face} defense stats.`);
    }
    if (!Array.isArray(stats['attacks']) || !Array.isArray(stats['superpowers'])) {
      return malformed(`Model ${index} has malformed ${face} attacks or superpowers.`);
    }
  }

  return null;
}

/**
 * Rebuild a session from a save.
 *
 * A rejection during replay means the log and the engine disagree — the rules
 * changed under a save taken with older code. That is reported as DIVERGED with
 * the offending index rather than silently truncating, because a half-replayed
 * game looks valid and is not.
 */
export function load(saved: SavedGame): LoadResult {
  // Guard the shape before touching any field. `load` is public and the input
  // is untrusted — a hand-edited localStorage value or a truncated file is
  // ordinary, and it must return MALFORMED rather than throw past the caller.
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
    return { ok: false, error: { code: 'MALFORMED', message: 'Save is not an object.' } };
  }

  if (saved.formatVersion !== SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_VERSION',
        message: `Save is format v${saved.formatVersion}; this build reads v${SAVE_FORMAT_VERSION}.`,
      },
    };
  }

  if (!saved.setup || !Array.isArray(saved.actions)) {
    return {
      ok: false,
      error: { code: 'MALFORMED', message: 'Save is missing setup or actions.' },
    };
  }

  // `startSession` and `applyAction` both trust their input, so the shape has
  // to be established here. A truthy `setup` is not enough — one missing array
  // and `createGame` throws "spec.players is not iterable" straight past the
  // caller, which is not a failure mode a Load button should have.
  const shape = checkShape(saved);
  if (shape) return { ok: false, error: shape };

  return replay(saved);
}

/**
 * Fold the log over a fresh session.
 *
 * Wrapped, because the structural checks above cannot cover everything the
 * engine will touch and `load` is documented never to throw. `applyAction` is
 * total for game-rule reasons but not for broken invariants — it throws on a
 * model that vanishes mid-resolution, or resolution that will not converge —
 * and a sufficiently strange save can reach those. Better a MALFORMED result
 * naming the failure than an exception past the caller.
 */
function replay(saved: SavedGame): LoadResult {
  let session: GameSession;
  try {
    session = startSession(saved.setup);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED',
        message: `Save setup could not be built: ${(error as Error).message}`,
      },
    };
  }

  for (const [index, action] of saved.actions.entries()) {
    let step: RecordResult;
    try {
      step = record(session, action);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'MALFORMED',
          atAction: index,
          message: `Action ${index} could not be replayed: ${(error as Error).message}`,
        },
      };
    }

    if (!step.ok) {
      return {
        ok: false,
        error: {
          code: 'DIVERGED',
          atAction: index,
          message:
            `Action ${index} (${action.type}) was rejected on replay: ` +
            `${step.result.ok ? '' : step.result.rejection.message} ` +
            'The save was taken with different rules.',
        },
      };
    }
    session = step.session;
  }

  return { ok: true, session };
}

/**
 * The state after the first `count` actions.
 *
 * This is what a replay scrubber calls. Recomputing from the start each time is
 * deliberate: it needs no cache invalidation and costs microseconds at MCP's
 * scale (a full game is a few hundred actions at roughly 1µs each). If a format
 * ever grows long enough for that to matter, snapshot every N actions — but
 * measure before adding the complexity.
 */
export function stateAfter(saved: SavedGame, count: number): LoadResult {
  return load({ ...saved, actions: saved.actions.slice(0, Math.max(0, count)) });
}

/** Serialize to a string suitable for a file or localStorage. */
export function serialize(session: GameSession, label?: string): string {
  return JSON.stringify(save(session, label));
}

export function deserialize(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: { code: 'MALFORMED', message: 'Save is not valid JSON.' } };
  }
  return load(parsed as SavedGame);
}
