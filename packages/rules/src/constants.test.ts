import { describe, expect, it } from 'vitest';

import {
  BASE_DIAMETERS_MM,
  MOVEMENT_INCHES,
  RANGE_INCHES,
  radiusForBaseMm,
  TABLE_SIZE,
} from './constants.js';

/**
 * The measured constants.
 *
 * These assertions restate values the code already holds, which is normally
 * worthless — but nothing in the engine breaks if one of them drifts. A wrong
 * range band produces a game that runs, logs cleanly, and is simply not MCP,
 * which is exactly the failure that took issue #10 to notice. Every number
 * here came off the physical tools and the rulebook by hand; this is what
 * stops the next edit from quietly un-measuring them.
 */
describe('measured constants', () => {
  it('holds the range tool’s five segments', () => {
    expect(RANGE_INCHES).toEqual({ 1: 1, 2: 3, 3: 6, 4: 8, 5: 10 });
  });

  it('has range bands that only ever grow', () => {
    const bands = [1, 2, 3, 4, 5] as const;
    for (const band of bands.slice(1)) {
      expect(RANGE_INCHES[band]).toBeGreaterThan(RANGE_INCHES[(band - 1) as 1 | 2 | 3 | 4]);
    }
  });

  it('holds the three movement tools’ lengths', () => {
    // Short 3⅜" (86mm), Medium 5" (127mm), Long 7¼" (184mm).
    expect(MOVEMENT_INCHES).toEqual({ S: 3.375, M: 5, L: 7.25 });
  });

  it('keeps the templates in the order their names claim', () => {
    // `longerThan` in engine.ts compares templates by *name* — S < M < L — and
    // never looks at the inches. If the two ever disagreed, a character with a
    // printed S move could legally take the longer tool.
    expect(MOVEMENT_INCHES.S).toBeLessThan(MOVEMENT_INCHES.M);
    expect(MOVEMENT_INCHES.M).toBeLessThan(MOVEMENT_INCHES.L);
  });

  it('plays on a 3’x3’ board', () => {
    expect(TABLE_SIZE).toEqual({ width: 36, depth: 36 });
  });

  it('converts each of the four standard bases to a radius', () => {
    expect(radiusForBaseMm(BASE_DIAMETERS_MM.small)).toBeCloseTo(0.689, 3);
    expect(radiusForBaseMm(BASE_DIAMETERS_MM.medium)).toBeCloseTo(0.7874, 3);
    expect(radiusForBaseMm(BASE_DIAMETERS_MM.large)).toBeCloseTo(0.9843, 3);
    expect(radiusForBaseMm(BASE_DIAMETERS_MM.huge)).toBeCloseTo(1.2795, 3);
  });

  it('converts a base size the game has not printed instead of falling back', () => {
    // The lookup table this replaced was missing 35mm and silently answered
    // with the 40mm default, so the 145 characters on small bases all measured
    // range from a base 2.5mm too wide.
    expect(radiusForBaseMm(30)).toBeCloseTo(30 / 2 / 25.4, 6);
    expect(radiusForBaseMm(30)).toBeLessThan(radiusForBaseMm(BASE_DIAMETERS_MM.small));
  });
});
