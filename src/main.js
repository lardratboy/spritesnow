/* Composition root: recipe -> generate -> rasterize -> view.
   The recipe is the only state that matters. Everything on screen is
   rebuilt from it, and the URL hash always holds it, so a copied link
   rebuilds the same sheet. Randomness for NEW seeds lives here, in the UI;
   src/core/ never calls Math.random.
   The timeline (workshop/timeline.js) records the recipe after every
   change, so any entry replays exactly what was on screen. The collection
   (workshop/collection.js) sits outside the timeline, and a session file
   (workshop/session.js) saves both.
   The screen shows the sheet at scale 1 and the view zooms by the scale;
   sprites come from a cache, and only changed cells are redrawn
   (workshop/sheet.js). Exports rasterise at the scale on demand.
   The view draws the sprites with WebGL2 (ui/gl-sheet.js), or the scale-1
   canvas when it cannot; ?gl=0 in the URL forces the canvas. The block
   grid (G) is a view setting: it is not in the recipe or the timeline.
   An animated sheet (M6b) plays: the player's clock is a whole number of
   frames, the view shows that time (the GPU picks each sprite's frame;
   the 2D path is handed that frame's image), and the inspector follows.
   Play, pause, the frame and the scrubber are view state, like the block
   grid; fps is in the recipe (sheet.fps), since exports use it too. A
   sheet over the on-screen cap holds every k-th frame (workshop/sheet.js
   framePlan), and the status line says so. */
import { normalize, cellSettings, resizeSheet, soloRecipe } from './recipe/schema.js';
import { encode, decode } from './recipe/permalink.js';
import { aut } from './core/groups2d.js';
import { rasterizeSolo, rasterizePacked, packedLayout, sheetSize } from './raster/rasterize.js';
import { imageToCanvas, updateCanvas, canvasFits, downloadPNG, downloadBlob, downloadAPNG, APNG_LIMIT } from './raster/png.js';
import { createTimeline, commit, goTo, deleteEntry, dropEntries, prunePlan, markKeyframe,
         setRecording } from './workshop/timeline.js';
import { isLocked, toggleLock, rerollCell, reseedUnlocked, lockedDifferences } from './workshop/cells.js';
import { keep, rename, remove, move, restore, packGrid } from './workshop/collection.js';
import { saveSession, readSession } from './workshop/session.js';
import { createSpriteCache, cachedSprite, buildSheet, sheetLayout, framesOf, frameIndex, atFrame,
         sheetFrame, sheetHash, ATLAS_CAP } from './workshop/sheet.js';
import { generateFrames } from './core/generate.js';
import { paletteFor } from './core/palette.js';
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
let selected = -1;
let note = null;              // { text, cls } shown in the status line until the next action
const tl = createTimeline();
let items = [];               // the collection

/* ---------------------------------------------------------------- render */
const sheetCanvas = document.createElement('canvas');
const cache = createSpriteCache();
let sheet = null;             // the live build: sprites and the sheet image at scale 1
let built = { ms: 0, generated: 0, count: 0 };

function render(){
  const t0 = performance.now();
  sheet = buildSheet(recipe, cache, sheet);
  if (sheet.dirty) updateCanvas(sheet.image, sheetCanvas, sheet.dirty);
  else imageToCanvas(sheet.image, sheetCanvas);
  view.setSheet(sheet, sheetCanvas, recipe.sheet.scale);
  if (selected >= sheet.sprites.length) selected = -1;
  view.setLocked(Object.keys(recipe.overrides).map(Number));
  view.setSelection(selected);
  controls.update(recipe);
  showInspector();
  syncPlayer();
  built = { ms: performance.now() - t0, generated: sheet.generated, count: built.count + 1 };
  setStatus();
  writeHash();
}

function showInspector(){
  if (selected < 0) return inspector.show(null);
  const sprite = sheet.sprites[selected], c = cellSettings(recipe, selected);
  const anim = c.gen.frames > 1 ? framesOf(c.seed, c.gen, c.paletteSeed, sheet.plan.stride === 1 ? cache : null) : null;
  inspector.show({
    index: selected, seed: c.seed, sprite, gen: c.gen, paletteSeed: c.paletteSeed,
    aut: aut(sprite.grid, sprite.w, sprite.h), image: rasterizeSolo(sprite, { scale: 1 }),
    frames: anim && anim.T > 1 ? anim.frames.map(grid => rasterizeSolo({ ...anim, grid }, { scale: 1 })) : null,
    fit: anim ? anim.fit : null,
    locked: isLocked(recipe, selected), differs: lockedDifferences(recipe, selected),
  });
  inspector.setFrame(player.t);
}

