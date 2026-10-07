/* Import old sessions from the reference app.
   Source format (reference save handler, "↓ Session"):
     { format:'sprite-gen-timeline', version:4 (or 3), playhead,
       cellPool: [ {rows, cols, list:[{seed, locked, lockCfg}]} ],
       collection: [...kept items...],
       entries: [ {key, label, ts, bookmark, cfg, paletteSeed, cells:<index into cellPool>} ] }
   A v1 entry instead carries `state` directly. Locked cells carry their own
   cfg (lockCfg, with lockCfg._paletteSeed), so each one becomes its own recipe.
   Every imported recipe gets fold: 1, so it reproduces exactly what the
   user saw, defects included (newdesign.md D2). */

import { normalize, normalizeGen } from './schema.js';

/** Map an old mode name to a SUBGROUPS id. */
export const LEGACY_SYMMETRY = {
  none:'none', horizontal:'mirror-x', vertical:'mirror-y', quadrant:'quadrant',
  rot180:'rot180', rot90:'rot90', diagonal:'dihedral',
};

/** One old-app cfg (its control ids: density, 'mask-scale', sw, colormode, …)
 *  as the generator settings of a spritesnow recipe, with fold:1 so it
 *  reproduces the old output exactly. Sheet keys (cols, rows, spacing, scale,
 *  seamphase, matte) are not generator settings and are ignored here.
 *  @returns {object} gen, as in schema.js DEFAULT_RECIPE.gen */
export function genFromLegacyCfg(cfg){
  const symmetry = LEGACY_SYMMETRY[cfg.symmetry];
  if (!symmetry) throw new Error(`unknown legacy symmetry: ${cfg.symmetry}`);
  return {
    source: cfg.source, formula: cfg.formula, expr: cfg.expr,
    modulus: cfg.modulus, stride: cfg.stride, phase: cfg.phase, coverage: cfg.density,
    vary: cfg.vary, ca: cfg.ca,
    mask: cfg.mask, maskScale: cfg['mask-scale'], maskInvert: cfg['mask-invert'], outline: cfg.outline,
    w: cfg.sw, h: cfg.sh, symmetry, fold: 1,
    bpc: cfg.bpc, ncol: cfg.ncol, colorMode: cfg.colormode, sortLum: cfg.sortlum,
  };
}

/** Read a session saved by the old app ("↓ Session").
 *  @param {string | object} json  the file's text, or the parsed object
 *  @returns {{ recipes:object[], entries:object[], playhead:number, notes:string[] }}
 *    one recipe per timeline entry, oldest first; `entries` adds each one's
 *    label, kind, time and keyframe flag (the old `bookmark`), for the
 *    timeline; `playhead` indexes the entry the user was looking at when
 *    they saved */
export function importSession(json){
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (!d || d.format !== 'sprite-gen-timeline')
    throw new Error('not a session file from the old sprite generator');
  if (!Array.isArray(d.entries) || !d.entries.length) throw new Error('the session has no timeline entries');
  const notes = new Set();
  const recipes = d.entries.map(x => {
    const st = x.state ? x.state                                       // v1 entries
             : { cfg: x.cfg, cells: d.cellPool[x.cells], paletteSeed: x.paletteSeed };
    return recipeFromState(st, notes);
  });
  const entries = d.entries.map((x, i) => ({
    recipe: recipes[i], kind: x.key || 'import', label: x.label || `entry ${i + 1}`,
    ts: x.ts || 0, keyframe: !!x.bookmark,
  }));
  const playhead = Math.max(0, Math.min(d.playhead ?? recipes.length - 1, recipes.length - 1));
  return { recipes, entries, playhead, notes: [...notes] };
}

/* One timeline state -> one recipe. Locked cells carry their own cfg and
   palette seed, so they become per-cell overrides. */
function recipeFromState(st, notes){
  const cfg = st.cfg, cells = st.cells;
  const scale = Number(cfg.scale);
  if (Number.isFinite(scale) && scale !== Math.round(scale))
    notes.add(`fractional scale ${scale} rounded to ${Math.max(1, Math.round(scale))}: v1 draws integer scales only`);
  const overrides = {};
  cells.list.forEach((cell, i) => {
    if (cell.locked && cell.lockCfg)
      overrides[i] = { gen: normalizeGen(genFromLegacyCfg(cell.lockCfg)), paletteSeed: cell.lockCfg._paletteSeed };
  });
  return normalize({
    gen: genFromLegacyCfg(cfg),
    sheet: { cols: cells.cols, rows: cells.rows, spacing: cfg.spacing, scale: Math.max(1, Math.round(scale)) },
    paletteSeed: st.paletteSeed,
    seeds: cells.list.map(c => c.seed),
    overrides,
  });
}
