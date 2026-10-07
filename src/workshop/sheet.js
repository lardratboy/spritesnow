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
   Pure: no DOM, so Node tests check every build against a fresh one. */
import { cellSettings } from '../recipe/schema.js';
import { generateSprite } from '../core/generate.js';
import { parseTiers, tierLayout } from '../core/tiers.js';
import { paletteFor } from '../core/palette.js';
import { rasterizeSheet, redrawCells } from '../raster/rasterize.js';

/* At least 3 sheets of the largest size (50×50), so a build never evicts
   its own sprites and stepping between timeline entries mostly hits. */
export const CACHE_LIMIT = 8192;

/** A least-recently-used sprite cache. `generated` counts misses.
 *  Equal settings share a short id, so keys stay short. Recipes are never
 *  mutated, so each gen object's id is looked up once. */
export function createSpriteCache(limit = CACHE_LIMIT){
  return { map: new Map(), genIds: new Map(), genOf: new WeakMap(), limit, generated: 0 };
}

/** The sprite for one cell's settings, generated only on a miss. */
export function cachedSprite(cache, seed, gen, paletteSeed){
  let g = cache.genOf.get(gen);
  if (g === undefined){
    const text = JSON.stringify(gen);
    g = cache.genIds.get(text);
    if (g === undefined) cache.genIds.set(text, g = cache.genIds.size);
    cache.genOf.set(gen, g);
  }
  const key = `${seed}|${paletteSeed}|${g}`, map = cache.map;
  let s = map.get(key);
  if (s){ map.delete(key); map.set(key, s); return s; }      // most recently used goes last
  s = generateSprite(seed, gen, paletteFor(paletteSeed, gen.bpc));
  cache.generated++;
  map.set(key, s);
  if (map.size > cache.limit) map.delete(map.keys().next().value);
  return s;
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
  const before = cache.generated, n = recipe.seeds.length, sprites = new Array(n);
  for (let i = 0; i < n; i++){
    const c = cellSettings(recipe, i);
    sprites[i] = cachedSprite(cache, c.seed, c.gen, c.paletteSeed);
  }
  const generated = cache.generated - before, layout = sheetLayout(recipe);
  const fits = s => s.w <= layout.cellW && s.h <= layout.cellH;
  if (prev && sameLayout(prev.layout, layout) && prev.sprites.every(fits) && sprites.every(fits)){
    const changed = sheetItems(recipe, sprites).filter((it, i) => it.sprite !== prev.sprites[i]);
    const dirty = redrawCells(prev.image, changed, layout, { scale: 1 });
    return { sprites, layout, image: prev.image, generated, dirty };
  }
  const image = rasterizeSheet(sheetItems(recipe, sprites), layout, { scale: 1 });
  return { sprites, layout, image, generated, dirty: null };
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
