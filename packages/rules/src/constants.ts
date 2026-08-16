/**
 * MCP rules constants.
 *
 * ⚠️  EVERY VALUE IN THIS FILE NEEDS VERIFICATION against the current official
 * rulebook before the engine can be trusted. They are isolated here precisely
 * so that correcting them is a one-file edit rather than an archaeology dig
 * through the engine.
 *
 * Units are inches throughout. The table is 3'x3' = 36"x36".
 */

/** Table dimensions in inches. */
export const TABLE_SIZE = { width: 36, depth: 36 } as const;

/**
 * Range bands R1–R5, as the radius in inches reached by each segment of the
 * physical range tool.
 *
 * TODO(verify): measured off the physical tool. Placeholder values.
 */
export const RANGE_INCHES: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 2,
  2: 3.5,
  3: 5,
  4: 6.5,
  5: 8,
};

/**
 * Movement templates. MCP moves are made with a physical tool placed against
 * the base; the model ends its move at the far end. We model a template as a
 * maximum path length — see `geometry/movement.ts` for why that is a
 * simplification and what it costs us.
 *
 * TODO(verify): placeholder values.
 */
export const MOVEMENT_INCHES = {
  S: 3,
  M: 4,
  L: 5,
} as const;

export type MovementTemplate = keyof typeof MOVEMENT_INCHES;

/**
 * Base radii in inches by base size in mm. Models are treated as cylinders.
 *
 * TODO(verify): confirm which characters use which base.
 */
export const BASE_RADIUS_INCHES: Readonly<Record<number, number>> = {
  25: 0.49,
  40: 0.79,
  50: 0.98,
  65: 1.28,
};

/**
 * Character Size (1–4) drives terrain interaction and line of sight. Height is
 * used for LOS occlusion math.
 *
 * TODO(verify): heights are invented; the rulebook expresses this in terms of
 * terrain size comparisons rather than absolute inches.
 */
export const SIZE_HEIGHT_INCHES: Readonly<Record<number, number>> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

/** Standard game length in rounds. TODO(verify). */
export const MAX_ROUNDS = 6;
