/* Seeded randomness. Pure.
   Ported from reference `mulberry32`; core.test.js checks the sequences match.
   Math.random never appears in src/core/: every random choice comes from a
   recipe's seed, so a recipe reproduces its sprite exactly. */

/** mulberry32 PRNG. @param {number} a seed (uint32) @returns {() => number} in [0,1) */
export function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Integer hash of two 32-bit values, for deriving seeds (block-showroom's
 *  hash32, src/lattice/recipe.js). @returns {number} uint32 */
export function hash32(a, b){
  let h = ((a | 0) ^ Math.imul((b | 0) + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
