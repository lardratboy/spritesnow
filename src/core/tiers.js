/* Tiered sprites: a sprite made of sprites (newdesign.md §5.2). Pure.
   Borrowed from block-showroom's tierFolder (docs/from3Dto2D.md P5, G9).

   TIERS are listed outer to inner, each with radices rx (across) and ry
   (down); their products are the sprite's w and h. A cell's x and y become
   mixed-radix digits, one per tier: x = Σ x_i · sx_i, sx_i = Π_{j>i} rx_j.
   Tier i's BLOCK is the region its digits and the inner ones span:
   (rx_i · sx_i) × (ry_i · sy_i) cells. Tier 0's block is the whole sprite.

   Two actions of a D4 element e on tier i:
     block  e acts on each tier-i block with everything inside it, so the
            contents turn or mirror with the block. Tier 0's block group is
            gen.symmetry, so it is never written in the tier list.
     copy   e acts on digit i alone (an rx_i × ry_i grid) and leaves the
            other digits as they are: blocks move, their contents slide.
   A group acts only through its elements that fit: G ∩ Aut(block) for a
   block group, G ∩ Aut(rx_i × ry_i) for a copy group.

   The tiered orbits are the orbits of everything those generate together.
   Each one is a union of the ordinary orbits of gen.symmetry (fold 2), and
   each of those already has a representative in the ordinary seed
   rectangle. The tiered representative is the first of them in row-major
   order, so the RNG is consumed exactly as without tiers, and a tier list
   that adds no groups gives the same sprite, byte for byte.

   The TEXT form lives here, not in src/recipe/, so the core never imports
   from the recipe layer; src/recipe/tiers.js re-exports it:
     ''                        off
     '4 / 4 mirror-x'          tiers outer to inner, split by ' / '
     '4 copy:rot90 / 4x2'      each: a radix (4, or 4x2 across × down), then
                               optionally a block group and a copy:group */
import { SUBGROUPS, groupById, groupIdOf, applyElement, orbitTable } from './groups2d.js';

const GROUP_IDS = new Set(SUBGROUPS.map(g => g.id));
export const MAX_RADIX = 64;

/** @returns {{ tiers: {rx, ry, block:string|null, copy:string|null}[] | null, error: string|null }}
 *  `block` and `copy` are subgroup ids; 'none' reads as null. */
export function parseTiers(text){
  const s = String(text ?? '').trim();
  if (!s) return { tiers: [], error: null };
  const fail = error => ({ tiers: null, error });
  const tiers = [];
  const parts = s.split('/');
  for (let i = 0; i < parts.length; i++){
    const tok = parts[i].trim().split(/\s+/).filter(Boolean);
    const n = `tier ${i + 1}`;
    if (!tok.length) return fail(`${n} is empty`);
    const m = /^(\d+)(?:[x×](\d+))?$/.exec(tok[0]);
    if (!m) return fail(`${n}: "${tok[0]}" is not a radix such as 4 or 4x2`);
    const rx = +m[1], ry = m[2] === undefined ? rx : +m[2];
    if (rx < 2 || ry < 2 || rx > MAX_RADIX || ry > MAX_RADIX)
      return fail(`${n}: a radix must be 2 to ${MAX_RADIX}`);
    let block = null, copy = null, seenBlock = false, seenCopy = false;
    for (const t of tok.slice(1)){
      const isCopy = t.startsWith('copy:'), id = isCopy ? t.slice(5) : t;
      if (!GROUP_IDS.has(id)) return fail(`${n}: unknown group "${id}"`);
      if (isCopy ? seenCopy : seenBlock) return fail(`${n} has two ${isCopy ? 'copy' : 'block'} groups`);
      if (isCopy){ seenCopy = true; copy = id === 'none' ? null : id; }
      else { seenBlock = true; block = id === 'none' ? null : id; }
    }
    if (i === 0 && block) return fail('the outer tier\'s block group is the Symmetry setting');
    tiers.push({ rx, ry, block, copy });
  }
  return { tiers, error: null };
}

