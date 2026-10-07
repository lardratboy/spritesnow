/* Seeded randomness. Pure.
   Port target: reference/symmetrical_sprite_generator.html `mulberry32`.
   Math.random never appears in src/core/: every random choice comes from a
   recipe's seed, so a recipe reproduces its sprite exactly. */

const todo = name => { throw new Error(`not implemented: rng.${name} (M1)`); };

/** mulberry32 PRNG. @param {number} seed uint32 @returns {() => number} in [0,1) */
export function mulberry32(seed){ return todo('mulberry32'); }

/** Integer hash of two 32-bit values, for deriving seeds. @returns {number} uint32 */
export function hash32(a, b){ return todo('hash32'); }
