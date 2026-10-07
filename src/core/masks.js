/* The 11 shape masks. Pure.
   Port target: reference `MASKS` and the CA "blob" mask inside
   `generateSprite`.
   Note for the symmetry engine: shape masks are evaluated per cell, so they
   move to orbits cleanly. The blob mask and the noise+CA source look at
   neighbours in the old seed region, so they need their own orbit definition
   (docs/from3Dto2D.md §6 P1, caveat). */

const todo = name => { throw new Error(`not implemented: masks.${name} (M1)`); };

/** @type {{id:string, name:string, m:((nx:number, ny:number, r:number) => boolean) | null}[]} */
export const MASKS = [];
export const MASK_BY_ID = {};

/** CA-smoothed random blob over the representative cells. */
export function blobMask(rnd, w, h, orbitTable){ return todo('blobMask'); }
