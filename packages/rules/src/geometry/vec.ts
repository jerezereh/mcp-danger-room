/**
 * 3D vectors, in inches.
 *
 * We store three dimensions from day one even though the first client renders
 * a top-down orthographic view. `z` is elevation above the table. Range is
 * measured horizontally in MCP, so most math deliberately ignores `z` — but
 * line of sight and terrain do not, and retrofitting a third axis later would
 * mean touching every stored position, every serialized game, and every test.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });

export const ORIGIN: Vec3 = vec3(0, 0, 0);

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, k: number): Vec3 => vec3(a.x * k, a.y * k, a.z * k);

/** Full 3D length. */
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

/** Length ignoring elevation — the plane the range tool actually measures in. */
export const lengthHorizontal = (a: Vec3): number => Math.hypot(a.x, a.y);

/** Straight-line distance between two points, ignoring elevation. */
export const distanceHorizontal = (a: Vec3, b: Vec3): number => lengthHorizontal(sub(a, b));

/** Straight-line distance between two points in full 3D. */
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? ORIGIN : scale(a, 1 / len);
}

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

/**
 * Shortest distance from point `p` to the segment `a`–`b`, in the horizontal
 * plane. Used for terrain-edge checks and for testing whether a model's base
 * is clipped by a movement path.
 */
export function distanceToSegmentHorizontal(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return distanceHorizontal(p, a);

  const raw = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  const t = Math.max(0, Math.min(1, raw));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}
