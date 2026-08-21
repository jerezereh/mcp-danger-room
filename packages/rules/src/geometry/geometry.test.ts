import { describe, expect, it } from 'vitest';

import { hasLineOfSight, type TerrainVolume } from './los.js';
import { edgeDistance, inBaseContact, rangeBandTo, withinRange } from './measure.js';
import { distanceHorizontal, distanceToSegmentHorizontal, vec3 } from './vec.js';

const model = (x: number, y: number, z = 0, radius = 0.79, height = 2) => ({
  pos: vec3(x, y, z),
  radius,
  height,
});

describe('measurement', () => {
  it('measures base to base, not centre to centre', () => {
    const a = model(0, 0);
    const b = model(4, 0);
    // Centres are 4" apart; each base eats 0.79".
    expect(distanceHorizontal(a.pos, b.pos)).toBeCloseTo(4);
    expect(edgeDistance(a, b)).toBeCloseTo(4 - 0.79 * 2);
  });

  it('clamps touching bases to zero rather than going negative', () => {
    expect(edgeDistance(model(0, 0), model(1, 0))).toBe(0);
    expect(inBaseContact(model(0, 0), model(1, 0))).toBe(true);
  });

  it('ignores elevation when measuring range', () => {
    const flat = edgeDistance(model(0, 0, 0), model(4, 0, 0));
    const raised = edgeDistance(model(0, 0, 0), model(4, 0, 6));
    expect(raised).toBeCloseTo(flat);
  });

  it('reports the tightest band that reaches the target', () => {
    expect(rangeBandTo(model(0, 0), model(1.6, 0))).toBe(1);
    expect(rangeBandTo(model(0, 0), model(30, 0))).toBeNull();
  });

  it('agrees with withinRange', () => {
    const a = model(0, 0);
    const b = model(5, 0);
    const band = rangeBandTo(a, b);
    expect(band).not.toBeNull();
    if (band) expect(withinRange(a, b, band)).toBe(true);
  });
});

describe('point-to-segment distance', () => {
  it('measures perpendicular distance when the foot falls inside', () => {
    expect(distanceToSegmentHorizontal(vec3(5, 3, 0), vec3(0, 0, 0), vec3(10, 0, 0))).toBeCloseTo(
      3,
    );
  });

  it('clamps to the endpoints when the foot falls outside', () => {
    expect(distanceToSegmentHorizontal(vec3(-4, 0, 0), vec3(0, 0, 0), vec3(10, 0, 0))).toBeCloseTo(
      4,
    );
  });

  it('handles a degenerate zero-length segment', () => {
    expect(distanceToSegmentHorizontal(vec3(3, 4, 0), vec3(0, 0, 0), vec3(0, 0, 0))).toBeCloseTo(5);
  });
});

describe('line of sight', () => {
  const wall = (over: Partial<TerrainVolume> = {}): TerrainVolume => ({
    id: 'wall',
    pos: vec3(5, 0, 0),
    radius: 1,
    height: 6,
    size: 3,
    blocksLineOfSight: true,
    ...over,
  });

  it('is clear across an empty table', () => {
    expect(hasLineOfSight(model(0, 0), model(10, 0), []).clear).toBe(true);
  });

  it('is blocked by tall terrain on the line', () => {
    const result = hasLineOfSight(model(0, 0), model(10, 0), [wall()]);
    expect(result.clear).toBe(false);
    expect(result.blockedBy).toContain('wall');
  });

  it('is not blocked by terrain off the line', () => {
    expect(hasLineOfSight(model(0, 0), model(10, 0), [wall({ pos: vec3(5, 8, 0) })]).clear).toBe(
      true,
    );
  });

  it('is not blocked by terrain flagged as non-blocking', () => {
    expect(
      hasLineOfSight(model(0, 0), model(10, 0), [wall({ blocksLineOfSight: false })]).clear,
    ).toBe(true);
  });

  it('clears a low wall when both models stand on rooftops', () => {
    // The case that justifies storing elevation: identical footprints, opposite
    // answers, decided entirely by z.
    const low = wall({ height: 2 });
    expect(hasLineOfSight(model(0, 0, 0), model(10, 0, 0), [low]).clear).toBe(false);
    expect(hasLineOfSight(model(0, 0, 8), model(10, 0, 8), [low]).clear).toBe(true);
  });
});
