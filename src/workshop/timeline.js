/* The timeline: a take you curate, ported from mosprites-ng (lines
   1008–1620 there). Pure: no DOM and no clock of its own (callers pass
   `now`), so Node tests drive it directly, as NG's T-series did in-page.

   Every entry holds a whole recipe, so replaying an entry rebuilds exactly
   what was on screen. Recipes are never mutated, so entries that did not
   touch the seeds share one seeds array, and a slider drag costs one small
   object per frame.

   The log is append-only. Rewinding moves the playhead; an edit made from
   the past appends a new entry at the end, and `from` records the entry it
   branched from (an index, so everything that removes entries remaps it).

     recording  REC. On: every commit appends (or coalesces a slider drag).
                Off: edits change the live recipe, the log does not grow,
                and `dirty` says the live recipe is not in the log.
     keyframe   the "this one matters" flag (the old apps' `bookmark`).
                Keyframes survive the pruner and the 400-entry evictor.
     keysOnly   a filter on what the strip shows, never a deletion.

   Entry: { kind, label, ts, recipe, keyframe, from, hash }
     kind  what made it: 'set:<part>.<key>' for a setting (these coalesce),
           or an action name ('regenerate', 'palette', 'start', …)
     hash  an 8×8 average hash of the sheet at scale 1 ([lo, hi]), for the pruner */
import { hamming } from './frame-hash.js';
import { SETTING_LABELS as LABELS } from '../recipe/schema.js';

export const MAX_ENTRIES = 400;
export const COALESCE_MS = 700;

export function createTimeline(){
  return { entries: [], playhead: -1, recording: true, dirty: false, keysOnly: false };
}

const FRACTIONAL = new Set(['gen.phase', 'gen.coverage', 'gen.maskScale']);

/** Describe what changed between two recipes, as NG's diffLabel did. */
export function diffLabel(prev, next){
  if (!prev) return 'session start';
  const changed = Object.keys(LABELS).filter(path => {
    const [part, k] = path.split('.');
    return prev[part][k] !== next[part][k];
  });
  if (!changed.length) return 'no setting changed';
  if (changed.length > 3) return `${changed.length} settings changed`;
  return changed.map(path => {
    const [part, k] = path.split('.');
    const fmt = v => typeof v === 'boolean' || (path === 'gen.tiers' && !v) ? (v ? 'on' : 'off')
                   : FRACTIONAL.has(path) ? Number(v).toFixed(2)
                   : String(v).length > 14 ? String(v).slice(0, 14) + '…' : String(v);
    return `${LABELS[path]} ${fmt(prev[part][k])} → ${fmt(next[part][k])}`;
  }).join(' · ');
}

/* Recipes are normalized, so their JSON has a fixed key order. */
const sameRecipe = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Record the live recipe.
 *  With REC off, or when the recipe equals the one at the playhead, nothing
 *  is appended. A setting changed again within COALESCE_MS, at the end of
 *  the log, updates the last entry instead of adding one, so a slider drag
 *  is one entry.
 *  @param {{kind:string, label?:string, now?:number, hash?:number[]|null}} opts
 *  @returns {object|null} the entry now holding the recipe (new or updated),
 *           or null when none does */
export function commit(tl, recipe, { kind, label, now = Date.now(), hash = null }){
  const at = tl.entries[tl.playhead];
  if (at && sameRecipe(at.recipe, recipe)){ tl.dirty = false; return null; }
  if (!tl.recording){ tl.dirty = true; return null; }

  const n = tl.entries.length, prev = tl.entries[n - 1];
  const atEnd = tl.playhead === n - 1;
  if (prev && atEnd && kind.startsWith('set:') && prev.kind === kind && now - prev.ts < COALESCE_MS && !prev.keyframe){
    prev.recipe = recipe;
    prev.ts = now;
    prev.hash = hash;
    prev.label = label || diffLabel(prev.from >= 0 ? tl.entries[prev.from].recipe : null, recipe);
    tl.dirty = false;
    return prev;
  }
  // labelled against the entry it branched from, which is not always the last one
  const entry = { kind, label: label || diffLabel(at ? at.recipe : null, recipe), ts: now,
                  recipe, keyframe: false, from: tl.playhead, hash };
  tl.entries.push(entry);
  tl.playhead = tl.entries.length - 1;
  if (tl.entries.length > MAX_ENTRIES){
    // evict the oldest DISPOSABLE entry: surviving the cap is what curating a keyframe is for
    let victim = tl.entries.findIndex(e => !e.keyframe);
    if (victim < 0) victim = 0;
    dropEntries(tl, new Set([victim]));
    tl.playhead = tl.entries.length - 1;
  }
  tl.dirty = false;
  return entry;
}

/** Move the playhead. Unrecorded edits do not survive a jump.
 *  @returns {object|null} the recipe to show, or null if the playhead did not move */
export function goTo(tl, i){
  if (i < 0 || i >= tl.entries.length || i === tl.playhead) return null;
  tl.playhead = i;
  tl.dirty = false;
  return tl.entries[i].recipe;
}

/** Remove entries by index, remapping `from` and the playhead. A removed
 *  ancestor is replaced by its nearest surviving ancestor. The timeline is
 *  never emptied: the last entry survives a request to remove everything.
 *  @param {Set<number>} drop
 *  @returns {number} how many were removed */
