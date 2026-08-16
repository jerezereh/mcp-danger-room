/**
 * One suite, both drivers.
 *
 * If either implementation had a different observable behaviour, this would
 * fail. The point of issue #4 is that they do not differ observably — so the
 * choice between them is about maintainability, not correctness.
 */

import { describe, expect, it } from 'vitest';

import type { ModelId, PlayerId } from '../ids.js';
import { createRng } from '../rng.js';
import { frameDriver } from './frames.js';
import { generatorDriver } from './generator.js';
import type { Answer, AttackContext, AttackDriver, AttackResult } from './shared.js';

const ctx: AttackContext = {
  attackerId: 'm1' as ModelId,
  attackerOwner: 'p1' as PlayerId,
  targetId: 'm2' as ModelId,
  targetOwner: 'p2' as PlayerId,
  attackName: 'Spider Strike',
  attackDice: 6,
  defenseDice: 3,
  attackerPower: 4,
  targetPower: 4,
};

const drivers: AttackDriver[] = [frameDriver, generatorDriver];

/** Play an attack to completion, answering every prompt from `answers`. */
function play(driver: AttackDriver, seed: number, answers: readonly Answer[]): AttackResult {
  const rng = createRng(seed);
  let result = driver.begin(ctx, rng);
  let i = 0;

  while (result.status === 'awaiting') {
    const answer = answers[i++] ?? { kind: 'pass' as const };
    result = driver.resume(ctx, rng, result.resume, answer);
    if (i > 20) throw new Error('Too many prompts.');
  }
  return result;
}

const passEverything: Answer[] = [
  { kind: 'pass' },
  { kind: 'pass' },
  { kind: 'pass' },
  { kind: 'pass' },
];

const spendEverything: Answer[] = [
  { kind: 'react', superpower: 'Witty Banter' },
  { kind: 'spend', power: 3 },
  { kind: 'spend', power: 2 },
  { kind: 'spend', power: 1 },
];

describe.each(drivers)('$name driver', driver => {
  it('resolves an attack where both sides pass', () => {
    const result = play(driver, 7, passEverything);
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.outcome.damage).toBeGreaterThanOrEqual(0);
    expect(result.events[0]).toEqual({ type: 'declared', attackName: 'Spider Strike' });
  });

  it('pauses at every decision point', () => {
    const rng = createRng(7);
    const seen: string[] = [];
    let result = driver.begin(ctx, rng);

    while (result.status === 'awaiting') {
      seen.push(result.prompt.kind);
      result = driver.resume(ctx, rng, result.resume, { kind: 'spend', power: 2 });
      if (seen.length > 20) break;
    }

    expect(seen.slice(0, 3)).toEqual(['reactWhenTargeted', 'boostAttack', 'rerollDefense']);
  });

  it('keeps the resume token serializable', () => {
    // The constraint both options must satisfy. Neither wins on this axis —
    // that is the whole premise of the comparison.
    const result = driver.begin(ctx, createRng(7));
    expect(result.status).toBe('awaiting');
    if (result.status !== 'awaiting') return;

    const roundTripped = JSON.parse(JSON.stringify(result.resume));
    expect(roundTripped).toEqual(result.resume);
  });

  it('resumes correctly from a serialized token', () => {
    const rng = createRng(11);
    const first = driver.begin(ctx, rng);
    expect(first.status).toBe('awaiting');
    if (first.status !== 'awaiting') return;

    // Simulate the token making a round trip through storage or the wire.
    const revived = JSON.parse(JSON.stringify(first.resume));
    const direct = driver.resume(ctx, rng, first.resume, { kind: 'pass' });
    const viaStorage = driver.resume(ctx, rng, revived, { kind: 'pass' });

    expect(viaStorage).toEqual(direct);
  });

  it('is deterministic for a given seed and answer set', () => {
    expect(play(driver, 99, passEverything)).toEqual(play(driver, 99, passEverything));
  });

  it('produces different rolls for different seeds', () => {
    const a = play(driver, 1, passEverything);
    const b = play(driver, 12345, passEverything);
    expect(a).not.toEqual(b);
  });

  it('spending power adds dice and is charged', () => {
    const spent = play(driver, 5, spendEverything);
    expect(spent.status).toBe('done');
    if (spent.status !== 'done') return;

    expect(spent.outcome.attackerPowerSpent).toBeGreaterThan(0);
    expect(spent.events.some(e => e.type === 'diceAdded')).toBe(true);
    expect(spent.events.some(e => e.type === 'reacted')).toBe(true);
  });

  it('never spends more power than a player has', () => {
    const greedy: Answer[] = [
      { kind: 'react', superpower: 'X' },
      { kind: 'spend', power: 99 },
      { kind: 'spend', power: 99 },
      { kind: 'spend', power: 99 },
    ];
    const result = play(driver, 3, greedy);
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;

    expect(result.outcome.attackerPowerSpent).toBeLessThanOrEqual(ctx.attackerPower);
    expect(result.outcome.targetPowerSpent).toBeLessThanOrEqual(ctx.targetPower);
  });

  it('never deals negative damage', () => {
    for (let seed = 0; seed < 40; seed++) {
      const result = play(driver, seed, passEverything);
      if (result.status !== 'done') continue;
      expect(result.outcome.damage).toBeGreaterThanOrEqual(0);
    }
  });

  it('gains the attacker power equal to damage dealt', () => {
    for (let seed = 0; seed < 20; seed++) {
      const result = play(driver, seed, passEverything);
      if (result.status !== 'done') continue;
      expect(result.outcome.attackerPowerGained).toBe(result.outcome.damage);
    }
  });
});

