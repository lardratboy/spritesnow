/* Integer-scale rasteriser. v1 is integer scale only: every pixel is a
   palette colour, there are no seams, and the output is exact.
   Fractional scale (the seam-colour kernel from mosprites-ng) is deferred
   (newdesign.md §3). Writes ImageData directly; never uses fillRect. */

const todo = name => { throw new Error(`not implemented: rasterize.${name} (M2)`); };

/** @param {{sprite:object, col:number, row:number}[]} items
 *  @param {{cols:number, rows:number, cellW:number, cellH:number, spacing:number}} layout
 *  @param {{scale:number, matte:string|null}} policy  scale must be an integer
 *  @returns {ImageData-like {width, height, data:Uint8ClampedArray}} */
export function rasterizeSheet(items, layout, policy){ return todo('rasterizeSheet'); }
export function rasterizeSolo(sprite, policy){ return todo('rasterizeSolo'); }
