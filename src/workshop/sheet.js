/* The sheet on screen, rebuilt from a recipe with as little work as
   possible (newdesign.md §5.1, M4a).
   - Sprites come from a cache keyed on (seed, gen, palette seed), so a
     reroll, lock or new palette regenerates only the cells it changed.
   - The screen image is the sheet at scale 1, one pixel per sprite cell;
     the view multiplies its zoom by the recipe's scale. Exports rasterise
     at the recipe's scale on demand (sheetAtScale).
   - When the layout is unchanged and every sprite fits its cell, only the
     cells whose sprite changed are redrawn, in place.
   - blockEdges gives the view's block grid (M5c): where each tiered
     sprite's blocks meet, placed as the raster places the sprite.
   - An animated sheet (M6b) holds every frame of every sprite, unless
     that is more than ATLAS_CAP cells: then every k-th frame (framePlan),
     so each loop keeps its length and plays coarser. sheetFrame draws any
     frame at scale 1, and sheetHash, the pruner's hash, covers every
     frame the sheet holds.
   Pure: no DOM, so Node tests check every build against a fresh one. */
import { cellSettings } from '../recipe/schema.js';
import { generateFrames } from '../core/generate.js';
import { animState } from '../core/spacetime.js';
import { parseTiers, tierLayout } from '../core/tiers.js';
import { paletteFor } from '../core/palette.js';
import { rasterizeSheet, redrawCells } from '../raster/rasterize.js';
import { averageHash } from './frame-hash.js';

/* At least 3 sheets of the largest size (50×50), so a build never evicts
   its own sprites and stepping between timeline entries mostly hits.
   Animated sprites hold many frames, so the cache is also capped in cells
   (frames × w × h), at 3 sheets of 50×50 64×64 stills. */
export const CACHE_LIMIT = 8192, CACHE_CELLS = 3 * 2500 * 64 * 64;

/* The most sprite cells (frames × sprites × w × h) an animated sheet holds
   on screen: 4 MB of atlas, and under a second to generate (generation
   costs 40 to 150 ns a cell). The default sheet at 64 frames uses 0.8M. */
export const ATLAS_CAP = 1 << 22;

/** A least-recently-used sprite cache. `generated` counts misses.
 *  Equal settings share a short id, so keys stay short. Recipes are never
 *  mutated, so each gen object's id is looked up once. */
export function createSpriteCache(limit = CACHE_LIMIT, cellLimit = CACHE_CELLS){
  return { map: new Map(), genIds: new Map(), genOf: new WeakMap(), limit, cellLimit, cells: 0, generated: 0 };
}
const cellsOf = s => s.frames.length * s.w * s.h;

/** The sprite for one cell's settings, generated only on a miss.
 *  @param {number} stride  build every stride-th frame (framePlan); a still
 *    ignores it. The sprite gets `stride`, so frameIndex can find frames.
 *  @returns generateFrames' sprite */
export function cachedSprite(cache, seed, gen, paletteSeed, stride = 1){
  let g = cache.genOf.get(gen);
  if (g === undefined){
    const text = JSON.stringify(gen);
    g = cache.genIds.get(text);
    if (g === undefined) cache.genIds.set(text, g = cache.genIds.size);
    cache.genOf.set(gen, g);
  }
  const T = animState(gen).T, k = T > 1 ? Math.max(1, Math.min(T, stride | 0)) : 1;
  const key = `${seed}|${paletteSeed}|${g}|${k}`, map = cache.map;
  let s = map.get(key);
  if (s){ map.delete(key); map.set(key, s); return s; }      // most recently used goes last
  const times = Array.from({ length: Math.ceil(T / k) }, (_, j) => j * k);
  s = generateFrames(seed, gen, paletteFor(paletteSeed, gen.bpc), { times });
  s.stride = k;
  cache.generated++;
  map.set(key, s);
  cache.cells += cellsOf(s);
  while (map.size > 1 && (map.size > cache.limit || cache.cells > cache.cellLimit)){
    const [oldest, gone] = map.entries().next().value;
    map.delete(oldest);
    cache.cells -= cellsOf(gone);
  }
  return s;
}

/** Every frame of a cell's animation (a still is one frame), with the fit,
 *  for the inspector and exports: from the cache when the sheet holds every
 *  frame, else built once and kept for the last few sprites asked for. */
