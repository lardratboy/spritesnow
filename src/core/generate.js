/* generateSprite: the pure core. Recipe in, sprite out.
   Port target: reference `generateSprite` and `toGen`. The only intended
   difference is that symmetry goes through groups2d.orbitTable() instead of
   the old fold() switch.

   M1 contract (test/core.test.js):
     · fold: 1 matches the reference byte for byte, for every fixture
     · fold: 2 matches the reference on every case docs/from3Dto2D.md §3
       marks exact, and is symmetric (aut >= |G|) everywhere */

const todo = name => { throw new Error(`not implemented: generate.${name} (M1)`); };

/**
 * @param {number} seed  per-sprite uint32 seed
 * @param {object} gen   generator settings from recipe/schema.js
 * @param {string[]} palette  from palette.paletteFor()
 * @returns {{ grid:Uint8Array[], colors:string[], w:number, h:number,
 *             group:string, effectiveGroup:string, recipeText:string }}
 */
export function generateSprite(seed, gen, palette){ return todo('generateSprite'); }
