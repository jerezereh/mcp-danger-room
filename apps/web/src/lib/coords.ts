/**
 * Table coordinates ↔ scene coordinates.
 *
 * The engine works in table space: `x`/`y` across the 36" board with `z` as
 * elevation. three.js works in `x`/`z` with `y` up. The swap is confined to
 * this module so the engine never has to think about rendering conventions.
 *
 * The negated `y` is the part that is easy to get wrong, and it has been.
 * Looking straight down flips handedness: with the camera above and `up` =
 * +Z, camera-right works out to world −X, and the board renders mirrored —
 * a model at x=16 draws to the *left* of one at x=12. Negating `y` here, with
 * `up` = −Z on the camera, is what buys both "+x runs right" and "+y runs up"
 * at once. A single flip can only ever fix one of the two.
 *
 * Now that a click on the table is a move order, the inverse matters as much
 * as the forward direction: a sign error puts the model somewhere other than
 * where the player pointed, and the engine has no way to know it was not
 * meant.
 */

import { vec3, type Vec3 } from '@danger-room/rules';

/** Table (x, y, elevation) → three.js (x, up, z). */
export const toScene = (x: number, y: number, z = 0): [number, number, number] => [x, z, -y];

/** three.js (x, up, z) → table (x, y, elevation). */
export const fromScene = (point: { x: number; y?: number; z: number }): Vec3 =>
  vec3(point.x, -point.z, point.y ?? 0);