/** The canonical text of a tier list (parseTiers' inverse). A 'none'
 *  group is left out, as null is. */
export function printTiers(tiers){
  const group = id => id && id !== 'none' ? id : null;
  return tiers.map(t => [t.rx === t.ry ? `${t.rx}` : `${t.rx}x${t.ry}`, group(t.block),
                         group(t.copy) && `copy:${t.copy}`].filter(Boolean).join(' ')).join(' / ');
}

/** Whether a gen's tiers are on, and if not, why not.
 *  Tiers stay in the recipe when they stop fitting; they are only off.
 *  @returns {{ on:boolean, tiers:object[]|null, reason:string|null }}
 *  reason is null when on, or when gen.tiers is empty */
export function tierState(gen){
  const text = gen.tiers || '';
  if (!text.trim()) return { on: false, tiers: [], reason: null };
  const { tiers, error } = parseTiers(text);
  if (error) return { on: false, tiers: null, reason: error };
  if (gen.fold !== 2) return { on: false, tiers, reason: 'the old fold (v1) has no tiers' };
  let px = 1, py = 1;
  for (const t of tiers){ px *= t.rx; py *= t.ry; }
  if (px !== gen.w || py !== gen.h){
    const square = tiers.every(t => t.rx === t.ry);
    const factors = tiers.map(t => t.rx === t.ry ? `${t.rx}` : `${t.rx}x${t.ry}`).join('·');
    return { on: false, tiers, reason: `${factors} = ${square ? px : `${px}×${py}`}, sprite is ${gen.w}×${gen.h}` };
  }
  return { on: true, tiers, reason: null };
}

/* ------------------------------------------------------------ the engine */

const fits = (e, a, b) => !(e & 4) || a === b;
const fitEls = (id, a, b) => id ? groupById(id).els.filter(e => fits(e, a, b)) : [0];

/** Tier geometry: strides and block sizes, outer to inner. */
export function tierLayout(tiers){
  const out = tiers.map(t => ({ ...t, sx: 1, sy: 1, bw: 0, bh: 0 }));
  for (let i = out.length - 2; i >= 0; i--){
    out[i].sx = out[i + 1].sx * out[i + 1].rx;
    out[i].sy = out[i + 1].sy * out[i + 1].ry;
  }
  for (const t of out){ t.bw = t.rx * t.sx; t.bh = t.ry * t.sy; }
  return out;
}

/** Element e acting on every tier block (bw × bh) at once, as a cell permutation. */
export function blockPerm(e, bw, bh, w, h){
  const perm = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const lx = x % bw, ly = y % bh;
    const [ax, ay] = applyElement(e, lx, ly, bw, bh);
    perm[y*w + x] = (y - ly + ay)*w + (x - lx + ax);
  }
  return perm;
}

/** Element e acting on one tier's digit (an rx × ry grid with strides sx, sy). */
export function copyPerm(e, t, w, h){
  const perm = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const dx = ((x / t.sx) | 0) % t.rx, dy = ((y / t.sy) | 0) % t.ry;
    const [ax, ay] = applyElement(e, dx, dy, t.rx, t.ry);
    perm[y*w + x] = (y + (ay - dy)*t.sy)*w + x + (ax - dx)*t.sx;
  }
  return perm;
}

/** Every generator of the tiered group, as a cell permutation.
 *  @returns {{ tier:number, kind:'block'|'copy', e:number, perm:Int32Array }[]} */
export function tierGenerators(symmetry, w, h, tiers){
  const L = tierLayout(tiers), out = [];
  L.forEach((t, i) => {
    for (const e of fitEls(i === 0 ? symmetry : t.block, t.bw, t.bh))
      if (e) out.push({ tier: i, kind: 'block', e, perm: blockPerm(e, t.bw, t.bh, w, h) });
    for (const e of fitEls(t.copy, t.rx, t.ry))
      if (e) out.push({ tier: i, kind: 'copy', e, perm: copyPerm(e, t, w, h) });
  });
  return out;
}

