/* Session files: the whole workshop (timeline and collection) in one JSON
   file, so a session survives closing the tab. Pure: no DOM, no clock.

   Format `spritesnow-session/1` (newdesign.md D6: a session is a list of
   recipes):
     { format, playhead, recording, keysOnly,
       seedPool: [ [uint32, …], … ],
       entries: [ { kind, label, ts, keyframe, from,
                    recipe: { gen, sheet, paletteSeed, overrides, seeds:<index into seedPool> } } ],
       collection: [ { id, name, seed, gen, paletteSeed, entry, cell, ts } ],
       live?: <recipe, as in entries> }
   Most entries share their seeds with the one before (only a regenerate,
   a reroll or a resize changes them), so seed arrays are pooled, as the
   old app pooled its cells. `live` is present only when REC was off and
   the sheet on screen was not in the log ("unrecorded"); loading puts it
   back on screen, still unrecorded. Frame hashes and thumbnails are not
   saved: they are rebuilt from the recipes.

   readSession() also reads the old app's `sprite-gen-timeline` sessions,
   collection included (recipe/import-v4.js). */
import { normalize } from '../recipe/schema.js';
import { importSession } from '../recipe/import-v4.js';
import { createTimeline, appendEntries, trimToCap } from './timeline.js';
import { normalizeItem } from './collection.js';

export const SESSION_FORMAT = 'spritesnow-session/1';

/** @param {object} tl  the timeline
 *  @param {object[]} items  the collection
 *  @param {object} [live]  the recipe on screen; saved only when tl.dirty
 *  @returns {object} the file's contents, ready for JSON.stringify */
export function saveSession(tl, items, live){
  const seedPool = [], index = new Map();
  const pack = r => {
    const key = r.seeds.join(',');
    let k = index.get(key);
    if (k === undefined){ k = seedPool.length; index.set(key, k); seedPool.push(r.seeds.slice()); }
    return { gen: r.gen, sheet: r.sheet, paletteSeed: r.paletteSeed, overrides: r.overrides, seeds: k };
  };
  const out = {
    format: SESSION_FORMAT, playhead: tl.playhead, recording: tl.recording, keysOnly: tl.keysOnly, seedPool,
    entries: tl.entries.map(e => ({ kind: e.kind, label: e.label, ts: e.ts, keyframe: e.keyframe, from: e.from,
                                    recipe: pack(e.recipe) })),
    collection: items.map(i => ({ ...i })),
  };
  if (tl.dirty && live) out.live = pack(live);
  return out;
}

/** Read a session file, this app's or the old app's.
 *  @param {string | object} json  the file's text, or the parsed object
 *  @returns {{ tl:object, items:object[], live:object|null, old:boolean, notes:string[] }}
 *    tl is a complete timeline (entries have no frame hash yet); live is the
 *    unrecorded recipe to show, if there was one; old says the file came
 *    from the old app */
export function readSession(json){
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (d && d.format === 'sprite-gen-timeline') return readOld(d);
  if (!d || d.format !== SESSION_FORMAT)
    throw new Error(`not a session file (format ${JSON.stringify(d && d.format)})`);
  if (!Array.isArray(d.entries) || !d.entries.length) throw new Error('the session has no timeline entries');
  const pool = Array.isArray(d.seedPool) ? d.seedPool : [];
  const unpack = (r, what) => {
    if (!r || !Array.isArray(pool[r.seeds])) throw new Error(`${what} has no seeds`);
    return normalize({ ...r, seeds: pool[r.seeds] });
  };

  const tl = createTimeline();
  const n = d.entries.length;
  tl.entries = d.entries.map((x, i) => {
    const from = Number.isInteger(x.from) && x.from >= -1 && x.from < i ? x.from : i - 1;   // always points back
    return { kind: String(x.kind || 'load'), label: String(x.label || `entry ${i + 1}`), ts: Number(x.ts) || 0,
             recipe: unpack(x.recipe, `entry ${i + 1}`), keyframe: !!x.keyframe, from, hash: null };
  });
  tl.playhead = Number.isInteger(d.playhead) ? Math.max(0, Math.min(d.playhead, n - 1)) : n - 1;
  tl.recording = d.recording !== false;
  tl.keysOnly = !!d.keysOnly;
  const notes = [];
  const trimmed = trimToCap(tl);
  if (trimmed) notes.push(`${trimmed} oldest entries dropped to stay within the timeline's limit`);

  let live = d.live ? unpack(d.live, 'the unrecorded sheet') : null;
  if (live && JSON.stringify(live) === JSON.stringify(tl.entries[tl.playhead].recipe)) live = null;
  tl.dirty = !!live;

  const items = (Array.isArray(d.collection) ? d.collection : []).map((x, k) => normalizeItem(x, k + 1));
  return { tl, items, live, old: false, notes };
}

/* An old session: its timeline as one chain, its collection as items. */
function readOld(d){
  const { entries, playhead, collection, notes } = importSession(d);
  const tl = createTimeline();
  appendEntries(tl, entries, playhead);
  return { tl, items: collection.map((x, k) => normalizeItem(x, k + 1)), live: null, old: true, notes };
}