const framesCache = new Map();
export function framesOf(seed, gen, paletteSeed, cache = null){
  const key = `${seed}|${paletteSeed}|${JSON.stringify(gen)}`;
  let s = framesCache.get(key);
  if (!s){
    if (framesCache.size >= 8) framesCache.delete(framesCache.keys().next().value);
    s = cache ? cachedSprite(cache, seed, gen, paletteSeed, 1) : generateFrames(seed, gen, paletteFor(paletteSeed, gen.bpc));
    framesCache.set(key, s);
  }
  return s;
}

/** Which frame of a sheet sprite shows at time t: frames[frameIndex(s, t)].
 *  Each sprite loops on its own T; one built every k-th frame holds frame
 *  t − (t mod k), so it keeps time with the others. */
export const frameIndex = (s, t) => Math.floor((((t % s.T) + s.T) % s.T) / (s.stride || 1));

const gcd = (a, b) => b ? gcd(b, a % b) : a;
/* The longest loop the player steps through. Past this, sprites with
   unrelated frame counts (locked with their own) drift out of step at the
   wrap, which is harmless. */
const LOOP_LIMIT = 1 << 16;

/** How an animated sheet is shown (newdesign.md §5.3, M6b).
 *  @returns {{ T:number, loop:number, stride:number, frames:number, cells:number, full:number }}
 *    T       the most frames any cell has (1: every sprite is a still)
 *    loop    the frames the player steps through before every sprite is
 *            back at frame 0: the lcm of the cells' frame counts, so T
 *            unless locked cells have their own (at most LOOP_LIMIT)
 *    stride  build every stride-th frame: 1, unless every frame would be
 *            more than ATLAS_CAP cells, then the smallest that fits (or T,
 *            frame 0 alone, when even that does not)
 *    frames  the most frames any cell holds, ceil(T / stride)
 *    cells   frames × sprites × cells held; full: the same with every frame */
export function framePlan(recipe){
  const counts = new Map();                   // T -> cells per frame, summed over the sheet
  for (let i = 0; i < recipe.seeds.length; i++){
    const { gen } = cellSettings(recipe, i), T = animState(gen).T;
    counts.set(T, (counts.get(T) || 0) + gen.w * gen.h);
  }
  const held = k => { let n = 0; for (const [T, c] of counts) n += Math.ceil(T / k) * c; return n; };
  let T = 1, loop = 1;
  for (const t of counts.keys()){ T = Math.max(T, t); loop = Math.min(LOOP_LIMIT, loop / gcd(loop, t) * t); }
  let stride = 1;
  while (stride < T && held(stride) > ATLAS_CAP) stride++;
  return { T, loop, stride, frames: Math.ceil(T / stride), cells: held(stride), full: held(1) };
}

/** @returns {{cols:number, rows:number, cellW:number, cellH:number, spacing:number}} */
export function sheetLayout(recipe){
  const { cols, rows, spacing } = recipe.sheet;
  return { cols, rows, cellW: recipe.gen.w, cellH: recipe.gen.h, spacing };
}
export const sheetItems = (recipe, sprites) =>
  sprites.map((sprite, i) => ({ sprite, col: i % recipe.sheet.cols, row: (i / recipe.sheet.cols) | 0 }));

/** The recipe's sheet at its own scale (or `scale`), for export. */
export const sheetAtScale = (recipe, sprites, scale = recipe.sheet.scale) =>
  rasterizeSheet(sheetItems(recipe, sprites), sheetLayout(recipe), { scale });

const sameLayout = (a, b) => a.cols === b.cols && a.rows === b.rows && a.cellW === b.cellW &&
                             a.cellH === b.cellH && a.spacing === b.spacing;

/** Build a recipe's sheet at scale 1.
 *  @param {object|null} prev  the previous build. Its image is redrawn in
 *         place when it can be, so prev must not be used afterwards.
 *  @returns {{ sprites:object[], layout:object, image:{width, height, data},
 *              generated:number, dirty:{x, y, w, h}[]|null }}
 *    generated  how many sprites were not in the cache
 *    dirty      the boxes that changed since prev, or null for a new image */
