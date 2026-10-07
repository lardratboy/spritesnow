/* The recipe matrix behind golden.json. Adding entries is fine; changing
   one invalidates its golden. Sizes cover even/odd and square/non-square,
   because that is where the old fold() differs (docs/from3Dto2D.md §3).

   Configs use the REFERENCE app's cfg names (density, 'mask-scale', sw, …),
   because the goldens record what the reference produces. The port maps its
   own recipe names onto these in M1. */

export const LEGACY_MODES = ['none','horizontal','vertical','quadrant','rot180','rot90','diagonal'];

export const SIZES = [
  [8,8], [9,9], [16,16], [15,15], [31,31],   // square, even and odd
  [16,12], [15,11],                          // non-square
  [9,10],                                    // ceil(w/2) == ceil(h/2), w != h: the diagonal edge case
];

export const SEEDS = [0x00000001, 0x2545f491, 0x9e3779b9, 0xdeadbeef];

/** One palette for every fixture: the palette is a pure function of
 *  (paletteSeed, bpc) and gets its own tests in M1. */
export const PALETTE_SEED = 0x5bd1e995;

/** The reference app's control defaults (its <input>/<select> values), with
 *  formula 'mix' and mask 'none' as its defaultState() sets them. */
export const REFERENCE_CFG = Object.freeze({
  source:'field', formula:'mix', expr:'(u*u + v*v) * (Math.abs(u)^Math.abs(v))',
  modulus:17, stride:1, phase:0, density:0.45, vary:true, ca:true,
  mask:'none', 'mask-scale':1, 'mask-invert':false, outline:false,
  sw:16, sh:16, symmetry:'horizontal',
  bpc:3, ncol:4, colormode:'bands', sortlum:true,
});

/** Generator variants. Each one exercises a code path the port must match. */
export const SOURCES = [
  { name:'circle',  cfg:{ source:'field', formula:'circle',  vary:false } },
  { name:'trefoil', cfg:{ source:'field', formula:'trefoil', vary:false } },
  { name:'mix',     cfg:{ source:'field', formula:'mix',     vary:true } },
  { name:'noise',   cfg:{ source:'noise', ca:true } },
  { name:'disc-outline-cycle',
                    cfg:{ source:'field', formula:'xor', vary:false, mask:'disc', 'mask-scale':0.9,
                          outline:true, colormode:'cycle', modulus:23, stride:2, phase:0.25 } },
  { name:'blob',    cfg:{ source:'field', formula:'skew', vary:false, mask:'blob', ncol:6, bpc:4 } },
  { name:'custom',  cfg:{ source:'custom', expr:'(u*u + v*v) * (Math.abs(u)^Math.abs(v))' } },
];

const hex8 = n => (n >>> 0).toString(16).padStart(8, '0');

/** Every fixture: mode × size × source × seed.
 *  @returns {{name:string, seed:number, cfg:object}[]} */
export function fixtureList(){
  const out = [];
  for (const mode of LEGACY_MODES)
    for (const [w, h] of SIZES)
      for (const src of SOURCES)
        for (const seed of SEEDS)
          out.push({
            name: `${mode}/${w}x${h}/${src.name}/${hex8(seed)}`,
            seed,
            cfg: { ...REFERENCE_CFG, ...src.cfg, symmetry:mode, sw:w, sh:h },
          });
  return out;
}

/** What a golden records about a sprite: the exact grid, the exact colours,
 *  and the filled-cell count (readable when a hash changes). Works on
 *  sprites from the reference (other vm realm) or the port. */
export function spriteDigest(sprite){
  const { w, h } = sprite;
  const cells = new Uint8Array(w * h);
  let filled = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const v = sprite.grid[y][x];
    cells[y*w + x] = v;
    if (v) filled++;
  }
  return {
    grid: fnv(cells),
    colors: fnv(new TextEncoder().encode(sprite.colors.join(','))),
    filled,
  };
}

/** FNV-1a over bytes, as block-showroom's test/fixtures.js. */
export function fnv(bytes){
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++){ h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
