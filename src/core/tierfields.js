/* Tier fields (newdesign.md §5.2, M5b): block-showroom's six fields defined
   on the relation between tiers (docs/from3Dto2D.md G10), re-derived for 2D.
   Pure.

   A tier field is NOT a new entry in FIELDS (mix and vary pick from FIELDS
   by index, so its length is part of every old sprite). It is a separate
   setting, gen.tierField, that changes what the base field sees: its input
   cell (x, y), its params p, or an integer added to its value before mod M.
   The base field is still chosen as before (mix and vary included) and acts
   as the motif.

   Constants come from hash32(seed, ...), never from the sprite's RNG, so
   turning a tier field on leaves the colours and params exactly as they
   were. Symmetry needs nothing here: generate.js evaluates the field at
   each orbit's representative and copies it, whatever the formula.

   Digits are those of core/tiers.js: tier i (outer to inner) has radices
   rx × ry, strides sx × sy, and blocks bw × bh; dx_i = floor(x / sx_i) % rx_i.
   The cell lies in one block of every tier. Tier 0's block is the whole
   sprite; tier i's block is addressed by the digits of tiers 0..i-1. So a
   single tier (L = 1) has one block, the sprite, and each field below says
   what it does then (the showroom's wreath fell through to another mode).

     wreath       every tier's block shows its contents under a D4 element
                  picked from the block's address, outer to inner, so each
                  block is the motif turned or mirrored (D4 ≀ G). L = 1: the
                  whole motif under one element. A swap is only used where
                  it keeps the block structure (square radices from there in).
     digit-swap   each axis's digits are read in reverse significance:
                  with tiers r0 / r1, x = a·r1 + b reads as b·r0 + a.
                  L = 1: the across and down digits swap (a transpose).
     prefix-hash  a hash of the chain of block addresses shifts the offsets
                  (±4) and conic coefficients (±1, ±2), so each innermost
                  block holds a variant of the motif. L = 1: one variant.
     phasecell    each block's bands shift by a whole step of the modulus:
                  the sprite by a seeded phase, then each tier's digit by a
                  seeded affine step. L = 1: the sprite's phase alone.
     cross        for adjacent tiers, the dot and cross products of their
                  centred (doubled) digit vectors, with seeded weights.
                  L = 1: the tier pairs with itself (the cross is 0).
     carry        the odometer's carries: tier i carries when the cell's
                  place inside its block is past the block's anti-diagonal,
                  (x mod bw)·bh + (y mod bh)·bw >= bw·bh; for square tiers
                  that is exactly a carry out of digit i when x and y are
                  added (Kummer). Each tier has a seeded weight and a seeded
                  mirror. L = 1: one carry, across the whole sprite. */
import { hash32 } from './rng.js';
import { applyElement } from './groups2d.js';
import { tierState, tierLayout } from './tiers.js';

/** gen.tierField's values. Generation picks by id, so order is display only. */
export const TIER_FIELDS = [
  { id:'none',        name:'None' },
  { id:'wreath',      name:'Wreath · blocks turned or mirrored' },
  { id:'digit-swap',  name:'Digit swap · significance reversed' },
  { id:'prefix-hash', name:'Prefix hash · a variant per block' },
  { id:'phasecell',   name:'Phase cell · bands shift per block' },
  { id:'cross',       name:'Cross · dot and cross of tier digits' },
  { id:'carry',       name:'Carry · odometer carries' },
];
const IDS = new Set(TIER_FIELDS.map(f => f.id));

/** Salt for the tier field's constants, so they are not the seed's other hashes. */
const SALT = 0x7f1e1d5;
const gcd = (a, b) => { while (b){ [a, b] = [b, a % b]; } return a; };

/** Whether a gen's tier field is on, and if not, why not. Like tiers, a
 *  tier field that cannot act stays in the recipe and is only off.
 *  @returns {{ on:boolean, id:string, reason:string|null }}
 *  reason is null when on, or when the field is 'none' */
export function tierFieldState(gen, tiered = tierState(gen)){
  const id = gen.tierField || 'none';
  if (id === 'none') return { on: false, id, reason: null };
  if (!IDS.has(id)) return { on: false, id, reason: `unknown tier field "${id}"` };
  if (!tiered.on) return { on: false, id, reason: 'it needs tiers that are on' };
  if (gen.source === 'noise') return { on: false, id, reason: 'random noise has no field' };
  return { on: true, id, reason: null };
}

/**
 * The tier field for one sprite.
 * @param {string} id      a TIER_FIELDS id other than 'none'
 * @param {number} seed    the sprite's seed (constants come from hash32(seed, ...))
 * @param {object[]} tiers parseTiers().tiers, whose radices multiply to w × h
 * @returns {{ id:string,
 *             map?:    (x:number, y:number) => [number, number],  cell the field reads
 *             params?: (x:number, y:number, p:object) => object,  params it reads
 *             add?:    (x:number, y:number, M:number) => number }} integer added to its value
 */
