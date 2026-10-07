/* Composition root: recipe -> generate -> rasterize -> view.
   The recipe is the only state that matters. Everything on screen is
   rebuilt from it, and the URL hash always holds it, so a copied link
   rebuilds the same sheet. Randomness for NEW seeds lives here, in the UI;
   src/core/ never calls Math.random.
   The timeline (workshop/timeline.js) records the recipe after every
   change, so any entry replays exactly what was on screen. */
import { normalize, cellSettings, resizeSheet } from './recipe/schema.js';
import { encode, decode } from './recipe/permalink.js';
import { importSession } from './recipe/import-v4.js';
import { generateSprite } from './core/generate.js';
import { paletteFor } from './core/palette.js';
import { aut } from './core/groups2d.js';
import { rasterizeSheet, rasterizeSolo } from './raster/rasterize.js';
import { imageToCanvas, downloadPNG } from './raster/png.js';
import { createTimeline, commit, goTo, deleteEntry, dropEntries, prunePlan, markKeyframe, setRecording,
         appendEntries } from './workshop/timeline.js';
import { averageHash } from './workshop/frame-hash.js';
import { isLocked, toggleLock, rerollCell, reseedUnlocked, lockedDifferences } from './workshop/cells.js';
import { mountControls } from './ui/controls.js';
import { mountSheetView } from './ui/sheet-view.js';
import { mountInspector } from './ui/inspector.js';
import { mountTimelineView } from './ui/timeline-view.js';

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
};

/* Cell actions. Each one is a timeline entry. */
const CELL = {
  lock(i){ apply(toggleLock(recipe, i), 'lock', `${isLocked(recipe, i) ? 'unlock' : 'lock'} #${i + 1}`); },
  reroll(i){ apply(rerollCell(recipe, i, randomU32()), 'reroll', `reroll #${i + 1}`); },
};
function onSelected(action){
  if (selected >= 0) return CELL[action](selected);
  say('select a sprite first'); setStatus(0);
}
function select(i, { shift = false, mod = false } = {}){
  selected = i;
  if (i >= 0 && shift) return CELL.reroll(i);
  if (i >= 0 && mod) return CELL.lock(i);
  view.setSelection(i);
  showInspector();
}

/* An old session's whole timeline is added after the current entries
   (nothing is replaced), with the playhead on the entry the user saved at. */
async function importFile(file){
  try {
    const { entries, playhead, notes } = importSession(await file.text());
    // one sheet at a time: keep its hash and a thumbnail, not the image
    const scratch = document.createElement('canvas');
    const list = entries.map(e => {
      const { image } = buildSheet(e.recipe);
      return { ...e, hash: averageHash(image), thumb: timelineView.makeThumb(imageToCanvas(image, scratch)) };
    });
    appendEntries(tl, list, playhead).forEach((entry, k) => timelineView.setThumb(entry, list[k].thumb));
    recipe = tl.entries[tl.playhead].recipe;
    selected = -1;
    say(`Imported ${file.name}: added its ${entries.length} timeline entr${entries.length === 1 ? 'y' : 'ies'}, ` +
        `showing the one it was saved at (its #${playhead + 1}), with the old fold (v1)` +
        (notes.length ? ` · ${notes.join(' · ')}` : ''), notes.length ? 'warn' : '');
    render();
    showTimeline();
  } catch (err){
    say(`Could not import ${file.name}: ${err.message}`, 'bad');
    setStatus(0);
  }
}

/* --------------------------------------------------------------- startup */
const controls = mountControls($('controls'), {
  onChange: change,
  onAction: name => ACTIONS[name](),
  onImport: importFile,
});
const view = mountSheetView($('stage'), { onSelect: select });
const inspector = mountInspector($('inspector'), {
  onCopyRecipe(){
    const c = cellSettings(recipe, selected);
    const one = normalize({ gen: c.gen, sheet: { ...recipe.sheet, cols: 1, rows: 1 }, paletteSeed: c.paletteSeed, seeds: [c.seed] });
    copyText(JSON.stringify(one, null, 2), 'Recipe');
  },
  onExport(){
    const s = sprites[selected];
    downloadPNG(rasterizeSolo(s, { scale: recipe.sheet.scale }), `spritesnow-${recipe.seeds[selected].toString(16)}.png`);
  },
  onLock: () => onSelected('lock'),
  onReroll: () => onSelected('reroll'),
});
$('fit').addEventListener('click', () => view.fit());
$('zoom-in').addEventListener('click', () => view.zoom(1.25));
$('zoom-out').addEventListener('click', () => view.zoom(0.8));

const KEYS = {
  r: () => ACTIONS.regenerate(),
  'Shift+r': () => onSelected('reroll'),
  l: () => onSelected('lock'),
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
