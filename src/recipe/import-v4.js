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

/** @returns {object[]} recipes, oldest first; the playhead entry is marked */
export function importSession(json){ return todo('importSession'); }
