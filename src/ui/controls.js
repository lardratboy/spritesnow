/* Sidebar controls: edit the recipe. Built from a table, so adding a
   setting means adding one row here (and its spec in recipe/schema.js).
   The symmetry picker lists all 10 SUBGROUPS (newdesign.md D4), and warns
   when a non-square sprite reduces the group (D3).
   The Tiers section (newdesign.md §5.2, M5a) is built by mountTiers below,
   because its rows depend on the size and the split. Its last row is the
   tier field (M5b), shown while tiers are on or a field is set.
   The Animation section (newdesign.md §5.3, M6a) is table rows (Frames,
   Drive, Amount) with two slots built by mountAnimation: the motion
   picker, and the notes under the drive. FPS (M6b) is a sheet setting
   shown in that section: a row may name its own part. */
import { FIELDS } from '../core/fields.js';
import { MASKS } from '../core/masks.js';
import { SUBGROUPS, groupById, effectiveGroup, orbitTable } from '../core/groups2d.js';
import { cachedTieredTable } from '../core/tiers.js';
import { TIER_FIELDS, tierFieldState } from '../core/tierfields.js';
import { parseTiers, printTiers, tierState, factorizations, withSplit } from '../recipe/tiers.js';
import { MOTION_PRESETS, ELEMENT_CHOICES, TIME_CHOICES, parseMotion, printMotion, animationReadout }
  from '../recipe/motion.js';

const notNoise = g => g.source !== 'noise';
const animated = g => g.frames > 1;
const SECTIONS = [
  { title: 'Generator', rows: [
    { key:'source', type:'select', label:'Source',
      options:[['field','Modulo field'], ['noise','Random noise'], ['custom','Custom expression']] },
    { key:'formula', type:'select', label:'Formula', show: g => g.source === 'field',
      options:[['mix','Random mix'], ...FIELDS.map(f => [f.id, f.name])] },
    { key:'expr', type:'textarea', label:'Expression', show: g => g.source === 'custom',
      hint:'JavaScript using x, y, u, v, w, h and P (P.M is the modulus).' },
    { key:'modulus', type:'number', label:'Modulus', min:2, max:512, show: notNoise },
    { key:'stride', type:'number', label:'Stride', min:1, max:8, show: notNoise },
    { key:'phase', type:'range', label:'Phase', min:0, max:1, step:0.01, show: notNoise },
    { key:'coverage', type:'range', label:'Coverage', min:0.05, max:1, step:0.05 },
    { key:'vary', type:'checkbox', label:'Vary formula and modulus per cell', show: g => g.source === 'field' },
    { key:'ca', type:'checkbox', label:'Smooth (CA pass)', show: g => g.source === 'noise' },
  ]},
  { title: 'Mask', rows: [
    { key:'mask', type:'select', label:'Shape',
      options:[...MASKS.map(m => [m.id, m.name]), ['mix','Random mix']] },
    { key:'maskScale', type:'range', label:'Size', min:0.4, max:1.45, step:0.05 },
    { key:'maskInvert', type:'checkbox', label:'Invert' },
    { key:'outline', type:'checkbox', label:'Outline' },
  ]},
  { title: 'Sprite', rows: [
    { key:'w', type:'number', label:'Width', min:2, max:64 },
    { key:'h', type:'number', label:'Height', min:2, max:64 },
    { key:'symmetry', type:'select', label:'Symmetry', options: SUBGROUPS.map(g => [g.id, g.name]) },
    { key:'fold', type:'select', label:'Fold', numeric:true,
      options:[[2, 'Corrected (v2)'], [1, 'Old app, exact (v1)']] },
  ]},
  { title: 'Animation', rows: [
    { key:'frames', type:'number', label:'Frames', min:1, max:64 },
    { type:'slot', key:'motion' },
    { key:'drive', type:'select', label:'Drive', show: animated,
      options:[['phase','Phase · the bands flow'], ['spin','Spin · the field turns'], ['drift','Drift · the field circles']] },
    { key:'driveAmount', type:'number', label:'Amount', min:-16, max:16, show: animated },
    { key:'fps', part:'sheet', type:'number', label:'FPS', min:1, max:60, show: animated },
    { type:'slot', key:'notes' },
  ]},
  { title: 'Palette', rows: [
    { key:'bpc', type:'select', label:'Gamut', numeric:true,
      options:[[1,'1-bit'], [2,'2-bit'], [3,'3-bit'], [4,'4-bit'], [8,'8-bit']] },
    { key:'ncol', type:'number', label:'Colours', min:1, max:16 },
    { key:'colorMode', type:'select', label:'Assignment',
      options:[['bands','Bands (ramp)'], ['cycle','Cycle residue'], ['solid','Solid']] },
    { key:'sortLum', type:'checkbox', label:'Sort by luminance' },
  ], buttons: [['new-palette', 'New palette']] },
  { title: 'Sheet', part: 'sheet', rows: [
    { key:'cols', type:'number', label:'Columns', min:1, max:50 },
    { key:'rows', type:'number', label:'Rows', min:1, max:50 },
    { key:'spacing', type:'number', label:'Spacing', min:0, max:16 },
    { key:'scale', type:'number', label:'Scale (px)', min:1, max:24 },
  ]},
];

