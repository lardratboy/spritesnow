/* The collection: a shelf of kept sprites, ported from the old apps'
   keepSelected / restoreItem / reorder (reference lines 1216–1441;
   mosprites-ng 1827–2043 is the same code). Pure: each function takes the
   item list and returns a new one.

   Deliberately OUTSIDE the timeline, as in the old apps: scrubbing the
   playhead must not un-collect anything. Each item stores one cell's exact
   settings, so it re-renders the same sprite forever.

   Item: { id, name, seed, gen, paletteSeed, entry, cell, ts }
     entry  the timeline entry number (1-based) on screen when it was kept,
            for display only: pruning can make it stale, as in the old apps
     cell   [row, col] it was kept from, for display only */
import { cellSettings, normalizeGen } from '../recipe/schema.js';
import { setLock } from './cells.js';

const u32 = (v, fallback = 0) => Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) >>> 0 : fallback;

/** The old autoName: "<formula>·<modulus>" from the sprite's recipe text,
 *  made unique with " (2)", " (3)", … */
export function autoName(items, recipeText){
  const m = /^(\S+) % (\d+)/.exec(recipeText);
  const base = m ? `${m[1]}·${m[2]}` : recipeText.split(' ')[0];
  let name = base, n = 2;
  while (items.some(i => i.name === name)) name = `${base} (${n++})`;
  return name;
}

/** Keep cell i of a recipe. A locked cell is kept with its own settings.
 *  @param {{recipeText:string, entry:number, now:number}} opts
 *  @returns {{items:object[], item:object}} */
export function keep(items, recipe, i, { recipeText, entry, now }){
  const c = cellSettings(recipe, i), cols = recipe.sheet.cols;
  const item = { id: nextId(items), name: autoName(items, recipeText), seed: c.seed, gen: c.gen,
                 paletteSeed: c.paletteSeed, entry, cell: [(i / cols) | 0, i % cols], ts: now };
  return { items: [...items, item], item };
}
const nextId = items => items.reduce((m, i) => Math.max(m, i.id), 0) + 1;

export const rename = (items, id, name) => items.map(i => i.id === id ? { ...i, name } : i);
export const remove = (items, id) => items.filter(i => i.id !== id);

/** Drag to reorder. `to` is an insertion slot, 0..length: the item ends up
 *  before the item now at `to`. Dropping onto its own slot does nothing. */
export function move(items, from, to){
  if (from < 0 || from >= items.length || to < 0 || to > items.length || from === to || from === to - 1) return items;
  const out = items.slice(), [it] = out.splice(from, 1);
  out.splice(from < to ? to - 1 : to, 0, it);
  return out;
}

/** Restore adopts the settings the sprite was made under and stamps its
 *  seed into cell 0, unlocked, so the exact sprite reappears there. The
 *  sheet's layout and the other cells' seeds and locks are kept.
 *  @returns {object} a new recipe */
export function restore(recipe, item){
  const seeds = recipe.seeds.slice();
  seeds[0] = item.seed;
  return setLock({ ...recipe, gen: item.gen, paletteSeed: item.paletteSeed, seeds }, 0, false);
}

/** Check an item read from a file. Bad settings are repaired, as
 *  normalize() repairs a recipe. */
export function normalizeItem(x, id){
  const cell = Array.isArray(x.cell) && x.cell.length === 2 ? x.cell.map(v => Math.max(0, Math.round(+v) || 0)) : [0, 0];
  return { id, name: typeof x.name === 'string' && x.name ? x.name : `sprite ${id}`, seed: u32(x.seed),
           gen: normalizeGen(x.gen), paletteSeed: u32(x.paletteSeed), entry: Math.max(0, Math.round(+x.entry) || 0),
           cell, ts: Number.isFinite(+x.ts) ? +x.ts : 0 };
}

/** Grid size for exporting n sprites as one packed sheet, as the old
 *  exportCollectionSheet chose it: about square, filled row by row. */
export function packGrid(n){
  const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt(n))));
  return { cols, rows: Math.ceil(n / cols) };
}
