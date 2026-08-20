/**
 * Play a game and narrate it.
 *
 *   npm run play:demo
 *   npm run play:demo -- --seed=42 --pass-reactions
 *
 * A script rather than a test. The assertion that a game completes lives in
 * `src/lib/gameSetup.test.ts`; this is for reading. Three things get easier
 * when you can watch a hundred rolls go by: eyeballing whether dice counts and
 * ranges came off the right card, quoting a run in a bug report, and noticing
 * that a constant is wrong (#10).
 *
 * **Everything printed comes from the event stream.** That is the same
 * discipline `GameLog.tsx` follows, and it doubles as a design check: a beat
 * that is hard to phrase here is a beat the client cannot animate either, and
 * a beat that is missing here is a missing event. Two such gaps are visible in
 * the output and called out at the end of a run rather than papered over.
 *
 * The game is driven by `src/lib/autoplay.ts`, the same no-decisions player
 * the integration test uses, so this transcript is evidence about the tested
 * path rather than about a second implementation.
 */

import {
  createGame,
  MAX_ROUNDS,
  statsAt,
  type GameEvent,
  type GameState,
  type ModelId,
} from '@danger-room/rules';

import { autoPlayStep, describeInaction } from '../src/lib/autoplay.js';
import { labelOf, nameOf, playerOf } from '../src/lib/names.js';
import { playableSparringSpec } from '../src/lib/gameSetup.js';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

interface Options {
  readonly seed: number;
  readonly useReactions: boolean;
}

const DEFAULT_SEED = 11;

function parseArgs(argv: readonly string[]): Options {
  // Unknown arguments are an error rather than a shrug. The root script used
  // to swallow every flag — `npm run play:demo -- --seed=42` ran seed 11 and
  // said so — and a silently wrong seed is the one failure a reproducible
  // transcript cannot survive.
  const unknown = argv.filter(a => !a.startsWith('--seed=') && a !== '--pass-reactions');
  if (unknown.length > 0) {
    console.error(`Unrecognised argument${unknown.length > 1 ? 's' : ''}: ${unknown.join(' ')}`);
    console.error('Usage: npm run play:demo -- [--seed=N] [--pass-reactions]');
    process.exit(1);
  }

  const seedArg = argv.find(a => a.startsWith('--seed='))?.slice('--seed='.length);
  const seed = seedArg === undefined ? DEFAULT_SEED : Number(seedArg);

  if (!Number.isFinite(seed)) {
    console.error(`Not a usable seed: ${seedArg}`);
    process.exit(1);
  }

  return { seed, useReactions: !argv.includes('--pass-reactions') };
}

/** The command that reproduces this run — every option, not just the seed. */
function reproduceCommand(options: Options): string {
  const flags = [`--seed=${options.seed}`];
  // Declining reactions changes which dice are drawn, so a run made with it
  // does not reproduce without it.
  if (!options.useReactions) flags.push('--pass-reactions');
  return `npm run play:demo -- ${flags.join(' ')}`;
}

/**
 * Die faces, abbreviated so a pool fits on one line.
 *
 * Blank and Failure both do nothing and are shown differently on purpose: a
 * Blank can be rerolled and a Failure cannot, and effects trigger on `{FAIL}`
 * in its own right. Keyed loosely so this file does not have to land in step
 * with the engine's face list; an unlabelled face prints its own name.
 */
