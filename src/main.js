/* Composition root: recipe -> generate -> rasterize -> view.
   The recipe is the only state that matters. Everything on screen is
   rebuilt from it, and the URL hash always holds it, so a copied link
   rebuilds the same sheet. Randomness for NEW seeds lives here, in the UI;
   src/core/ never calls Math.random.
   The timeline (workshop/timeline.js) records the recipe after every
   change, so any entry replays exactly what was on screen. The collection
   (workshop/collection.js) sits outside the timeline, and a session file
   (workshop/session.js) saves both. */
import { normalize, cellSettings, resizeSheet, soloRecipe } from './recipe/schema.js';
import { encode, decode } from './recipe/permalink.js';
import { generateSprite } from './core/generate.js';
import { paletteFor } from './core/palette.js';
import { aut } from './core/groups2d.js';
import { rasterizeSheet, rasterizeSolo, rasterizePacked } from './raster/rasterize.js';
import { imageToCanvas, downloadPNG, downloadBlob } from './raster/png.js';
import { createTimeline, commit, goTo, deleteEntry, dropEntries, prunePlan, markKeyframe,
         setRecording } from './workshop/timeline.js';
import { averageHash } from './workshop/frame-hash.js';
import { isLocked, toggleLock, rerollCell, reseedUnlocked, lockedDifferences } from './workshop/cells.js';
import { keep, rename, remove, move, restore, packGrid } from './workshop/collection.js';
import { saveSession, readSession } from './workshop/session.js';
import { mountControls } from './ui/controls.js';
import { mountSheetView } from './ui/sheet-view.js';
import { mountInspector } from './ui/inspector.js';
import { mountTimelineView } from './ui/timeline-view.js';
import { mountCollectionView } from './ui/collection-view.js';

const $ = id => document.getElementById(id);
const randomU32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
const freshRecipe = () => {
  const r = normalize({ paletteSeed: randomU32() });
  return { ...r, seeds: r.seeds.map(randomU32) };
};

let recipe;
let sprites = [];
let selected = -1;
let note = null;              // { text, cls } shown in the status line until the next action
const tl = createTimeline();
let items = [];               // the collection

/* ---------------------------------------------------------------- render */
const sheetCanvas = document.createElement('canvas');
let sheetImage = null;

/** One recipe's sprites and sheet image. Pure apart from the clock. */
function buildSheet(r){
  const n = r.seeds.length, list = new Array(n);
  for (let i = 0; i < n; i++){
    const c = cellSettings(r, i);
    list[i] = generateSprite(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc));
  }
  const { cols, rows, spacing, scale } = r.sheet, { w, h } = r.gen;
  const image = rasterizeSheet(list.map((sprite, i) => ({ sprite, col: i % cols, row: (i / cols) | 0 })),
                               { cols, rows, cellW: w, cellH: h, spacing }, { scale });
  return { sprites: list, image };
}

function render(){
  const t0 = performance.now();
  ({ sprites, image: sheetImage } = buildSheet(recipe));
  imageToCanvas(sheetImage, sheetCanvas);
  const { cols, rows, spacing, scale } = recipe.sheet, { w, h } = recipe.gen;
  view.setImage(sheetCanvas, { cols, rows, outerW: (w + spacing) * scale, outerH: (h + spacing) * scale,
                               offX: 0, offY: 0, spriteW: w * scale, spriteH: h * scale });
  if (selected >= sprites.length) selected = -1;
  view.setLocked(Object.keys(recipe.overrides).map(Number));
  view.setSelection(selected);
  controls.update(recipe);
  showInspector();
  setStatus(performance.now() - t0);
  writeHash();
}

function showInspector(){
  if (selected < 0) return inspector.show(null);
  const sprite = sprites[selected], c = cellSettings(recipe, selected);
  inspector.show({
    index: selected, seed: c.seed, sprite, gen: c.gen, paletteSeed: c.paletteSeed,
    aut: aut(sprite.grid, sprite.w, sprite.h), image: rasterizeSolo(sprite, { scale: 1 }),
    locked: isLocked(recipe, selected), differs: lockedDifferences(recipe, selected),
  });
}

