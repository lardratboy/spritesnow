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

const todo = name => { throw new Error(`not implemented: importV4.${name} (M2)`); };

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

/** @returns {object[]} recipes, oldest first; the playhead entry is marked */
export function importSession(json){ return todo('importSession'); }
