/**
 * Range measurement.
 *
 * MCP measures base-to-base, not centre-to-centre: a Range 3 effect reaches
 * anything whose *base* falls within the tool's third segment when the tool is
 * held against the *edge* of the acting model's base. Modelling bases as
 * cylinders makes this a subtraction.
 */

import { RANGE_INCHES } from '../constants.js';
import { distanceHorizontal, type Vec3 } from './vec.js';

/** Anything that occupies space on the table. */
export interface Footprint {
  readonly pos: Vec3;
  /** Base radius in inches. */
  readonly radius: number;
  /** Height in inches, used for line of sight rather than range. */
  readonly height: number;
}

/**
 * Edge-to-edge horizontal distance in inches. Clamped at 0 — overlapping or
 * touching bases are at distance 0, which is what "in base contact" means.
 */
export function edgeDistance(a: Footprint, b: Footprint): number {
  return Math.max(0, distanceHorizontal(a.pos, b.pos) - a.radius - b.radius);
}

export type RangeBand = 1 | 2 | 3 | 4 | 5;

/** Is `target` within Range `band` of `source`? */
export function withinRange(source: Footprint, target: Footprint, band: RangeBand): boolean {
  return edgeDistance(source, target) <= RANGE_INCHES[band];
}

/** The tightest range band that reaches `target`, or null if out of Range 5. */
export function rangeBandTo(source: Footprint, target: Footprint): RangeBand | null {
  const d = edgeDistance(source, target);
  const bands: RangeBand[] = [1, 2, 3, 4, 5];
  return bands.find(band => d <= RANGE_INCHES[band]) ?? null;
}

/** Bases touching — MCP's "base contact". */
export function inBaseContact(a: Footprint, b: Footprint): boolean {
  return edgeDistance(a, b) <= 0;
}