function setStatus(ms){
  const { cols, rows } = recipe.sheet, { w, h } = recipe.gen;
  const status = $('status');
  status.textContent = `${cols * rows} sprites · ${w}×${h} · scale ${recipe.sheet.scale} · built in ${ms.toFixed(0)} ms`;
  if (note){
    const span = document.createElement('span');
    span.className = note.cls || '';
    span.textContent = ' · ' + note.text;
    status.append(span);
  }
}
const say = (text, cls) => { note = { text, cls }; };

/* The hash is written after a short pause, so dragging a slider does not
   flood the browser history API. replaceState never fires hashchange. */
let hashTimer = 0, lastHash = '';
function writeHash(){
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    lastHash = encode(recipe);
    history.replaceState(null, '', lastHash);
  }, 250);
}

/* -------------------------------------------------------------- timeline */
let playTimer = 0;
const showTimeline = () => timelineView.refresh(tl, { playing: !!playTimer });
const liveOpts = () => ({ hash: averageHash(sheetImage) });

/* Record the live recipe (it is already rendered, so the sheet canvas is
   its picture). With REC off this only marks the recipe as unrecorded. */
function record(kind, label){
  const entry = commit(tl, recipe, { kind, label, ...liveOpts() });
  if (entry) timelineView.thumb(entry, sheetCanvas);
  showTimeline();
}
/** Every change to the live recipe comes through here. */
function apply(next, kind, label){
  note = null;
  recipe = next;
  render();
  record(kind, label);
}

/* Show the entry at the playhead, unless the live recipe is already it. */
function showPlayhead(){
  const r = tl.entries[tl.playhead].recipe;
  if (r !== recipe){ recipe = r; note = null; render(); }
  showTimeline();
}
function jump(i){
  if (goTo(tl, i)) showPlayhead();
}
function togglePlay(){
  if (playTimer){ clearInterval(playTimer); playTimer = 0; return showTimeline(); }
  if (tl.entries.length < 2) return;
  if (tl.playhead >= tl.entries.length - 1) jump(0);
  playTimer = setInterval(() => {
    if (tl.playhead >= tl.entries.length - 1) togglePlay(); else jump(tl.playhead + 1);
  }, 340);
  showTimeline();
}
function mark(){
  const entry = markKeyframe(tl, recipe, liveOpts());
  if (entry) timelineView.thumb(entry, sheetCanvas);
  showTimeline();
}
/* Removing entries keeps the live recipe, unless the entry it came from went. */
function removed(before){
  if (tl.entries[tl.playhead] !== before){ tl.dirty = false; showPlayhead(); } else showTimeline();
}

const timelineView = mountTimelineView($('timeline'), {
  onGoTo: jump,
  onPlay: togglePlay,
  onDelete(i){ const before = tl.entries[tl.playhead]; if (deleteEntry(tl, i)) removed(before); },
  onRec(){
    const entry = setRecording(tl, !tl.recording, recipe, liveOpts());
    if (entry) timelineView.thumb(entry, sheetCanvas);
    showTimeline();
  },
  onMark: mark,
  onKeysOnly(){ tl.keysOnly = !tl.keysOnly; showTimeline(); },
  onPrune(threshold){
    const before = tl.entries[tl.playhead];
    const n = dropEntries(tl, prunePlan(tl, threshold));
    say(`removed ${n} near-duplicate entr${n === 1 ? 'y' : 'ies'} at similarity ${threshold}; ${tl.entries.length} left`);
    setStatus(0);
    removed(before);
  },
});

/* --------------------------------------------------------------- actions */
function change(part, key, value){
  let next;
  if (part === 'sheet' && (key === 'cols' || key === 'rows')){
    const cols = key === 'cols' ? value : recipe.sheet.cols, rows = key === 'rows' ? value : recipe.sheet.rows;
    const n = normalize({ ...recipe, sheet: { ...recipe.sheet, cols, rows } }).sheet;   // clamp first
    next = normalize(resizeSheet(recipe, n.cols, n.rows, randomU32));
  } else {
    next = normalize({ ...recipe, [part]: { ...recipe[part], [key]: value } });
  }
  apply(next, `set:${part}.${key}`);
}

