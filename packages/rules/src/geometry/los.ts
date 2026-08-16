/**
 * Line of sight.
 *
 * This is the single most 3D-dependent rule in the game and the reason the
 * engine stores elevation from the start. MCP traces LOS from any part of the
 * attacker's base to any part of the target's base; terrain blocks depending
 * on its size relative to the models involved.
 *
 * The implementation below is a defensible approximation, not a faithful
 * transcription of the rulebook: it samples the silhouette rather than solving
 * the volume analytically. It is isolated behind `hasLineOfSight` so a stricter
 * implementation can replace it without touching callers.
 *
 * TODO(rules): reconcile with the official terrain-size and cover rules.
 */

import type { Footprint } from './measure.js';
import { distanceToSegmentHorizontal, lerp, vec3, type Vec3 } from './vec.js';

export interface TerrainVolume {
  readonly id: string;
  /** Centre of the footprint at table level. */
  readonly pos: Vec3;
  /** Treated as a cylinder for occlusion purposes. */
  readonly radius: number;
  /** Height in inches above `pos.z`. */
  readonly height: number;
  /** MCP terrain size category (1–5). Drives whether it blocks at all. */
  readonly size: number;
  /** Some terrain never blocks LOS regardless of size. */
  readonly blocksLineOfSight: boolean;
}

export interface LineOfSightResult {
  readonly clear: boolean;
  /** Terrain that interrupted the trace, if any. */
  readonly blockedBy: readonly string[];
  /** True when terrain intersects the trace without fully blocking it. */
  readonly obscured: boolean;
}

/** Number of samples taken along the attacker→target segment. */
const TRACE_SAMPLES = 16;

/**
 * Trace from the top of the attacker's silhouette to the top of the target's.
 * A terrain volume blocks when the traced segment passes through its cylinder
 * below its top face.
 */
export function hasLineOfSight(
  source: Footprint,
  target: Footprint,
  terrain: readonly TerrainVolume[],
): LineOfSightResult {
  const from = vec3(source.pos.x, source.pos.y, source.pos.z + source.height * 0.5);
  const to = vec3(target.pos.x, target.pos.y, target.pos.z + target.height * 0.5);

  const blockedBy: string[] = [];
  let obscured = false;

  for (const volume of terrain) {
    if (!volume.blocksLineOfSight) continue;

    // Cheap rejection: does the segment come near the cylinder at all?
    const horizontal = distanceToSegmentHorizontal(volume.pos, from, to);
    if (horizontal > volume.radius) continue;

    obscured = true;

    // Sample the segment; if any sample sits inside the cylinder, it blocks.
    for (let i = 0; i <= TRACE_SAMPLES; i++) {
      const point = lerp(from, to, i / TRACE_SAMPLES);
      const withinFootprint = Math.hypot(point.x - volume.pos.x, point.y - volume.pos.y) <= volume.radius;
      const belowTop = point.z <= volume.pos.z + volume.height;
      const aboveBase = point.z >= volume.pos.z;

      if (withinFootprint && belowTop && aboveBase) {
        blockedBy.push(volume.id);
        break;
      }
    }
  }

  return { clear: blockedBy.length === 0, blockedBy, obscured };
}