/* The status line: the last build, then the latest note. "generated" counts
   the sprites that were not in the cache, so a one-cell reroll says 1. */
function setStatus(){
  const { cols, rows } = recipe.sheet, { w, h } = recipe.gen, { ms, generated } = built;
  const status = $('status'), plan = sheet.plan;
  status.textContent = `${cols * rows} sprites · ${w}×${h} · scale ${recipe.sheet.scale} · ` +
    (plan.T > 1 ? `${plan.T} frames at ${recipe.sheet.fps} fps · ` : '') +
    `${generated} generated, built in ${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms · ${view.renderer}`;
  if (plan.stride > 1){
    const span = document.createElement('span');
    span.className = 'warn';
    span.textContent = ` · showing ${plan.frames > 1 ? `every ${ordinal(plan.stride)} frame` : 'frame 0 only'}: ` +
                       `all ${plan.T} would be ${mega(plan.full)} sprite cells, ` +
                       `over the ${mega(ATLAS_CAP)} on-screen cap (exports have every frame)`;
    status.append(span);
  }
  if (note){
    const span = document.createElement('span');
    span.className = note.cls || '';
    span.textContent = ' · ' + note.text;
    status.append(span);
  }
}
const say = (text, cls) => { note = { text, cls }; };
const mega = n => { const m = n / 1048576; return `${m < 10 && m % 1 ? m.toFixed(1) : Math.round(m)}M`; };
const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd'
                          : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

/* ------------------------------------------------------------- animation
   The clock counts whole frames from when play was pressed (or the recipe
   last changed), so frames keep time at sheet.fps whatever the display's
   refresh rate. The loop is plan.loop frames. */
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const player = { playing: !reduceMotion, t: 0, raf: 0, from: 0, t0: 0 };
const frameCanvas = document.createElement('canvas');

/* The sheet at time t for the 2D path: the scale-1 sheet when every sprite
   is on its frame 0 there. */
function frameImage(t){
  if (sheet.plan.T <= 1 || sheet.sprites.every(s => frameIndex(s, t) === 0)) return sheetCanvas;
  return imageToCanvas(sheetFrame(sheet, t), frameCanvas);
}
function showFrame(t){
  player.t = t;
  view.setFrame(t, view.renderer === '2D' ? frameImage(t) : null);
  inspector.setFrame(t);
  playbar.update();
}
function tick(now){
  player.raf = 0;
  if (!player.playing || sheet.plan.loop <= 1) return;
  const t = (player.from + Math.floor((now - player.t0) * recipe.sheet.fps / 1000)) % sheet.plan.loop;
  if (t !== player.t) showFrame(t);
  player.raf = requestAnimationFrame(tick);
}
function runClock(){
  cancelAnimationFrame(player.raf);
  player.raf = 0;
  if (!player.playing || sheet.plan.loop <= 1) return;
  player.from = player.t; player.t0 = performance.now();
  player.raf = requestAnimationFrame(tick);
}
/** After a build: keep the time inside the new loop and show it. */
function syncPlayer(){
  showFrame(player.t % sheet.plan.loop);
  runClock();
}
function setPlaying(on){
  player.playing = on;
  runClock();
  playbar.update();
}
function stepFrame(d){
  const L = sheet.plan.loop;
  if (L <= 1) return;
  player.playing = false;
  runClock();
  showFrame(((player.t + d) % L + L) % L);
}

