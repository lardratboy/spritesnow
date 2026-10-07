/* Sidebar controls: edit the recipe. Built from a table, so adding a
   setting means adding one row here (and its spec in recipe/schema.js).
   The symmetry picker lists all 10 SUBGROUPS (newdesign.md D4), and warns
   when a non-square sprite reduces the group (D3). */
import { FIELDS } from '../core/fields.js';
import { MASKS } from '../core/masks.js';
import { SUBGROUPS, groupById, effectiveGroup } from '../core/groups2d.js';

const notNoise = g => g.source !== 'noise';
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
 * @param {{ onChange:(part:string, key:string, value:any) => void,
 *           onAction:(name:string) => void,
 *           onImport:(file:File) => void }} handlers
 * @returns {{ update:(recipe:object) => void }}
 */
export function mountControls(root, { onChange, onAction, onImport }){
  const inputs = [];   // { row, part, el, readout }

  for (const section of SECTIONS){
    const part = section.part || 'gen';
    const box = el('div', 'group');
    box.append(el('div', 'title', section.title));
    for (const row of section.rows){
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
  }

  // actions
  const actions = el('div', 'group');
  actions.append(el('div', 'title', 'Actions'));
  const bar = el('div', 'buttons');
  const file = el('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.className = 'hidden';
  file.addEventListener('change', () => { if (file.files[0]) onImport(file.files[0]); file.value = ''; });
  bar.append(
    button('Regenerate', () => onAction('regenerate'), 'primary', 'New seeds for every unlocked cell (R)'),
    button('Copy link', () => onAction('copy-link'), null, 'The link is the recipe: it rebuilds this exact sheet'),
    button('↓ Sheet PNG', () => onAction('export-sheet'), null, 'Transparent PNG at the sheet scale'),
    button('↑ Old session', () => file.click(), null, 'Load a session saved by the old sprite generator'),
  );
  actions.append(bar, file);
  actions.append(el('div', 'hint', 'Click a sprite to inspect it. Drag to pan, scroll to zoom. R regenerates, F fits. ' +
    '← → step through the timeline, Space replays it, B makes a keyframe. ' +
    'L locks the selected sprite, Shift+R rerolls it (or ⌘/Ctrl-click, Shift-click).'));
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
    },
  };
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
