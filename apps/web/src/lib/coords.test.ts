/**
 * The coordinate swap, which has been wrong before.
 *
 * Getting the forward direction wrong renders the board mirrored, which is
 * at least visible. Getting the *inverse* wrong is worse now that a click on
 * the table is a move order: the model goes somewhere other than where the
 * player pointed, and the engine has no way to know it was not meant.
 */

import { describe, expect, it } from 'vitest';
import { TABLE_SIZE, vec3 } from '@danger-room/rules';

import { fromScene, toScene } from './coords.js';

describe('table ↔ scene', () => {
  it('round-trips every corner of the table', () => {
    const corners = [
      vec3(0, 0, 0),
      vec3(TABLE_SIZE.width, 0, 0),
      vec3(0, TABLE_SIZE.depth, 0),
      vec3(TABLE_SIZE.width, TABLE_SIZE.depth, 0),
      vec3(12, 18, 0),
    ];

    for (const point of corners) {
      const [x, up, z] = toScene(point.x, point.y, point.z);
      expect(fromScene({ x, y: up, z })).toEqual(point);
    }
  });

  it('keeps elevation as elevation', () => {
    const [x, up, z] = toScene(4, 9, 3);
    expect(up).toBe(3);
    expect(fromScene({ x, y: up, z })).toEqual(vec3(4, 9, 3));
  });

  it('puts +y up the screen rather than down', () => {
    // The negated y is the whole subtlety. A model further up the table must
    // come out with a *smaller* scene z, because the top-down camera has −Z
    // pointing up the screen.
    const near = toScene(10, 5);
    const far = toScene(10, 25);
    expect(far[2]).toBeLessThan(near[2]);
  });

  it('leaves +x running right', () => {
    expect(toScene(20, 10)[0]).toBeGreaterThan(toScene(10, 10)[0]);
  });

  it('reads a click with no elevation as table level', () => {
    // three.js hands back a full Vector3 on a click, but the table plane is at
    // height 0 and a caller may pass only the two axes it cares about.
    expect(fromScene({ x: 7, z: -3 })).toEqual(vec3(7, 3, 0));
  });
});