const playbar = (() => {
  const bar = $('playbar'), play = $('play'), scrub = $('scrub'), readout = $('frame-no');
  play.addEventListener('click', () => setPlaying(!player.playing));
  scrub.addEventListener('input', () => { player.playing = false; runClock(); showFrame(Number(scrub.value)); });
  return {
    update(){
      if (!sheet) return;
      const { loop, T, stride } = sheet.plan;
      bar.classList.toggle('hidden', loop <= 1);
      play.textContent = player.playing ? '❚❚' : '▶';
      play.setAttribute('aria-pressed', String(player.playing));
      play.title = `${player.playing ? 'Pause' : 'Play'} the animation (P); , and . step a frame`;
      scrub.max = String(loop - 1);
      if (document.activeElement !== scrub) scrub.value = String(player.t);
      readout.textContent = `${player.t} / ${loop}` + (loop !== T ? ` (loops of up to ${T})` : '') +
                            (stride > 1 ? (sheet.plan.frames > 1 ? ` · every ${ordinal(stride)}` : ' · frame 0 only') : '');
    },
  };
})();

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
/* The pruner hashes the sheet at scale 1, so an entry's hash does not
   depend on its scale (before M4a it hashed the sheet at its scale). An
   animated sheet's hash covers every frame it holds (M6b). */
const liveOpts = () => ({ hash: sheetHash(sheet) });

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
    setStatus();
    removed(before);
  },
});

/* --------------------------------------------------------------- actions */
/** One setting, or several at once when `key` is a patch object (one
 *  timeline entry either way). */
function change(part, key, value){
  if (typeof key === 'object'){
    return apply(normalize({ ...recipe, [part]: { ...recipe[part], ...key } }), `set:${part}.${Object.keys(key).join('+')}`);
  }
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
  setStatus();
}

const ACTIONS = {
  'regenerate'(){
    const n = Object.keys(recipe.overrides).length;
    apply(reseedUnlocked(recipe, randomU32), 'regenerate', n ? `new seeds, ${n} locked kept` : 'new seeds');
  },
  'new-palette'(){ apply({ ...recipe, paletteSeed: randomU32() }, 'palette', 'new palette'); },
  'copy-link'(){ lastHash = encode(recipe); history.replaceState(null, '', lastHash); copyText(location.href, 'Link'); },
  /* The sheet as shown: at an animated sheet's current time. */
  'export-sheet'(){
    const { cols, rows, scale } = recipe.sheet, build = sheet, layout = sheetLayout(recipe), t = player.t;
    let fits = scale;
    while (fits > 1 && !sizeFits(sheetSize(layout, fits))) fits--;
    exportPNG(sheetSize(layout, scale), () => sheetFrame(build, t, scale),
              `spritesnow-sheet-${cols}x${rows}${build.plan.T > 1 ? `-t${t}` : ''}.png`, ` at scale ${scale}; scale ${fits} fits`);
  },
  /* Every frame of the loop, every sprite on every frame, whatever the
     on-screen cap. */
  async 'export-apng'(){
    const { cols, rows, scale, fps } = recipe.sheet, r = recipe, plan = sheet.plan, layout = sheetLayout(r);
    if (plan.loop <= 1){ say('the sheet is a still: set Frames above 1 to export an animation'); return setStatus(); }
    const size = sheetSize(layout, scale), name = `spritesnow-sheet-${cols}x${rows}-${plan.loop}f.png`;
    if (!checkAnimation(size, plan.loop, name, scale)) return;
    const full = plan.stride === 1 ? sheet.sprites : r.seeds.map((_, i) => {
      const c = cellSettings(r, i);
      return generateFrames(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc));
    });
    const build = { sprites: full, layout };
    await saveAnimation({ ...size, count: plan.loop, fps, frame: t => sheetFrame(build, t, scale) }, name,
                        `exported ${plan.loop} frames at ${fps} fps as ${name}`);
  },
  'save-session': () => saveFile(),
};

/* Cell actions. Lock and reroll are timeline entries; keeping a sprite
   changes only the collection, which sits outside the timeline. */
const CELL = {
  lock(i){ apply(toggleLock(recipe, i), 'lock', `${isLocked(recipe, i) ? 'unlock' : 'lock'} #${i + 1}`); },
  reroll(i){ apply(rerollCell(recipe, i, randomU32()), 'reroll', `reroll #${i + 1}`); },
  keep(i){
    const out = keep(items, recipe, i, { recipeText: sheet.sprites[i].recipeText, entry: tl.playhead + 1, now: Date.now() });
    items = out.items;
    showCollection(out.item.id);
    say(`kept #${i + 1} as "${out.item.name}"`); setStatus();
  },
};
function onSelected(action){
  if (selected >= 0) return CELL[action](selected);
  say('select a sprite first'); setStatus();
}
function select(i, { shift = false, mod = false, alt = false } = {}){
  selected = i;
  if (i >= 0 && shift) return CELL.reroll(i);
  if (i >= 0 && mod) return CELL.lock(i);
  view.setSelection(i);
  showInspector();
  if (i >= 0 && alt) CELL.keep(i);
}