async function copyText(text, what){
  try { await navigator.clipboard.writeText(text); say(`${what} copied`); }
  catch { prompt(`Copy the ${what.toLowerCase()}:`, text); say(`${what} shown for copying`); }
  setStatus(0);
}

const ACTIONS = {
  'regenerate'(){
    const n = Object.keys(recipe.overrides).length;
    apply(reseedUnlocked(recipe, randomU32), 'regenerate', n ? `new seeds, ${n} locked kept` : 'new seeds');
  },
  'new-palette'(){ apply({ ...recipe, paletteSeed: randomU32() }, 'palette', 'new palette'); },
  'copy-link'(){ lastHash = encode(recipe); history.replaceState(null, '', lastHash); copyText(location.href, 'Link'); },
  'export-sheet'(){ downloadPNG(sheetImage, `spritesnow-sheet-${recipe.sheet.cols}x${recipe.sheet.rows}.png`); },
  'save-session': () => saveFile(),
};

/* Cell actions. Lock and reroll are timeline entries; keeping a sprite
   changes only the collection, which sits outside the timeline. */
const CELL = {
  lock(i){ apply(toggleLock(recipe, i), 'lock', `${isLocked(recipe, i) ? 'unlock' : 'lock'} #${i + 1}`); },
  reroll(i){ apply(rerollCell(recipe, i, randomU32()), 'reroll', `reroll #${i + 1}`); },
  keep(i){
    const out = keep(items, recipe, i, { recipeText: sprites[i].recipeText, entry: tl.playhead + 1, now: Date.now() });
    items = out.items;
    showCollection(out.item.id);
    say(`kept #${i + 1} as "${out.item.name}"`); setStatus(0);
  },
};
function onSelected(action){
  if (selected >= 0) return CELL[action](selected);
  say('select a sprite first'); setStatus(0);
}
function select(i, { shift = false, mod = false, alt = false } = {}){
  selected = i;
  if (i >= 0 && shift) return CELL.reroll(i);
  if (i >= 0 && mod) return CELL.lock(i);
  view.setSelection(i);
  showInspector();
  if (i >= 0 && alt) CELL.keep(i);
}

/* ------------------------------------------------------------ collection */
const itemSprite = it => generateSprite(it.seed, it.gen, paletteFor(it.paletteSeed, it.gen.bpc));
const itemById = id => items.find(i => i.id === id);
const safeName = n => n.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'sprite';
const showCollection = reveal => collectionView.render(items, reveal);
const collectionView = mountCollectionView($('collection'), {
  spriteFor: itemSprite,
  onRestore(id){
    const it = itemById(id);
    selected = 0;
    apply(restore(recipe, it), 'restore', `restore "${it.name}"`);
  },
  onCopy(id){ copyText(JSON.stringify(soloRecipe(itemById(id), recipe.sheet), null, 2), 'Recipe'); },
  onExport(id){
    const it = itemById(id);
    downloadPNG(rasterizeSolo(itemSprite(it), { scale: recipe.sheet.scale }), `${safeName(it.name)}.png`);
  },
  onRemove(id){ items = remove(items, id); showCollection(); },
  onRename(id, name){ items = rename(items, id, name); showCollection(); },
  onMove(from, to){ items = move(items, from, to); showCollection(); },
  onExportSheet(){
    if (!items.length) return;
    const { cols, rows } = packGrid(items.length);
    downloadPNG(rasterizePacked(items.map(itemSprite), { cols, spacing: recipe.sheet.spacing }, { scale: recipe.sheet.scale }),
                `spritesnow-collection-${items.length}.png`);
    say(`exported ${items.length} kept sprite${items.length === 1 ? '' : 's'} as a ${cols}×${rows} sheet`); setStatus(0);
  },
});