/**
 * @param {HTMLElement} root
 * @param {{ onChange:(part:string, key:string|object, value?:any) => void,   key may be a patch of several keys
 *           onAction:(name:string) => void,
 *           onLoad:(file:File) => void }} handlers
 * @returns {{ update:(recipe:object) => void }}
 */
export function mountControls(root, { onChange, onAction, onLoad }){
  const inputs = [];   // { row, part, el, readout }
  const tiersBox = mountTiers(text => onChange('gen', 'tiers', text), id => onChange('gen', 'tierField', id));
  const anim = mountAnimation(patch => onChange('gen', patch));

  for (const section of SECTIONS){
    const box = el('div', 'group');
    box.append(el('div', 'title', section.title));
    for (const row of section.rows){
      if (row.type === 'slot'){ box.append(anim[row.key]); continue; }
      const part = row.part || section.part || 'gen';
      const id = `c-${part}-${row.key}`;
      const line = el('div', 'row');
      let input, readout = null;
      if (row.type === 'checkbox'){
        line.classList.add('check');
        input = el('input'); input.type = 'checkbox'; input.id = id;
        const label = el('label'); label.htmlFor = id;
        label.append(input, document.createTextNode(row.label));
        line.append(label);
      } else {
        const label = el('label', null, row.label); label.htmlFor = id;
        if (row.type === 'select'){
          input = el('select');
          for (const [v, text] of row.options){ const o = el('option', null, text); o.value = String(v); input.append(o); }
        } else if (row.type === 'textarea'){
          line.classList.add('stack');
          input = el('textarea'); input.rows = 2; input.spellcheck = false;
        } else {
          input = el('input'); input.type = row.type;
          input.min = row.min; input.max = row.max;
          input.step = row.step ?? 1;
        }
        input.id = id;
        line.append(label, input);
        if (row.type === 'range'){ readout = el('span', 'val'); line.append(readout); }
        if (row.hint) line.append(el('div', 'hint', row.hint));
      }
      const read = () => row.type === 'checkbox' ? input.checked
                       : row.numeric || row.type === 'number' || row.type === 'range' ? Number(input.value)
                       : input.value;
      const fire = () => {
        if ((row.type === 'number') && (input.value === '' || !Number.isFinite(Number(input.value)))) return;
        onChange(part, row.key, read());
      };
      input.addEventListener(row.type === 'select' || row.type === 'checkbox' ? 'change' : 'input', fire);
      inputs.push({ row, part, el: input, line, readout });
      box.append(line);
    }
    if (section.title === 'Sprite'){
      const note = el('div', 'hint warn hidden'); note.id = 'symmetry-note';
      box.append(note);
    }
    if (section.buttons){
      const bar = el('div', 'buttons');
      for (const [name, text] of section.buttons) bar.append(button(text, () => onAction(name)));
      box.append(bar);
    }
    root.append(box);
    if (section.title === 'Sprite') root.append(tiersBox.box);
  }

  // actions
  const apng = button('↓ Sheet APNG', () => onAction('export-apng'), null,
                      'The animated sheet as an animated PNG, every frame, at the sheet scale and FPS');
  const actions = el('div', 'group');
  actions.append(el('div', 'title', 'Actions'));
  const bar = el('div', 'buttons');
  const file = el('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.className = 'hidden';
  file.addEventListener('change', () => { if (file.files[0]) onLoad(file.files[0]); file.value = ''; });
  bar.append(
    button('Regenerate', () => onAction('regenerate'), 'primary', 'New seeds for every unlocked cell (R)'),
    button('Copy link', () => onAction('copy-link'), null, 'The link is the recipe: it rebuilds this exact sheet'),
    button('↓ Sheet PNG', () => onAction('export-sheet'), null, 'Transparent PNG at the sheet scale (an animated sheet: the frame shown)'),
    apng,
    button('↓ Save session', () => onAction('save-session'), null, 'Save the timeline and the collection as one file'),
    button('↑ Load session', () => file.click(), null,
           'Open a saved session, from spritesnow or the old sprite generator. It replaces the current timeline and collection'),
  );
  actions.append(bar, file);
  actions.append(el('div', 'hint', 'Click a sprite to inspect it. Drag to pan, scroll to zoom. R regenerates, F fits. ' +
    '← → step through the timeline, Space replays it, B makes a keyframe. ' +
    'P plays or pauses an animation; , and . step a frame. ' +
    'L locks the selected sprite, Shift+R rerolls it, K keeps it in the collection ' +
    '(or ⌘/Ctrl-click, Shift-click, Alt-click).'));
  root.append(actions);

  const note = root.querySelector('#symmetry-note');

  return {
    /** Show a recipe. The focused field is left alone so typing is not interrupted. */
    update(recipe){
      const g = recipe.gen;
      for (const { row, part, el: input, line, readout } of inputs){
        const v = recipe[part][row.key];
        if (input !== document.activeElement){
          if (row.type === 'checkbox') input.checked = !!v; else input.value = String(v);
        }
        if (readout) readout.textContent = Number(v).toFixed(2);
        line.classList.toggle('hidden', !!(row.show && !row.show(g)));
      }
      // fold:1 only exists for groups the old app had
      const foldSel = inputs.find(i => i.row.key === 'fold').el;
      const legacy = !!groupById(g.symmetry).legacy;
      foldSel.querySelector('option[value="1"]').disabled = !legacy;
      // a rectangle cannot hold every symmetry: say what it becomes
      const eff = effectiveGroup(g.symmetry, g.w, g.h);
      note.classList.toggle('hidden', !eff.reduced);
      if (eff.reduced)
        note.textContent = `A ${g.w}×${g.h} sprite is not square, so this becomes ${groupById(eff.id).name}.`;
      tiersBox.update(g);
      apng.classList.toggle('hidden', !(g.frames > 1 || Object.values(recipe.overrides).some(o => o.gen.frames > 1)));
      // animation needs the corrected fold, as tiers do
      inputs.find(i => i.row.key === 'frames').el.disabled = g.fold !== 2;
      anim.update(g);
    },
  };
}

/* ------------------------------------------------------------------ tiers
   Across and Down list only the splits of the current size (radices outer
   to inner, so 4·4 is 4 blocks of 4 cells), and only lengths both sides
   share. Each tier then gets a block group and a copy group. The outer
   tier's block group is the Symmetry setting. Under each tier: the group
   it is guaranteed (often more than was asked for), and below, the number
   of free cells. Tiers that stop fitting stay in the recipe, switched off,
   and the note says why. A tier field that cannot act (no tiers, or noise)
   stays set, switched off, and its note says why. */
const KEEP = '__keep';
const NO_GROUP = [['', '—'], ...SUBGROUPS.map(g => [g.id, g.name])];
const dots = f => f.join('·');

const FIELD_HINTS = {
  'wreath': 'Each block shows the motif turned or mirrored, picked from its address.',
  'digit-swap': 'Digits are read in reverse significance (one tier: across and down swap).',
  'prefix-hash': 'Each block\'s address shifts the offsets and coefficients: a variant per block.',
  'phasecell': 'Each block\'s bands shift by its own phase.',
  'cross': 'Adds the dot and cross products of adjacent tiers\' digits.',
  'carry': 'Adds the odometer\'s carries: each block split on its anti-diagonal.',
};

function mountTiers(setTiers, setField){
  const box = el('div', 'group');
  box.append(el('div', 'title', 'Tiers'));
  const across = el('select'), down = el('select');
  across.id = 'c-tiers-across'; down.id = 'c-tiers-down';
  const acrossRow = labelled('Across', across), downRow = labelled('Down', down);
  const help = el('div', 'hint', 'Outer to inner: 4·4 is 4 blocks of 4 cells.');
  const note = el('div', 'hint');
  const tiersEl = el('div');
  const summary = el('div', 'hint tier-sum');
  const field = el('select');
  field.id = 'c-gen-tierField';
  fill(field, TIER_FIELDS.map(f => [f.id, f.name]));
  field.addEventListener('change', () => setField(field.value));
  const fieldRow = labelled('Field', field);
  const fieldNote = el('div', 'hint');
  box.append(acrossRow, downRow, help, tiersEl, summary, fieldRow, fieldNote, note);

  let gen = null, key = '';
  const prevTiers = () => parseTiers(gen.tiers).tiers;
  const current = () => { const s = tierState(gen); return s.on ? s.tiers : null; };

  across.addEventListener('change', () => {
    if (across.value === KEEP) return;
    if (across.value === '') return setTiers('');
    const a = across.value.split('·').map(Number);
    const on = current(), downs = factorizations(gen.h).filter(f => f.length === a.length);
    // A rectangular split keeps its Down when the length allows; otherwise
    // Down follows Across as closely as the height allows (the same split,
    // on a square sprite).
    const rect = on && on.some(t => t.rx !== t.ry);
    const d = rect && on.length === a.length ? on.map(t => t.ry) : closest(downs, a);
    setTiers(printTiers(withSplit(prevTiers(), a, d)));
  });
  down.addEventListener('change', () => {
    const on = current();
    if (on) setTiers(printTiers(withSplit(on, on.map(t => t.rx), down.value.split('·').map(Number))));
  });

  function build(){
    const { w, h, fold } = gen;
    const state = tierState(gen);
    const downLengths = new Set(factorizations(h).map(f => f.length));
    fill(across, [['', 'Off'], ...factorizations(w).filter(f => downLengths.has(f.length)).map(f => [dots(f), dots(f)]),
                  ...(gen.tiers && !state.on ? [[KEEP, `${gen.tiers} (off)`]] : [])]);
    across.value = state.on ? dots(state.tiers.map(t => t.rx)) : gen.tiers ? KEEP : '';
    across.disabled = fold !== 2;
    downRow.classList.toggle('hidden', !state.on);
    help.classList.toggle('hidden', !state.on);
    tiersEl.innerHTML = '';
    summary.textContent = '';
    buildField(state);
    note.className = 'hint';
    note.textContent = state.reason ? `Tiers off: ${state.reason}.`
                     : fold !== 2 ? 'Tiers need the corrected fold (v2).' : '';
    if (state.reason) note.classList.add('warn');
    if (!state.on) return;

    const n = state.tiers.length;
    fill(down, factorizations(h).filter(f => f.length === n).map(f => [dots(f), dots(f)]));
    down.value = dots(state.tiers.map(t => t.ry));
    const table = cachedTieredTable(gen.symmetry, w, h, state.tiers);
    table.tiers.forEach((t, i) => {
      const inner = i === n - 1;
      const what = inner ? `${t.rx}×${t.ry} cells` : `${t.rx}×${t.ry} blocks of ${t.sx}×${t.sy}`;
      tiersEl.append(el('div', 'hint tier-head', `Tier ${i + 1} · ${what}`));
      if (i === 0) tiersEl.append(labelled('Blocks', el('span', 'hint', 'the Symmetry setting')));
      else tiersEl.append(labelled('Blocks', groupSelect(`c-tier-${i}-block`, state.tiers[i].block,
                                                       id => edit(i, { block: id }))));
      tiersEl.append(labelled('Copies', groupSelect(`c-tier-${i}-copy`, state.tiers[i].copy,
                                                  id => edit(i, { copy: id }))));
      const parts = [];
      for (const [part, label, shape] of [['block', 'blocks', `${t.bw}×${t.bh} block`], ['copy', 'copies', `${t.rx}×${t.ry} grid`]]){
        const p = t[part];
        if (p.asked && p.fit !== p.asked) parts.push(`${groupById(p.asked).name} does not fit a ${shape}: ${groupById(p.fit).name}`);
        parts.push(`${label} ${groupById(p.result).name}`);
      }
      tiersEl.append(el('div', 'hint', `→ ${parts.join(' · ')}`));
    });
    const plain = orbitTable(gen.symmetry, w, h, 2).orbitCount;
    summary.textContent = `${table.orbitCount} free cells (orbits), ${plain} without tiers. ` +
                          `Sprite: ${groupById(table.group).name}.`;
  }
  function buildField(state){
    const fs = tierFieldState(gen, state);
    fieldRow.classList.toggle('hidden', !state.on && fs.id === 'none');
    field.value = fs.id;
    fieldNote.className = fs.reason ? 'hint warn' : 'hint';
    fieldNote.textContent = fs.reason ? `Tier field off: ${fs.reason}.` : FIELD_HINTS[fs.id] || '';
  }
  function edit(i, change){
    const tiers = current().map((t, j) => j === i ? { ...t, ...change } : t);
    setTiers(printTiers(tiers));
  }

  return {
    box,
    update(g){
      gen = g;
      const k = JSON.stringify([g.w, g.h, g.symmetry, g.fold, g.tiers, g.tierField, g.source === 'noise']);
      if (k === key) return;
      key = k;
      const focused = box.contains(document.activeElement) ? document.activeElement.id : null;
      build();
      if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
    },
  };
}

/* -------------------------------------------------------------- animation
   Motion: a preset from §5.3's table, or Custom, which shows up to two
   element and time pickers (more rows if the motion has more elements).
   Choosing a preset whose turn a drive already has offers that drive.
   The notes say what the drive does, why a motion is off, and how many
   frames and cells are free. */
const CUSTOM = '__custom';
const DRIVE_HINTS = {
  phase: 'The threshold slides through Amount cycles per loop, so the bands flow.',
  spin: 'The field turns Amount whole turns per loop, clockwise when positive.',
  drift: 'The field\'s offsets travel round a circle of radius Amount.',
};
const fmt = n => n.toLocaleString('en-US');

function mountAnimation(setGen){
  const motion = el('div'), notes = el('div');
  const preset = el('select');
  preset.id = 'c-gen-motion';
  fill(preset, [...MOTION_PRESETS.map(p => [p.motion, p.name]), [CUSTOM, 'Custom…']]);
  const presetRow = labelled('Motion', preset);
  const presetHint = el('div', 'hint');
  const pickers = el('div');
  motion.append(presetRow, presetHint, pickers);
  const driveHint = el('div', 'hint'), note = el('div', 'hint'), suggest = el('div', 'hint'), summary = el('div', 'hint tier-sum');
  notes.append(driveHint, suggest, note, summary);

  let gen = null, key = '', custom = false;
  preset.addEventListener('change', () => {
    custom = preset.value === CUSTOM;
    if (custom) build(); else setGen({ motion: preset.value });
  });

  function build(){
    const g = gen, text = String(g.motion || '').trim();
    const r = animationReadout(g);
    const show = g.frames > 1 || !!text;
    motion.classList.toggle('hidden', !show);
    const known = MOTION_PRESETS.find(p => p.motion === text);
    if (!known) custom = true;
    preset.value = custom ? CUSTOM : text;
    presetHint.textContent = !custom && known ? known.hint : 'Each element turns or mirrors the frames, and moves them in time.';

    // custom pickers: one row per element, at least two
    pickers.innerHTML = '';
    if (custom){
      const els = parseMotion(text).motion || [];
      const rows = Math.max(2, els.length);
      for (let i = 0; i < rows; i++){
        const m = els[i];
        const e = el('select'), t = el('select');
        e.id = `c-motion-${i}-element`; t.id = `c-motion-${i}-time`;
        fill(e, [['', '—'], ...ELEMENT_CHOICES]);
        const time = m ? printMotion([m]).split(' ')[1] : '+1/2';
        fill(t, [...TIME_CHOICES, ...(TIME_CHOICES.some(([v]) => v === time) ? [] : [[time, time]])]);
        e.value = m ? m.name : ''; t.value = time;
        t.disabled = !m;
        const change = () => {
          const list = [];
          pickers.querySelectorAll('.motion-el').forEach(row => {
            const [se, st] = row.querySelectorAll('select');
            if (se.value) list.push(`${se.value} ${st.value}`);
          });
          setGen({ motion: list.join(', ') });
        };
        e.addEventListener('change', change); t.addEventListener('change', change);
        const line = labelled(`Element ${i + 1}`, e);
        line.classList.add('motion-el');
        line.append(t);
        pickers.append(line);
      }
    }

    // notes
    const noise = g.source === 'noise';
    driveHint.textContent = !r || !r.on ? '' : noise
      ? 'Random noise has no field: every frame draws fresh noise, so the drive does nothing.'
      : DRIVE_HINTS[g.drive];
    suggest.innerHTML = '';
    if (r?.on && r.motion?.on && !noise){
      if (r.matches) suggest.textContent = r.addsSymmetry
        ? 'The drive already turns with this motion, but the motion also gives the frames more symmetry than the drive has, so it still overrides part of it.'
        : 'The drive already turns with this motion, so the motion only corrects rounding.';
      else if (r.suggestion){
        const { drive, amount } = r.suggestion;
        suggest.append(`The ${drive} drive with Amount ${amount} matches this motion. `,
                       button(`Use ${drive} ${amount}`, () => setGen({ drive, driveAmount: amount })));
      }
    }
    note.className = 'hint';
    note.textContent = '';
    if (g.fold !== 2 && g.frames > 1) note.textContent = 'Animation needs the corrected fold (v2).';
    else if (r && !r.on) note.textContent = `Animation off: ${r.reason}.`;
    else if (r?.motion && !r.motion.on) note.textContent = `Motion off: ${r.motion.reason}.`;
    else if (!r && text) note.textContent = 'Motion off: a still has no motion: set Frames above 1.';
    if (note.textContent) note.classList.add('warn');
    summary.textContent = r?.on
      ? `${r.freeFrames} of ${r.T} frames free · ${fmt(r.orbits)} free cells` +
        (r.motion?.on ? ` (${fmt(r.still)} without the motion)` : '') + '. ▶ above the sheet plays it (P).'
      : g.frames <= 1 ? 'One frame is a still. More frames make an animation.' : '';
  }

  return {
    motion, notes,
    update(g){
      gen = g;
      const k = JSON.stringify([g.frames, g.motion, g.drive, g.driveAmount, g.w, g.h, g.symmetry, g.fold, g.tiers,
                                g.source === 'noise', custom]);
      if (k === key) return;
      key = k;
      const focused = motion.contains(document.activeElement) ? document.activeElement.id : null;
      build();
      if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
    },
  };
}

/** The factorization in `list` nearest to `a`, radix by radix (log ratio). */
function closest(list, a){
  const dist = f => f.reduce((sum, r, i) => sum + Math.abs(Math.log(r / a[i])), 0);
  return list.reduce((best, f) => dist(f) < dist(best) ? f : best);
}

function groupSelect(id, value, onPick){
  const s = el('select');
  s.id = id;
  fill(s, NO_GROUP);
  s.value = value || '';
  s.addEventListener('change', () => onPick(s.value || null));
  return s;
}
function fill(select, options){
  select.innerHTML = '';
  for (const [v, text] of options){ const o = el('option', null, text); o.value = String(v); select.append(o); }
}
function labelled(text, input){
  const line = el('div', 'row');
  const label = el('label', null, text);
  if (input.id) label.htmlFor = input.id;
  line.append(label, input);
  return line;
}

function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(text, onClick, cls, title){
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