/* Exports rasterise at the sheet's scale when asked. One too big for a
   browser canvas is refused before its pixels are allocated. */
const sizeFits = ({ width, height }) => canvasFits(width, height);
/* An animation is refused when one frame would not fit a canvas, or all
   of them together would be more than APNG_LIMIT bytes. */
function checkAnimation({ width, height }, count, filename, scale){
  const bytes = width * height * 4 * count;
  if (sizeFits({ width, height }) && bytes <= APNG_LIMIT) return true;
  say(`${filename} would be ${count} frames of ${width}×${height} px (${mega(bytes)}B), too big to export at scale ${scale}`, 'bad');
  setStatus();
  return false;
}
async function saveAnimation(opts, filename, done){
  say(`encoding ${filename}…`); setStatus();
  const ok = await downloadAPNG(opts, filename);
  say(ok ? done : `the browser could not encode ${filename}`, ok ? '' : 'bad');
  setStatus();
}
/** @returns {Promise<boolean>} whether the PNG was saved */
async function exportPNG(size, make, filename, hint = ''){
  const px = `${size.width}×${size.height} px`, fail = text => { say(text, 'bad'); setStatus(); return false; };
  if (!sizeFits(size)) return fail(`${filename} would be ${px}, too big for a browser to export${hint}`);
  return await downloadPNG(make(), filename) || fail(`the browser could not encode ${filename} (${px})`);
}

/* ------------------------------------------------------------ collection */
const itemSprite = it => cachedSprite(cache, it.seed, it.gen, it.paletteSeed);
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
  async onExportSheet(){
    if (!items.length) return;
    const { cols, rows } = packGrid(items.length), list = items.map(itemSprite);
    const pack = { cols, spacing: recipe.sheet.spacing }, scale = recipe.sheet.scale;
    if (!await exportPNG(sheetSize(packedLayout(list, pack), scale), () => rasterizePacked(list, pack, { scale }),
                         `spritesnow-collection-${items.length}.png`)) return;
    say(`exported ${items.length} kept sprite${items.length === 1 ? '' : 's'} as a ${cols}×${rows} sheet`); setStatus();
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
  setStatus();
}

/* Loading a session replaces the timeline and the collection, after asking
   if there is work to lose. Old sessions load the same way, with the old
   fold (v1). */