/* --------------------------------------------------------------- sessions */
function saveFile(){
  const data = saveSession(tl, items, recipe);
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const name = `spritesnow-session-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
  say(`saved ${name}: ${tl.entries.length} timeline entries, ${items.length} kept sprite${items.length === 1 ? '' : 's'}` +
      (data.live ? ', and the unrecorded sheet on screen' : ''));
  setStatus(0);
}

/* Loading a session replaces the timeline and the collection, after asking
   if there is work to lose. Old sessions load the same way, with the old
   fold (v1). */
async function loadFile(file){
  let got;
  try { got = readSession(await file.text()); }
  catch (err){ say(`Could not load ${file.name}: ${err.message}`, 'bad'); return setStatus(0); }
  if ((tl.entries.length > 1 || items.length) &&
      !confirm(`Replace the current session (${tl.entries.length} timeline entries, ${items.length} kept sprites) ` +
               `with ${file.name}?\n\nSave the current one first if you want to keep it.`)) return;
  if (playTimer) togglePlay();
  // one sheet at a time: keep its hash and a thumbnail, not the image
  const scratch = document.createElement('canvas');
  for (const e of got.tl.entries){
    const { image } = buildSheet(e.recipe);
    e.hash = averageHash(image);
    timelineView.setThumb(e, timelineView.makeThumb(imageToCanvas(image, scratch)));
  }
  Object.assign(tl, got.tl);
  items = got.items;
  recipe = got.live || tl.entries[tl.playhead].recipe;
  selected = -1;
  const n = tl.entries.length, k = items.length;
  say(`Loaded ${file.name}${got.old ? ' (old app)' : ''}: ${n} timeline entr${n === 1 ? 'y' : 'ies'}, ` +
      `${k} kept sprite${k === 1 ? '' : 's'}` + (got.live ? ', and the unrecorded sheet it was saved with' : '') +
      (got.old ? ', with the old fold (v1)' : '') + (got.notes.length ? ` · ${got.notes.join(' · ')}` : ''),
      got.notes.length ? 'warn' : '');
  render();
  showTimeline();
  showCollection();
}

/* --------------------------------------------------------------- startup */
const controls = mountControls($('controls'), {
  onChange: change,
  onAction: name => ACTIONS[name](),
  onLoad: loadFile,
});
const view = mountSheetView($('stage'), { onSelect: select });
const inspector = mountInspector($('inspector'), {
  onCopyRecipe(){ copyText(JSON.stringify(soloRecipe(cellSettings(recipe, selected), recipe.sheet), null, 2), 'Recipe'); },
  onExport(){
    const s = sprites[selected];
    downloadPNG(rasterizeSolo(s, { scale: recipe.sheet.scale }), `spritesnow-${recipe.seeds[selected].toString(16)}.png`);
  },
  onLock: () => onSelected('lock'),
  onReroll: () => onSelected('reroll'),
  onKeep: () => onSelected('keep'),
});
$('fit').addEventListener('click', () => view.fit());
$('zoom-in').addEventListener('click', () => view.zoom(1.25));
$('zoom-out').addEventListener('click', () => view.zoom(0.8));

const KEYS = {
  r: () => ACTIONS.regenerate(),
  'Shift+r': () => onSelected('reroll'),
  l: () => onSelected('lock'),
  k: () => onSelected('keep'),
  Escape: () => select(-1),
  f: () => view.fit(),
  '+': () => view.zoom(1.25), '=': () => view.zoom(1.25), '-': () => view.zoom(0.8),
  ArrowLeft: () => jump(tl.playhead - 1), ArrowRight: () => jump(tl.playhead + 1),
  Home: () => jump(0), End: () => jump(tl.entries.length - 1),
  ' ': togglePlay,
  b: mark,
  Delete: () => { const before = tl.entries[tl.playhead]; if (deleteEntry(tl, tl.playhead)) removed(before); },
};
KEYS.Backspace = KEYS.Delete;
window.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' && e.target.closest('button')) return;      // Space presses a focused button
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const fn = (e.shiftKey && KEYS['Shift+' + key]) || KEYS[key];
  if (!fn) return;
  e.preventDefault();
  fn();
});

function loadFromHash(){
  try {
    const r = decode(location.hash);
    if (r) { recipe = r; return true; }
  } catch (err){ say(`The link's recipe could not be read (${err.message}); started a new sheet`, 'bad'); }
  return false;
}
window.addEventListener('hashchange', () => {
  if (location.hash === lastHash) return;
  if (loadFromHash()){ selected = -1; apply(recipe, 'link', 'opened a link'); }
});

if (!loadFromHash()) recipe = freshRecipe();
render();
record('start', 'session start');
showCollection();
