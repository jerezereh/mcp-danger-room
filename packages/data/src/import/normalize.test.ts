import { describe, expect, it } from 'vitest';

import { boldableNames, normalizeRulesText } from './normalize.js';

describe('normalizeRulesText', () => {
  it('capitalises the game terms the cards capitalise', () => {
    expect(normalizeRulesText('once per turn, it may advance during its activation')).toBe(
      'once per Turn, it may Advance during its Activation',
    );
  });

  it('capitalises inflected forms', () => {
    expect(normalizeRulesText('if it has advanced or advances again')).toBe(
      'if it has Advanced or Advances again',
    );
  });

  it('leaves the terms alone inside longer words', () => {
    // "return" and "turnip" both contain "turn".
    expect(normalizeRulesText('it may return the turnip')).toBe('it may return the turnip');
  });

  it('bolds the phase names', () => {
    expect(normalizeRulesText('during the Power Phase')).toBe('during the <b>Power Phase</b>');
    expect(normalizeRulesText('during the cleanup phase')).toBe('during the <b>Cleanup Phase</b>');
  });

  it("matches Modify Opponent's Dice whole rather than as Modify Dice", () => {
    expect(normalizeRulesText("during the Modify Opponent's Dice step")).toBe(
      "during the <b>Modify Opponent's Dice</b> step",
    );
  });

  it('leaves "modify dice" as a verb alone', () => {
    // "cannot reroll or modify dice" is prose; bolding it would name a step
    // the sentence is not talking about.
    expect(normalizeRulesText('cannot reroll or modify dice in the defense roll')).toBe(
      'cannot reroll or modify dice in the defense roll',
    );
  });

  it('bolds the character and its abilities', () => {
    const out = normalizeRulesText('If Dormammu uses Not of This Dimension', [
      'Dormammu',
      'Not of This Dimension',
    ]);
    expect(out).toBe('If <b>Dormammu</b> uses <b>Not of This Dimension</b>');
  });

  it('matches the longest ability name when one contains another', () => {
    const out = normalizeRulesText('make a Shadow Bolt Prime attack', [
      'Shadow Bolt',
      'Shadow Bolt Prime',
    ]);
    expect(out).toBe('make a <b>Shadow Bolt Prime</b> attack');
  });

  it('escapes regex characters in ability names', () => {
    expect(normalizeRulesText('gains Immunity [Bleed] now', ['Immunity [Bleed]'])).toBe(
      'gains <b>Immunity [Bleed]</b> now',
    );
  });

  it('never nests bold', () => {
    // Trigger names arrive already bolded; a phase inside one must not double.
    const out = normalizeRulesText('<b>Power Phase</b> and the Power Phase');
    expect(out).toBe('<b>Power Phase</b> and the <b>Power Phase</b>');
    expect(out).not.toMatch(/<b>[^<]*<b>/);
  });

  it('leaves glyph tokens untouched', () => {
    expect(normalizeRulesText('Advance {S} then {PWR}')).toBe('Advance {S} then {PWR}');
  });

  it('is idempotent', () => {
    const once = normalizeRulesText('once per turn during the power phase', ['Dormammu']);
    expect(normalizeRulesText(once, ['Dormammu'])).toBe(once);
  });

  it('ignores names too short to be safe', () => {
    // A three-letter ability name would match inside ordinary words.
    expect(normalizeRulesText('the cat sat', ['cat'])).toBe('the cat sat');
  });
});

describe('boldableNames', () => {
  it('collects the character and every ability on both faces', () => {
    const names = boldableNames({
      name: 'Nova',
      healthy: { attacks: [{ name: 'Nova Burst' }], superpowers: [{ name: 'Nova Force' }] },
      injured: { attacks: [{ name: 'Gravimetric Cannon' }], superpowers: [] },
    });
    expect(names).toEqual(['Nova', 'Nova Burst', 'Nova Force', 'Gravimetric Cannon']);
  });
});