describe('the two drivers agree', () => {
  const scenarios: { label: string; answers: Answer[] }[] = [
    { label: 'both pass', answers: passEverything },
    { label: 'both spend', answers: spendEverything },
    { label: 'defender reacts only', answers: [{ kind: 'react', superpower: 'Witty Banter' }] },
    { label: 'attacker boosts only', answers: [{ kind: 'pass' }, { kind: 'spend', power: 2 }] },
  ];

  it.each(scenarios)('produces identical outcomes — $label', ({ answers }) => {
    for (let seed = 0; seed < 25; seed++) {
      const viaFrames = play(frameDriver, seed, answers);
      const viaGenerator = play(generatorDriver, seed, answers);

      expect(viaFrames.status).toBe('done');
      expect(viaGenerator.status).toBe('done');
      if (viaFrames.status !== 'done' || viaGenerator.status !== 'done') continue;

      expect(viaGenerator.outcome).toEqual(viaFrames.outcome);
      expect(viaGenerator.events).toEqual(viaFrames.events);
    }
  });

  it('asks the same questions in the same order', () => {
    const promptsFrom = (driver: AttackDriver): string[] => {
      const rng = createRng(4);
      const prompts: string[] = [];
      let result = driver.begin(ctx, rng);
      while (result.status === 'awaiting' && prompts.length < 20) {
        prompts.push(result.prompt.kind);
        result = driver.resume(ctx, rng, result.resume, { kind: 'spend', power: 2 });
      }
      return prompts;
    };

    expect(promptsFrom(generatorDriver)).toEqual(promptsFrom(frameDriver));
  });

  it('advances the RNG identically', () => {
    // If replay consumed a different number of draws than the frame stack, the
    // two would desync here. This is the test that proves replay is sound.
    const viaFrames = play(frameDriver, 77, spendEverything);
    const viaGenerator = play(generatorDriver, 77, spendEverything);

    expect(viaFrames.status).toBe('done');
    expect(viaGenerator.status).toBe('done');
    if (viaFrames.status !== 'done' || viaGenerator.status !== 'done') return;

    expect(viaGenerator.rng).toEqual(viaFrames.rng);
  });

  it('replay does not duplicate events', () => {
    // The characteristic failure mode of the generator approach: re-running the
    // flow must rebuild the event list, not append to it.
    const rng = createRng(21);
    let result = generatorDriver.begin(ctx, rng);
    let resumes = 0;

    while (result.status === 'awaiting') {
      result = generatorDriver.resume(ctx, rng, result.resume, { kind: 'pass' });
      resumes++;
      if (resumes > 10) break;
    }

    expect(result.status).toBe('done');
    if (result.status !== 'done') return;

    const declared = result.events.filter(e => e.type === 'declared');
    expect(declared).toHaveLength(1);
  });
});
