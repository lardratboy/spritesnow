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

/* ------------------------------------------------- where the old fold was right
   Computed from first principles (orbits by brute force), not from the
   engine, so tests can hold the engine to it. The old fold is EXACT on a
   grid when the group fits the grid unreduced and, for every cell, the old
   fold sends the whole orbit to one cell that is itself in the orbit. */
import { groupById, effectiveGroup, applyElement, legacyFold } from '../src/core/groups2d.js';

export function legacyExact(groupId, w, h){
  const g = groupById(groupId), eff = effectiveGroup(groupId, w, h);
  if (!g.legacy || eff.reduced) return false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const orbit = eff.els.map(e => applyElement(e, x, y, w, h));
    const [fx, fy] = legacyFold(x, y, w, h, g.legacy);
    if (!orbit.some(([a, b]) => a === fx && b === fy)) return false;
    for (const [a, b] of orbit){
      const [gx, gy] = legacyFold(a, b, w, h, g.legacy);
      if (gx !== fx || gy !== fy) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------- tiered fixtures (M5a)
   Tiered sprites have no oracle, so golden-tiers.json pins the port's own
   output (`npm run golden:tiers`). Same rule as golden.json: regenerate only
   for an intended change, and say so in the commit. */
import { genFromLegacyCfg } from '../src/recipe/import-v4.js';

export const TIER_CASES = [
  // newdesign.md §5.2's table
  { w:16, h:16, symmetry:'dihedral', tiers:'4 / 4' },
  { w:16, h:16, symmetry:'none',     tiers:'4 copy:dihedral / 4 copy:dihedral' },
  { w:16, h:16, symmetry:'none',     tiers:'4 / 4 dihedral' },
  { w:16, h:16, symmetry:'rot90',    tiers:'4 / 4 mirror-x' },
  { w:16, h:16, symmetry:'mirror-x', tiers:'4 / 4 rot90' },
  { w:16, h:16, symmetry:'none',     tiers:'4 copy:rot90 / 4' },
  // three tiers, odd sizes, diagonals, rectangles, a swap that does not fit
  { w:16, h:16, symmetry:'mirror-y', tiers:'2 copy:mirror-x / 2 mirror-diag / 4 rot180' },
  { w:15, h:15, symmetry:'rot90',    tiers:'3 copy:rot90 / 5 dihedral' },
  { w:9,  h:9,  symmetry:'diagonals', tiers:'3 copy:mirror-y / 3 mirror-anti' },
  { w:32, h:32, symmetry:'quadrant', tiers:'4 / 8 rot90' },
  { w:16, h:12, symmetry:'mirror-x', tiers:'4x4 / 4x3 quadrant' },
  { w:16, h:12, symmetry:'rot90',    tiers:'4x3 copy:quadrant / 4 rot90' },
];

/** Every tiered fixture: case × source × seed, as a port gen (fold 2).
 *  @returns {{name:string, seed:number, gen:object}[]} */
export function tierFixtureList(){
  const out = [];
  for (const c of TIER_CASES)
    for (const src of SOURCES)
      for (const seed of SEEDS){
        const cfg = { ...REFERENCE_CFG, ...src.cfg, symmetry:'none', sw:c.w, sh:c.h };
        out.push({
          name: `${c.symmetry}/${c.w}x${c.h}/${c.tiers}/${src.name}/${hex8(seed)}`,
          seed,
          gen: { ...genFromLegacyCfg(cfg), symmetry:c.symmetry, fold:2, tiers:c.tiers },
        });
      }
  for (const c of TIER_FIELD_CASES)
    for (const tierField of TIER_FIELD_IDS)
      for (const src of SOURCES.filter(s => s.cfg.source !== 'noise'))
        for (const seed of SEEDS){
          const cfg = { ...REFERENCE_CFG, ...src.cfg, symmetry:'none', sw:c.w, sh:c.h };
          out.push({
            name: `${c.symmetry}/${c.w}x${c.h}/${c.tiers}/tf:${tierField}/${src.name}/${hex8(seed)}`,
            seed,
            gen: { ...genFromLegacyCfg(cfg), symmetry:c.symmetry, fold:2, tiers:c.tiers, tierField },
          });
        }
  return out;
}

/* Tier fields (M5b): every field on a few splits, one tier included, since
   each field defines what it does with a single tier. Noise has no field. */
export const TIER_FIELD_IDS = ['wreath', 'digit-swap', 'prefix-hash', 'phasecell', 'cross', 'carry'];
export const TIER_FIELD_CASES = [
  { w:16, h:16, symmetry:'dihedral', tiers:'4 / 4' },
  { w:16, h:16, symmetry:'mirror-y', tiers:'2 copy:mirror-x / 2 mirror-diag / 4 rot180' },
  { w:16, h:16, symmetry:'rot90',    tiers:'16' },
  { w:15, h:15, symmetry:'none',     tiers:'3 copy:rot90 / 5' },
  { w:16, h:12, symmetry:'mirror-x', tiers:'4x4 / 4x3 quadrant' },
];

/* ----------------------------------------------------- animated fixtures (M6a)
   Animations have no oracle either, so golden-frames.json pins the port's
   output (`npm run golden:frames`), with the same rule. The cases are the
   §5.3 table's motions, each drive and both signs, an odd size, a
   rectangle, two elements, and a tiered sprite with a tier field (whose
   non-quarter spin reads wrapped cells). */
export const FRAME_CASES = [
  { w:16, h:16, symmetry:'none',     frames:16, motion:'',              drive:'phase', driveAmount:1 },
  { w:16, h:16, symmetry:'none',     frames:16, motion:'id +1/2',       drive:'phase', driveAmount:2 },
  { w:16, h:16, symmetry:'none',     frames:16, motion:'id ~',          drive:'drift', driveAmount:2 },
  { w:16, h:16, symmetry:'none',     frames:16, motion:'rot90 +1/4',    drive:'spin',  driveAmount:1 },
  { w:16, h:16, symmetry:'none',     frames:16, motion:'rot90 +1/2',    drive:'phase', driveAmount:1 },
  { w:16, h:16, symmetry:'none',     frames:16, motion:'rot180 +1/2',   drive:'spin',  driveAmount:-1 },
  { w:16, h:16, symmetry:'none',     frames:16, motion:'mirror-x +1/2', drive:'drift', driveAmount:1 },
  { w:16, h:16, symmetry:'none',     frames:16, motion:'mirror-x ~',    drive:'phase', driveAmount:1 },
  { w:16, h:16, symmetry:'mirror-x', frames:16, motion:'rot90 +1/4',    drive:'spin',  driveAmount:1 },
  { w:15, h:15, symmetry:'rot90',    frames:8,  motion:'mirror-x +1/2', drive:'spin',  driveAmount:-1 },
  { w:16, h:12, symmetry:'mirror-y', frames:12, motion:'mirror-x +1/3', drive:'phase', driveAmount:2 },
  { w:9,  h:9,  symmetry:'diagonals', frames:6, motion:'id ~, mirror-y +1/2', drive:'drift', driveAmount:-2 },
  { w:16, h:16, symmetry:'rot90',    frames:8,  motion:'rot180 ~1',     drive:'spin',  driveAmount:1,
    tiers:'4 / 4 mirror-x', tierField:'wreath' },
];

/** Every animated fixture: case × source × seed, as a port gen (fold 2). */
export function frameFixtureList(){
  const out = [];
  for (const c of FRAME_CASES)
    for (const src of SOURCES)
      for (const seed of SEEDS){
        const cfg = { ...REFERENCE_CFG, ...src.cfg, symmetry:'none', sw:c.w, sh:c.h };
        const { w, h, ...rest } = c;
        out.push({
          name: `${c.symmetry}/${w}x${h}/T${c.frames}/${c.motion || '-'}/${c.drive} ${c.driveAmount}` +
                `${c.tiers ? `/${c.tiers}/tf:${c.tierField}` : ''}/${src.name}/${hex8(seed)}`,
          seed,
          gen: { ...genFromLegacyCfg(cfg), fold:2, tiers:'', tierField:'none', ...rest },
        });
      }
  return out;
}

/** spriteDigest over every frame of an animation, in order. */
export function framesDigest(sprite){
  const { w, h, frames } = sprite, F = w * h;
  const cells = new Uint8Array(F * frames.length);
  let filled = 0;
  frames.forEach((grid, t) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const v = grid[y][x];
      cells[t*F + y*w + x] = v;
      if (v) filled++;
    }
  });
  return {
    frames: fnv(cells),
    colors: fnv(new TextEncoder().encode(sprite.colors.join(','))),
    count: frames.length, filled,
  };
}
