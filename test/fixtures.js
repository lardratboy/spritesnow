/* The recipe matrix behind golden.json. Adding entries is fine; changing
   one invalidates its golden. Sizes cover even/odd and square/non-square,
   because that is where the old fold() differs (docs/from3Dto2D.md §3). */

export const LEGACY_MODES = ['none','horizontal','vertical','quadrant','rot180','rot90','diagonal'];

export const SIZES = [
  [8,8], [9,9], [16,16], [15,15], [31,31],   // square, even and odd
  [16,12], [15,11],                          // non-square
  [9,10],                                    // ceil(w/2) == ceil(h/2), w != h: the diagonal edge case
];

export const SEEDS = [0x00000001, 0x2545f491, 0x9e3779b9, 0xdeadbeef];

export const SOURCES = [
  { source:'field', formula:'circle',  vary:false },
  { source:'field', formula:'trefoil', vary:false },
  { source:'field', formula:'mix',     vary:true },
  { source:'noise', ca:true },
];

/** FNV-1a over bytes, as block-showroom's test/fixtures.js. */
export function fnv(bytes){
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++){ h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
