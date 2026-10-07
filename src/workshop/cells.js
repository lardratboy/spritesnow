/* Per-cell actions: lock, reroll, and regenerating around locks, ported
   from the old apps' toggleLock / rerollCell / regen (mosprites-ng lines
   1749–1762 and 2199–2203). Pure: each takes a recipe and returns a new
   one, so every action is one timeline entry and replays exactly.

   A lock is a per-cell override: the cell keeps the sheet's settings and
   palette seed as they were when it was locked (the old app's lockCfg,
   with lockCfg._paletteSeed). Imported old sessions already arrive with
   their locked cells as overrides, so the two are the same thing. */
import { SETTING_LABELS } from '../recipe/schema.js';

export const isLocked = (recipe, i) => !!recipe.overrides[i];

/** Lock cell i to the sheet's current settings, or unlock it.
 *  @returns {object} a new recipe */
export function setLock(recipe, i, on){
  const overrides = { ...recipe.overrides };
  if (on) overrides[i] = { gen: recipe.gen, paletteSeed: recipe.paletteSeed };
  else delete overrides[i];
  return { ...recipe, overrides };
}
export const toggleLock = (recipe, i) => setLock(recipe, i, !isLocked(recipe, i));

/** A new seed for cell i. Like the old app, this also unlocks it: a reroll
 *  asks for a new sprite from the sheet's current settings.
 *  @returns {object} a new recipe */
export function rerollCell(recipe, i, seed){
  const seeds = recipe.seeds.slice();
  seeds[i] = seed >>> 0;
  return setLock({ ...recipe, seeds }, i, false);
}

/** New seeds for every unlocked cell; locked cells keep theirs.
 *  @param {(i:number) => number} newSeed
 *  @returns {object} a new recipe */
export function reseedUnlocked(recipe, newSeed){
  return { ...recipe, seeds: recipe.seeds.map((s, i) => isLocked(recipe, i) ? s : newSeed(i) >>> 0) };
}

/** Names of the settings in which a locked cell differs from the sheet,
 *  plus 'Palette' when its palette seed differs. Empty when unlocked. */
export function lockedDifferences(recipe, i){
  const o = recipe.overrides[i];
  if (!o) return [];
  const out = Object.keys(SETTING_LABELS)
    .filter(path => path.startsWith('gen.') && o.gen[path.slice(4)] !== recipe.gen[path.slice(4)])
    .map(path => SETTING_LABELS[path]);
  if (o.paletteSeed !== recipe.paletteSeed) out.push('Palette');
  return out;
}
