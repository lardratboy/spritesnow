/* Composition root: recipe -> generate -> rasterize -> view.
   The recipe is the only state that matters. Everything on screen is
   rebuilt from it, and the URL hash always holds it, so a copied link
   rebuilds the same sheet. Randomness for NEW seeds lives here, in the UI;
   src/core/ never calls Math.random. */
import { normalize, cellSettings, resizeSheet } from './recipe/schema.js';
import { encode, decode } from './recipe/permalink.js';
import { importSession } from './recipe/import-v4.js';
import { generateSprite } from './core/generate.js';
import { paletteFor } from './core/palette.js';
import { aut } from './core/groups2d.js';
import { rasterizeSheet, rasterizeSolo } from './raster/rasterize.js';
import { imageToCanvas, downloadPNG } from './raster/png.js';
import { mountControls } from './ui/controls.js';
import { mountSheetView } from './ui/sheet-view.js';
import { mountInspector } from './ui/inspector.js';

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

/* ---------------------------------------------------------------- render */
const sheetCanvas = document.createElement('canvas');
let sheetImage = null;

function render(){
  const t0 = performance.now();
  const n = recipe.seeds.length;
  sprites = new Array(n);
  for (let i = 0; i < n; i++){
    const c = cellSettings(recipe, i);
    sprites[i] = generateSprite(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc));
  }
  const { cols, rows, spacing, scale } = recipe.sheet, { w, h } = recipe.gen;
  sheetImage = rasterizeSheet(sprites.map((sprite, i) => ({ sprite, col: i % cols, row: (i / cols) | 0 })),
                              { cols, rows, cellW: w, cellH: h, spacing }, { scale });
  imageToCanvas(sheetImage, sheetCanvas);
  view.setImage(sheetCanvas, { cols, rows, outerW: (w + spacing) * scale, outerH: (h + spacing) * scale,
                               offX: 0, offY: 0, spriteW: w * scale, spriteH: h * scale });
  if (selected >= n) selected = -1;
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
    override: !!recipe.overrides[selected],
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

/* --------------------------------------------------------------- actions */
function change(part, key, value){
  note = null;
  if (part === 'sheet' && (key === 'cols' || key === 'rows')){
    const cols = key === 'cols' ? value : recipe.sheet.cols, rows = key === 'rows' ? value : recipe.sheet.rows;
    const n = normalize({ ...recipe, sheet: { ...recipe.sheet, cols, rows } }).sheet;   // clamp first
    recipe = normalize(resizeSheet(recipe, n.cols, n.rows, randomU32));
  } else {
    recipe = normalize({ ...recipe, [part]: { ...recipe[part], [key]: value } });
  }
  render();
}

async function copyText(text, what){
  try { await navigator.clipboard.writeText(text); say(`${what} copied`); }
  catch { prompt(`Copy the ${what.toLowerCase()}:`, text); say(`${what} shown for copying`); }
  setStatus(0);
}

const ACTIONS = {
  'regenerate'(){ note = null; recipe = { ...recipe, seeds: recipe.seeds.map(randomU32) }; render(); },
  'new-palette'(){ note = null; recipe = { ...recipe, paletteSeed: randomU32() }; render(); },
  'copy-link'(){ lastHash = encode(recipe); history.replaceState(null, '', lastHash); copyText(location.href, 'Link'); },
  'export-sheet'(){ downloadPNG(sheetImage, `spritesnow-sheet-${recipe.sheet.cols}x${recipe.sheet.rows}.png`); },
};

async function importFile(file){
  try {
    const { recipes, playhead, notes } = importSession(await file.text());
    recipe = recipes[playhead];
    selected = -1;
    say(`Imported ${file.name}: timeline entry ${playhead + 1} of ${recipes.length}, using the old fold (v1)` +
        (notes.length ? ` · ${notes.join(' · ')}` : ''), notes.length ? 'warn' : '');
    render();
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
const view = mountSheetView($('stage'), { onSelect: i => { selected = i; view.setSelection(i); showInspector(); } });
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
});
$('fit').addEventListener('click', () => view.fit());
$('zoom-in').addEventListener('click', () => view.zoom(1.25));
$('zoom-out').addEventListener('click', () => view.zoom(0.8));

window.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'r' || e.key === 'R') ACTIONS.regenerate();
  else if (e.key === 'f' || e.key === 'F') view.fit();
  else if (e.key === '+' || e.key === '=') view.zoom(1.25);
  else if (e.key === '-') view.zoom(0.8);
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
  if (loadFromHash()){ selected = -1; render(); }
});

if (!loadFromHash()) recipe = freshRecipe();
render();