export function makeTierField(id, seed, tiers){
  const L = tierLayout(tiers), n = L.length;
  const K = hash32(seed, SALT);
  const k = (i, tag) => hash32(K ^ tag, i);              // a constant per tier and use
  const dx = (x, t) => ((x / t.sx) | 0) % t.rx;
  const dy = (y, t) => ((y / t.sy) | 0) % t.ry;
  const code = (x, y, t) => dx(x, t) + t.rx * dy(y, t);  // the digit pair, 0 .. rx·ry-1

  switch (id){
    case 'wreath': {
      // swaps keep the block structure only where every tier from i in is square
      const swaps = L.map((_, i) => L.slice(i).every(t => t.rx === t.ry));
      return { id, map(x, y){
        for (let i = 0; i < n; i++){
          const { bw, bh } = L[i];
          const lx = x % bw, ly = y % bh, ox = x - lx, oy = y - ly;
          let e = k(i, 0x1) ^ hash32(K + i, (oy / bh) * (L[0].bw / bw) + ox / bw);
          e &= swaps[i] ? 7 : 3;
          const [ax, ay] = applyElement(e, lx, ly, bw, bh);
          x = ox + ax; y = oy + ay;
        }
        return [x, y];
      } };
    }
    case 'digit-swap': {
      if (n === 1) return { id, map: (x, y) => [y, x] };
      // reversed significance: digit i's place is the product of the radices outside it
      const px = [], py = [];
      for (let i = 0, a = 1, b = 1; i < n; a *= L[i].rx, b *= L[i].ry, i++){ px.push(a); py.push(b); }
      return { id, map(x, y){
        let X = 0, Y = 0;
        for (let i = 0; i < n; i++){ X += dx(x, L[i]) * px[i]; Y += dy(y, L[i]) * py[i]; }
        return [X, Y];
      } };
    }
    case 'prefix-hash':
      return { id, params(x, y, p){
        let h = K;
        for (let i = 0; i < n - 1; i++) h = hash32(h, code(x, y, L[i]));
        return { ...p,
          ox: p.ox + (h % 9) - 4,            oy: p.oy + ((h >>> 4) % 9) - 4,
          a:  p.a + ((h >>> 8) % 3) - 1,     b:  p.b + ((h >>> 10) % 3) - 1,
          c:  p.c + ((h >>> 12) % 3) - 1,    d:  p.d + ((h >>> 14) % 5) - 2,
          e:  p.e + ((h >>> 17) % 5) - 2 };
      } };
    case 'phasecell': {
      // tier i's digit pair steps the phase by an affine map of its code,
      // with a multiplier coprime to rx·ry so every block gets its own step
      const steps = L.slice(0, n - 1).map((t, i) => {
        const count = t.rx * t.ry;
        let m = 1 + k(i, 0x2) % count;
        while (gcd(m, count) !== 1) m++;
        return { t, count, m, c: k(i, 0x3) % count };
      });
      return { id, add(x, y, M){
        let s = K % M;
        for (const { t, count, m, c } of steps) s += Math.floor(M * ((code(x, y, t) * m + c) % count) / count);
        return s;
      } };
    }
    case 'cross': {
      const w = L.map((_, i) => ({ dot: 1 + k(i, 0x4) % 3, cross: (k(i, 0x5) % 7) - 3 }));
      const cx = (x, t) => 2 * dx(x, t) - (t.rx - 1);
      const cy = (y, t) => 2 * dy(y, t) - (t.ry - 1);
      return { id, add(x, y){
        if (n === 1){ const X = cx(x, L[0]), Y = cy(y, L[0]); return w[0].dot * (X*X + Y*Y); }
        let s = 0;
        for (let i = 0; i < n - 1; i++){
          const X0 = cx(x, L[i]), Y0 = cy(y, L[i]), X1 = cx(x, L[i + 1]), Y1 = cy(y, L[i + 1]);
          s += w[i].dot * (X0*X1 + Y0*Y1) + w[i].cross * (X0*Y1 - Y0*X1);
        }
        return s;
      } };
    }
    case 'carry': {
      const c = L.map((_, i) => ({ mirror: k(i, 0x6) & 1, weight: k(i, 0x7) }));
      return { id, add(x, y, M){
        let s = 0;
        for (let i = 0; i < n; i++){
          const { bw, bh } = L[i];
          let lx = x % bw;
          if (c[i].mirror) lx = bw - 1 - lx;
          if (lx * bh + (y % bh) * bw >= bw * bh) s += 1 + c[i].weight % (M - 1);
        }
        return s;
      } };
    }
  }
  throw new Error(`unknown tier field: ${id}`);
}
