import { describe, expect, it } from 'vitest';
import { MOVEMENT_INCHES } from '@danger-room/rules';

import { inches, toolInches } from './format.js';

describe('toolInches', () => {
  it('prints each movement tool the way the tool is printed', () => {
    expect(toolInches(MOVEMENT_INCHES.S)).toBe('3⅜"');
    expect(toolInches(MOVEMENT_INCHES.M)).toBe('5"');
    expect(toolInches(MOVEMENT_INCHES.L)).toBe('7¼"');
  });

  it('never rounds a tool up the way inches() does', () => {
    // The bug this exists for: `inches()` renders the Short tool as 3.4" and
    // the Long as 7.3", both longer than the engine will actually allow.
    expect(inches(MOVEMENT_INCHES.S)).toBe('3.4"');
    expect(toolInches(MOVEMENT_INCHES.S)).not.toBe(inches(MOVEMENT_INCHES.S));
  });

  it('drops the whole part when there is none', () => {
    expect(toolInches(0.5)).toBe('½"');
    expect(toolInches(0)).toBe('0"');
  });

  it('falls back to a decimal for anything that is not a whole eighth', () => {
    expect(toolInches(3.3)).toBe('3.3"');
    expect(toolInches(-1)).toBe('-1.0"');
  });
});
