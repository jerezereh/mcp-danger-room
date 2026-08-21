/**
 * MCP rules constants.
 *
 * Units are inches throughout, because the game's own tools are cut in inches:
 * every range band is a whole inch and two of the three movement tools are.
 * Where a published mm figure exists it is recorded in the comment rather than
 * converted, since the mm numbers are themselves roundings of the inch ones.
 *
 * Everything here was a placeholder until issue #10. What is still estimated
 * says so; anything else has been checked.
 */

/**
 * Table dimensions in inches.
 *
 * Verified: the standard board is 3'x3'.
 */
export const TABLE_SIZE = { width: 36, depth: 36 } as const;

/**
 * Range bands R1–R5, as the radius in inches reached by each segment of the
 * physical range tool.
 *
 * Verified. The bands are not evenly spaced — the steps run 2", 3", 2", 2" —
 * which is why they could not have been guessed. The placeholders spread them
 * evenly from 2" to 8" and so were wrong at every band: R1 was double its real
 * reach and R5 fell 2" short.
 *
 * Measured edge-to-edge, like every distance in this game. See
 * `geometry/measure.ts`.
 */
export const RANGE_INCHES: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 1,
  2: 3,
  3: 6,
  4: 8,
  5: 10,
};

/**
 * Movement templates, as the length of the physical tool.
 *
 * Verified: Short 3⅜" (86mm), Medium 5" (127mm), Long 7¼" (184mm). The
 * placeholders were 3/4/5, so every move in the game was short — a Long move
 * by 2¼", which is further than R1 reaches.
 *
 * A move is measured edge-to-edge like everything else: the tool goes against
 * the model's base and the model ends with that base at the far end. But both
 * ends of that measurement are the *same* base, so the centre travels the
 * tool's full length and a path length from the centre is the correct model,
 * not an approximation of one. What the engine does approximate is the
 * *shape*: the real tool bends at its pivot, tracing an arc, while the engine
 * takes any path of at most this length. See the MOVE case in `engine.ts`.
 */
export const MOVEMENT_INCHES = {
  S: 3.375,
  M: 5,
  L: 7.25,
} as const;

export type MovementTemplate = keyof typeof MOVEMENT_INCHES;

/**
 * The four standard base categories, as diameters in mm.
 *
 * Verified: bases are standardised into these four sizes and no others. Which
 * one a character uses is character-specific and lives in the corpus as
 * `baseMm`, sourced from jarvis-protocol.com.
 *
 * The placeholder table also carried a 25mm entry, which is not one of the
 * categories and which no character in the corpus ever used.
 */
export const BASE_DIAMETERS_MM = {
  small: 35,
  medium: 40,
  large: 50,
  huge: 65,
} as const;

const MM_PER_INCH = 25.4;

/**
 * Base radius in inches for a base diameter in mm. Models are treated as
 * cylinders.
 *
 * A conversion rather than a lookup table, which is the whole fix: the table
 * this replaces was missing 35mm — the base 145 of 233 characters use — so
 * every one of them silently fell back to the 40mm default and measured range
 * from a base 2.5mm too wide. A formula has no missing entries to fall back
 * from, and stays right for a base size the game has not printed yet.
 */
export const radiusForBaseMm = (mm: number): number => mm / 2 / MM_PER_INCH;

/**
 * Character Size (1–5) drives terrain interaction and line of sight. Height is
 * used for LOS occlusion math.
 *
 * TODO(verify): **still an estimate, and not one the sources can settle.**
 * Height is character-specific like the base is, but unlike the base it is
 * published nowhere: the rulebook expresses size through terrain comparisons
 * rather than absolute inches, and jarvis-protocol.com does not list it. One
 * inch per Size band is a stand-in until models are measured, and it is the
 * last invented distance left in this file.
 */
export const SIZE_HEIGHT_INCHES: Readonly<Record<number, number>> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  // Size 5 is real and rare — Dormammu and the two Sentinel MK4 variants.
  // Without an entry all three stood 2" tall and were seen over by mistake.
  5: 5,
};

/**
 * How far into the table a player may deploy at the start of a match:
 * "players deploy within Range 3 of their own battlefield edge unless the
 * Crisis card states otherwise."
 *
 * Verified, and recorded here ahead of its use because deployment is not
 * modelled yet — `createGame` takes positions from its caller and asks no
 * questions. This is the number the zone will be built from when it is.
 */
export const DEPLOYMENT_RANGE_BAND = 3;

/**
 * Standard game length in rounds.
 *
 * Verified: "A game of Crisis Protocol is played over six Rounds."
 */
export const MAX_ROUNDS = 6;

/**
 * Power every character gains at the start of the Power Phase.
 *
 * Verified: "At the beginning of the Power Phase, all characters gain 1
 * Power." The 106 superpowers that grant *additional* Power during this phase
 * are all measured against this baseline.
 */
export const POWER_PER_ROUND = 1;