async function loadFile(file){
  let got;
  try { got = readSession(await file.text()); }
  catch (err){ say(`Could not load ${file.name}: ${err.message}`, 'bad'); return setStatus(); }
  if ((tl.entries.length > 1 || items.length) &&
      !confirm(`Replace the current session (${tl.entries.length} timeline entries, ${items.length} kept sprites) ` +
               `with ${file.name}?\n\nSave the current one first if you want to keep it.`)) return;
  if (playTimer) togglePlay();
  // one sheet at a time: keep its hash and a thumbnail, not the image
  const scratch = document.createElement('canvas');
  for (const e of got.tl.entries){
    const build = buildSheet(e.recipe, cache);
    e.hash = sheetHash(build);
    timelineView.setThumb(e, timelineView.makeThumb(imageToCanvas(build.image, scratch)));
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
const view = mountSheetView($('stage'), { onSelect: select, gl: new URLSearchParams(location.search).get('gl') !== '0' });
/* For the browser tests (test/browser/) and the console: builds counts
   render() calls, so a test can tell that pan and zoom rebuilt nothing. */
window.spritesnow = {
  view, stats: () => ({ builds: built.count, ...view.stats() }),
  player: { play: () => setPlaying(true), pause: () => setPlaying(false), show: showFrame,
            get t(){ return player.t; }, get playing(){ return player.playing; }, get plan(){ return sheet.plan; } },
};
const inspector = mountInspector($('inspector'), {
  onCopyRecipe(){ copyText(JSON.stringify(soloRecipe(cellSettings(recipe, selected), recipe.sheet), null, 2), 'Recipe'); },
  /* The sprite as shown, at an animated sprite's current frame. */
  onExport(){
    const s = selectedFrames(), j = s.T > 1 ? player.t % s.T : 0;
    downloadPNG(rasterizeSolo(atFrame(s, j), { scale: recipe.sheet.scale }),
                `spritesnow-${recipe.seeds[selected].toString(16)}${s.T > 1 ? `-f${j}` : ''}.png`);
  },
  /* Every frame side by side, frame 0 on the left. */
  onStrip(){
    const s = selectedFrames(), scale = recipe.sheet.scale, name = `spritesnow-${recipe.seeds[selected].toString(16)}-strip.png`;
    exportPNG({ width: s.w * s.T * scale, height: s.h * scale },
              () => rasterizePacked(s.frames.map((_, j) => atFrame(s, j)), { cols: s.T, spacing: 0 }, { scale }), name);
  },
  async onAPNG(){
    const s = selectedFrames(), { scale, fps } = recipe.sheet, size = { width: s.w * scale, height: s.h * scale };
    const name = `spritesnow-${recipe.seeds[selected].toString(16)}-${s.T}f.png`;
    if (!checkAnimation(size, s.T, name, scale)) return;
    await saveAnimation({ ...size, count: s.T, fps, frame: j => rasterizeSolo(atFrame(s, j), { scale }) }, name,
                        `exported ${s.T} frames at ${fps} fps as ${name}`);
  },
  onPickFrame(t){ player.playing = false; runClock(); showFrame(t); },
  onLock: () => onSelected('lock'),
  onReroll: () => onSelected('reroll'),
  onKeep: () => onSelected('keep'),
});
/* The selected sprite with every frame (a still: its one frame). */
function selectedFrames(){
  const c = cellSettings(recipe, selected);
  return framesOf(c.seed, c.gen, c.paletteSeed, sheet.plan.stride === 1 ? cache : null);
}
$('fit').addEventListener('click', () => view.fit());
function toggleBlocks(){
  view.setBlockGrid(!view.blockGrid);
  $('blocks').setAttribute('aria-pressed', String(view.blockGrid));
  if (view.blockGrid && !view.blockEdgeCount()){ say('block grid on, but no sprite on the sheet has tiers on'); setStatus(); }
}
$('blocks').addEventListener('click', toggleBlocks);
/* Dark or light: a view setting kept in localStorage, not in the recipe.
   index.html applies the saved one before the first paint. */
function setTheme(light){
  const root = document.documentElement;
  if (light) root.dataset.theme = 'light'; else delete root.dataset.theme;
  try { localStorage.setItem('spritesnow.theme', light ? 'light' : 'dark'); } catch {}
  $('theme').textContent = light ? '☾' : '☀';
  $('theme').title = light ? 'Dark theme (T)' : 'Light theme (T)';
  view.redraw();            // the outlines and block grid take their colours from CSS
}
const toggleTheme = () => setTheme(document.documentElement.dataset.theme !== 'light');
setTheme(document.documentElement.dataset.theme === 'light');
$('theme').addEventListener('click', toggleTheme);
$('zoom-in').addEventListener('click', () => view.zoom(1.25));
$('zoom-out').addEventListener('click', () => view.zoom(0.8));

const KEYS = {
  r: () => ACTIONS.regenerate(),
  'Shift+r': () => onSelected('reroll'),
  l: () => onSelected('lock'),
  k: () => onSelected('keep'),
  Escape: () => select(-1),
  f: () => view.fit(),
  g: toggleBlocks,
  t: toggleTheme,
  '+': () => view.zoom(1.25), '=': () => view.zoom(1.25), '-': () => view.zoom(0.8),
  ArrowLeft: () => jump(tl.playhead - 1), ArrowRight: () => jump(tl.playhead + 1),
  Home: () => jump(0), End: () => jump(tl.entries.length - 1),
  ' ': togglePlay,
  b: mark,
  p: () => { if (sheet.plan.loop > 1) setPlaying(!player.playing); },
  ',': () => stepFrame(-1), '.': () => stepFrame(1),
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