export function buildSheet(recipe, cache, prev = null){
  const before = cache.generated, n = recipe.seeds.length, sprites = new Array(n), plan = framePlan(recipe);
  for (let i = 0; i < n; i++){
    const c = cellSettings(recipe, i);
    sprites[i] = cachedSprite(cache, c.seed, c.gen, c.paletteSeed, plan.stride);
  }
  const generated = cache.generated - before, layout = sheetLayout(recipe);
  const fits = s => s.w <= layout.cellW && s.h <= layout.cellH;
  if (prev && sameLayout(prev.layout, layout) && prev.sprites.every(fits) && sprites.every(fits)){
    const changed = sheetItems(recipe, sprites).filter((it, i) => it.sprite !== prev.sprites[i]);
    const dirty = redrawCells(prev.image, changed, layout, { scale: 1 });
    return { sprites, layout, plan, image: prev.image, generated, dirty };
  }
  const image = rasterizeSheet(sheetItems(recipe, sprites), layout, { scale: 1 });
  return { sprites, layout, plan, image, generated, dirty: null };
}

/** A sprite showing one of its frames. */
export const atFrame = (s, j) => s.frames.length > 1 ? { ...s, grid: s.frames[j] } : s;

/** A build's sheet at time t, at scale 1 (or `scale`): every sprite shows
 *  frames[frameIndex(s, t)]. Frame 0 is the build's image. */
export function sheetFrame(build, t, scale = 1){
  const { cols } = build.layout;
  const items = build.sprites.map((s, i) => ({ sprite: atFrame(s, frameIndex(s, t)), col: i % cols, row: (i / cols) | 0 }));
  return rasterizeSheet(items, build.layout, { scale });
}

/** The pruner's hash of a build (frame-hash.js): the 8×8 average hash of
 *  every frame the sheet holds, in order, so two entries are alike only
 *  when every frame is. A still sheet's is the hash of its image. */
export function sheetHash(build){
  const { T, stride } = build.plan, out = averageHash(build.image);
  for (let t = stride; t < T; t += stride) out.push(...averageHash(sheetFrame(build, t)));
  return out;
}

/* ------------------------------------------------------------ block grid */

/* One sprite's edges, relative to its top left, kept per (w, h, tiers). */
const edgeCache = new Map();
function spriteEdges(w, h, text){
  const key = `${w}|${h}|${text}`;
  let out = edgeCache.get(key);
  if (out) return out;
  out = [];
  const L = tierLayout(parseTiers(text).tiers);
  for (let i = 1; i < L.length; i++){
    const { bw, bh } = L[i], ow = L[i - 1].bw, oh = L[i - 1].bh;
    for (let x = bw; x < w; x += bw) if (x % ow) out.push({ x, y: 0, len: h, vertical: true, depth: i });
    for (let y = bh; y < h; y += bh) if (y % oh) out.push({ x: 0, y, len: w, vertical: false, depth: i });
  }
  if (edgeCache.size >= 64) edgeCache.delete(edgeCache.keys().next().value);
  edgeCache.set(key, out);
  return out;
}

/** Where the blocks of every tiered sprite on a sheet meet, for the view's
 *  block grid (newdesign.md §5.2, M5c). Tier i's blocks (i >= 1) meet on
 *  the multiples of its block size; each edge is listed once, at the
 *  outermost tier it belongs to, and the sprite's own border is left out.
 *  Sprites without tiers (or with tiers switched off) have none.
 *  In sheet px at scale 1, each sprite placed as rasterizeSheet places it.
 *  @param {object[]} sprites  a build's sprites, cell by cell
 *  @param {{cols, cellW, cellH, spacing}} layout
 *  @returns {{ x:number, y:number, len:number, vertical:boolean, depth:number }[]}
 *    a vertical edge runs down from (x, y) for len px, a horizontal one
 *    across; depth is the tier (1 = the outermost tier's blocks' edges) */
export function blockEdges(sprites, layout){
  const out = [], outerW = layout.cellW + layout.spacing, outerH = layout.cellH + layout.spacing;
  sprites.forEach((s, i) => {
    if (!s.tiers) return;
    const X = (i % layout.cols) * outerW + Math.floor((layout.cellW - s.w) / 2);
    const Y = ((i / layout.cols) | 0) * outerH + Math.floor((layout.cellH - s.h) / 2);
    for (const e of spriteEdges(s.w, s.h, s.tiers)) out.push({ ...e, x: X + e.x, y: Y + e.y });
  });
  return out;
}
