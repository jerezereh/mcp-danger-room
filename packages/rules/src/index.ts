/**
 * @danger-room/rules
 *
 * A headless, deterministic MCP rules engine.
 *
 * This package imports nothing — not React, not three.js, not the network, not
 * the filesystem. That constraint is deliberate and load-bearing: the same code
 * runs in the browser for local play, on the server as the authority for online
 * play, and inside a Web Worker as the simulator an AI opponent searches over.
 * Anything that breaks the constraint breaks all three at once.
 */

export * from './actions.js';
export * from './constants.js';
export * from './dice.js';
export * from './engine.js';
export * from './events.js';
export * from './geometry/los.js';
export * from './geometry/measure.js';
export * from './geometry/vec.js';
export * from './ids.js';
export * from './rng.js';
export * from './setup.js';
export * from './state.js';