const FACE_SHORT: Record<string, string> = {
  critical: 'CRIT',
  wild: 'WILD',
  hit: ' hit',
  block: ' blk',
  blank: '   ·',
  failure: 'FAIL',
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * One line per event.
 *
 * The switch is exhaustive on purpose: a new event type is a compile error
 * here until somebody decides how to say it out loud.
 */
function render(state: GameState, event: GameEvent): string {
  // Tagged with the side, so two players fielding the same character stay
  // apart in the transcript.
  const model = (id: ModelId) => labelOf(state, id);

  switch (event.type) {
    case 'ROUND_STARTED':
      return `\n═══ Round ${event.round} ${'═'.repeat(46)}`;
    case 'PRIORITY_ASSIGNED':
      return `  ⚑ priority passes to ${playerOf(state, event.player)}`;
    case 'TURN_PASSED':
      return `  ${playerOf(state, event.player)} passes`;
    case 'ACTIVATION_STARTED':
      return `\n  ${model(event.modelId)} activates`;
    case 'ACTIVATION_ENDED':
      return `  …${model(event.modelId)} is done`;
    case 'MODEL_MOVED':
      return `    moves to ${event.to.x.toFixed(1)}, ${event.to.y.toFixed(1)}`;
    // Indented to sit under the damage or the reaction that caused them.
    case 'POWER_GAINED':
      return `      +${event.amount} power  ${model(event.modelId)}`;
    case 'POWER_SPENT':
      return `      −${event.amount} power  ${model(event.modelId)}`;
    case 'ATTACK_DECLARED':
      return `    ${event.attackName} → ${model(event.targetId)}`;
    case 'DICE_ROLLED': {
      const faces = event.faces.map(f => FACE_SHORT[f] ?? f).join(' ');
      const label = event.mode === 'attack' ? 'attack ' : 'defense';
      return `      ${label} ${String(event.faces.length).padStart(2)}d  ${faces}  = ${event.successes}`;
    }
    case 'DAMAGE_DEALT':
      return `      ${model(event.modelId)} suffers ${event.amount}`;
    case 'MODEL_DAZED':
      return `      ✖ ${model(event.modelId)} is Dazed`;
    case 'MODEL_INJURED':
      return `  ↻ ${model(event.modelId)} flips to its injured side`;
    case 'MODEL_KO':
      return `      ☠ ${model(event.modelId)} is KO'd`;
    case 'REACTION_WINDOW_OPENED':
      return `      ⏸ reaction window — ${event.timing}`;
    case 'REACTION_USED':
      return `      ★ ${model(event.modelId)} uses ${event.superpower}`;
    case 'CONDITION_APPLIED':
      return `      ${model(event.modelId)} gains ${event.condition}`;
    case 'CONDITION_REMOVED':
      return `      ${model(event.modelId)} loses ${event.condition}`;
    case 'OBJECTIVE_SCORED':
      return `  ${playerOf(state, event.player)} scores ${event.points} VP`;
    case 'GAME_ENDED':
      return `\n═══ Game over ${'═'.repeat(45)}`;
  }
}

function header(state: GameState, options: Options): string {
  const lines = [
    `Danger Room — demo game`,
    `seed ${options.seed} · ${MAX_ROUNDS} rounds · reactions ${options.useReactions ? 'used' : 'declined'}`,
    '',
  ];

  for (const player of Object.values(state.players)) {
    lines.push(`  ${player.displayName}`);
    for (const id of player.squad) {
      const m = state.models[id];
      const profile = m ? state.profiles[m.characterId] : undefined;
      if (!m || !profile) continue;

      const s = statsAt(profile, m.health);
      const attacks = s.attacks.map(a => `${a.name} ${a.dice}d R${a.range}`).join(', ');
      lines.push(
        `    ${profile.name.padEnd(22)} ${s.stamina} stamina · ${s.movement} move · ` +
          `def ${s.defense.physical}/${s.defense.energy}/${s.defense.mystic}`,
      );
      if (attacks) lines.push(`      ${attacks}`);
    }
  }
  return lines.join('\n');
}

function summary(state: GameState): string {
  const lines = ['', 'Final position', ''];

  for (const player of Object.values(state.players)) {
    lines.push(`  ${player.displayName}   ${player.victoryPoints} VP`);
    for (const id of player.squad) {
      const m = state.models[id];
      if (!m) continue;
      const status = m.health === 'ko' ? "KO'd" : m.dazed ? `Dazed on ${m.damage}` : m.health;
      lines.push(
        `    ${nameOf(state, id).padEnd(24)} ${status.padEnd(14)} ` +
          `${m.damage} damage · ${m.power} power`,
      );
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  let state: GameState = createGame(playableSparringSpec(options.seed));

  console.log(header(state, options));

  let steps = 0;
  let idle = 0;
  const seen = new Set<GameEvent['type']>();

  // Bounded so a rules bug prints a complaint rather than spinning forever.
  const limit = 5000;
  while (state.phase !== 'finished' && steps < limit) {
    const step = autoPlayStep(state, { useReactions: options.useReactions });
    if (!step) break;
    steps++;

    if (!step.result.ok) {
      console.log(`  ✗ ${step.action.type} rejected: ${step.result.rejection.message}`);
      break;
    }

    if (step.rejected) {
      console.log(`      (${step.rejected.action.type} refused: ${step.rejected.rejection.message})`);
    }

    // "Activates, does nothing" is unreadable without a reason.
    if (step.action.type === 'END_ACTIVATION' && !step.rejected) {
      const activating = state.prompt?.kind === 'chooseAction' ? state.prompt.modelId : null;
      const why = activating ? describeInaction(state, activating) : null;
      if (why && why !== 'nothing to do') {
        idle++;
        console.log(`    — ${why}`);
      }
    }

    for (const event of step.result.events) {
      seen.add(event.type);
      console.log(render(step.result.state, event));
    }
    state = step.result.state;
  }

  console.log(summary(state));

  if (state.phase !== 'finished') {
    console.log(`\n⚠ stopped after ${steps} steps without finishing — phase is ${state.phase}.`);
    process.exitCode = 1;
    return;
  }

  // What the transcript could not say. Both are missing events rather than
  // missing rules, which is exactly what narrating from the event stream is
  // supposed to surface.
  const gaps: string[] = [];
  if (!seen.has('MODEL_MOVED')) gaps.push('nobody moved this run');
  gaps.push('round 1’s Power Phase is invisible: createGame grants it without emitting events');
  gaps.push('no event marks a phase beginning, so Power and Cleanup are inferred from what follows');
  if (idle > 0) {
    gaps.push(
      `${idle} activations did nothing — the driver walks straight at its target ` +
        'and cannot path around terrain',
    );
  }

  console.log(`\nNotes on this transcript:`);
  for (const gap of gaps) console.log(`  · ${gap}`);
  console.log(`\n${steps} actions · reproduce with: ${reproduceCommand(options)}`);
}

main();