export function dropEntries(tl, drop){
  const old = tl.entries, n = old.length;
  if (!drop || !drop.size || !n) return 0;
  drop = new Set(drop);
  if (drop.size >= n) drop.delete(n - 1);
  const map = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) map[i] = drop.has(i) ? -1 : k++;
  const resolve = i => {
    for (let guard = 0; i >= 0 && guard <= n; guard++){
      if (map[i] >= 0) return map[i];
      i = old[i].from;
    }
    return -1;
  };
  const kept = [];
  for (let i = 0; i < n; i++){
    if (map[i] < 0) continue;
    old[i].from = resolve(old[i].from);
    kept.push(old[i]);
  }
  let ph = tl.playhead >= 0 && tl.playhead < n ? map[tl.playhead] : -1;
  if (ph < 0){
    let j = Math.min(tl.playhead, n - 1);
    while (j >= 0 && map[j] < 0) j--;
    ph = j < 0 ? 0 : map[j];
  }
  tl.entries = kept;
  tl.playhead = Math.min(Math.max(0, ph), kept.length - 1);
  return n - kept.length;
}

/** The ✕ on a frame. The only entry is never removed. @returns {number} removed */
export function deleteEntry(tl, i){
  if (tl.entries.length <= 1 || i < 0 || i >= tl.entries.length) return 0;
  return dropEntries(tl, new Set([i]));
}

/** Which entries the pruner would remove at a Hamming threshold.
 *  It walks forward holding an anchor, the last entry it kept, and drops an
 *  entry indistinguishable from the anchor, so a long drag collapses to its
 *  endpoints while slow drift survives. Keyframes, the first and last entry
 *  and the playhead are never candidates.
 *  @returns {Set<number>} */
export function prunePlan(tl, threshold){
  const drop = new Set(), last = tl.entries.length - 1;
  let anchor = null;
  tl.entries.forEach((e, i) => {
    const h = e.hash;
    const pinned = e.keyframe || i === 0 || i === tl.playhead || i === last;
    if (pinned || !h || !anchor || hamming(h, anchor) > threshold){ anchor = h || anchor; return; }
    drop.add(i);
  });
  return drop;
}

/** ◆. With unrecorded edits it punches the live recipe in as a new
 *  keyframe, whatever REC says. Otherwise it toggles the keyframe flag of
 *  the entry at the playhead.
 *  @returns {object|null} the entry it added, if any */
export function markKeyframe(tl, liveRecipe, opts){
  if (tl.dirty){
    const was = tl.recording;
    tl.recording = true;
    const entry = commit(tl, liveRecipe, { kind: 'keyframe', label: 'keyframe', ...opts });
    tl.recording = was;
    if (entry) entry.keyframe = true;
    return entry;
  }
  const e = tl.entries[tl.playhead];
  if (e) e.keyframe = !e.keyframe;
  return null;
}

/** REC on or off. Turning it back on records any unrecorded edits.
 *  @returns {object|null} the entry it added, if any */
export function setRecording(tl, on, liveRecipe, opts){
  tl.recording = !!on;
  return on && tl.dirty ? commit(tl, liveRecipe, { kind: 'rec', label: 'resumed recording', ...opts }) : null;
}

/** Append entries, for example an old session's timeline, and put the
 *  playhead on list[playhead]. Nothing already in the log is lost. Branch
 *  pointers are unknown, so each entry follows the one before it and the
 *  first starts a new root. The cap still holds: if the log is now too
 *  long, the oldest disposable entries go.
 *  @param {{recipe, kind?, label?, ts?, keyframe?, hash?}[]} list
 *  @returns {object[]} the entries created, one per item of `list` (an
 *           entry the cap evicted at once is no longer in tl.entries) */
export function appendEntries(tl, list, playhead){
  if (!list.length) throw new Error('a timeline needs at least one entry');
  const at = tl.entries.length;
  const created = list.map((x, i) => ({
    kind: x.kind || 'import', label: x.label || `entry ${i + 1}`, ts: x.ts || 0,
    recipe: x.recipe, keyframe: !!x.keyframe, from: i ? at + i - 1 : -1, hash: x.hash || null }));
  tl.entries.push(...created);
  tl.playhead = at + Math.max(0, Math.min(playhead ?? list.length - 1, list.length - 1));
  tl.dirty = false;
  trimToCap(tl);
  return created;
}

/** Enforce MAX_ENTRIES on a log that grew in one go (an import or a loaded
 *  file): the oldest entries that are neither keyframes nor the playhead
 *  go first; only if that is not enough, the oldest keyframes.
 *  @returns {number} how many were removed */
export function trimToCap(tl){
  const excess = tl.entries.length - MAX_ENTRIES;
  if (excess <= 0) return 0;
  const drop = new Set();
  for (let i = 0; i < tl.entries.length && drop.size < excess; i++)
    if (!tl.entries[i].keyframe && i !== tl.playhead) drop.add(i);
  for (let i = 0; drop.size < excess; i++) if (i !== tl.playhead) drop.add(i);   // keyframes only: oldest go
  return dropEntries(tl, drop);
}

/** The entries the strip shows: all, or only keyframes plus the playhead. */
export function visibleIndices(tl){
  const out = [];
  tl.entries.forEach((e, i) => { if (!tl.keysOnly || e.keyframe || i === tl.playhead) out.push(i); });
  return out;
}

export const keyframeCount = tl => tl.entries.reduce((n, e) => n + (e.keyframe ? 1 : 0), 0);