/**
 * The orbit table for a tiered sprite: the same shape as groups2d.orbitTable()
 * at fold 2, so generate.js copies seed cells exactly as it does without tiers.
 * @param {string} symmetry  gen.symmetry, the outer tier's block group
 * @param {object[]} tiers   parseTiers().tiers, whose radices multiply to w × h
 * @returns {{ sw, sh, rep:Int32Array, orbitIndex:null, orbitCount:number, effective:object,
 *             tiers:object[], group:string }}
 *   tiers[i] = { rx, ry, sx, sy, bw, bh,
 *                block: { asked, fit, result }, copy: { asked, fit, result } }
 *     asked   the group written (tier 0's block: gen.symmetry), or null
 *     fit     its elements that fit the block (or the digit grid), as a subgroup id
 *     result  every element whose action keeps each orbit whole: the symmetry
 *             the tier is guaranteed, which can be more than was asked for
 *   group = tiers[0].block.result, the sprite's own guaranteed group
 */
export function tieredOrbitTable(symmetry, w, h, tiers){
  const base = orbitTable(symmetry, w, h, 2);
  const N = w * h;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = i => {
    while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (const g of tierGenerators(symmetry, w, h, tiers))
    for (let c = 0; c < N; c++){
      const a = find(c), b = find(g.perm[c]);
      if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
    }

  // representative: the first ordinary representative in row-major order
  const best = new Int32Array(N).fill(-1);
  let orbitCount = 0;
  for (let c = 0; c < N; c++){
    const root = find(c), r = base.rep[c];
    if (best[root] < 0){ best[root] = r; orbitCount++; }
    else if (r < best[root]) best[root] = r;
  }
  const rep = new Int32Array(N);
  for (let c = 0; c < N; c++) rep[c] = best[find(c)];

  const keepsOrbits = perm => {
    for (let c = 0; c < N; c++) if (rep[perm[c]] !== rep[c]) return false;
    return true;
  };
  const resultOf = (a, b, permOf) => {
    const els = [];
    for (let e = 0; e < 8; e++) if (fits(e, a, b) && (e === 0 || keepsOrbits(permOf(e)))) els.push(e);
    return groupIdOf(els);
  };
  const info = tierLayout(tiers).map((t, i) => {
    const askedBlock = i === 0 ? symmetry : t.block;
    return { rx: t.rx, ry: t.ry, sx: t.sx, sy: t.sy, bw: t.bw, bh: t.bh,
      block: { asked: askedBlock, fit: groupIdOf(fitEls(askedBlock, t.bw, t.bh)),
               result: resultOf(t.bw, t.bh, e => blockPerm(e, t.bw, t.bh, w, h)) },
      copy:  { asked: t.copy, fit: groupIdOf(fitEls(t.copy, t.rx, t.ry)),
               result: resultOf(t.rx, t.ry, e => copyPerm(e, t, w, h)) } };
  });
  return { sw: base.sw, sh: base.sh, rep, orbitIndex: null, orbitCount, effective: base.effective,
           tiers: info, group: info[0].block.result };
}

/* Sheets reuse a few settings many times, so tables are kept. */
const tableCache = new Map();
/** tieredOrbitTable, memoised on (symmetry, w, h, tier text). */
export function cachedTieredTable(symmetry, w, h, tiers){
  const key = `${symmetry}|${w}|${h}|${printTiers(tiers)}`;
  let t = tableCache.get(key);
  if (!t){
    if (tableCache.size >= 64) tableCache.delete(tableCache.keys().next().value);
    t = tieredOrbitTable(symmetry, w, h, tiers);
    tableCache.set(key, t);
  }
  return t;
}
