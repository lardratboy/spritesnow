/* The collection panel (the old apps' #collection): one row per kept
   sprite, with a thumbnail, an editable name, where it came from, and
   restore / copy / export / remove. Drag a row to reorder it, or press
   Alt+↑/↓ in its name. It only displays the list and reports actions;
   main.js changes it through the pure functions in workshop/collection.js. */
import { imageToCanvas } from '../raster/png.js';
import { rasterizeSolo } from '../raster/rasterize.js';

const THUMB = 46;

/**
 * @param {HTMLElement} root
 * @param {{ spriteFor:(item) => object,
 *           onRestore:(id) => void, onCopy:(id) => void, onExport:(id) => void, onRemove:(id) => void,
 *           onRename:(id, name:string) => void, onMove:(from:number, to:number) => void,
 *           onExportSheet:() => void }} h
 */
export function mountCollectionView(root, h){
  root.innerHTML = '';
  const head = el('div', 'col-head');
  const title = el('h1', null, 'Collection');
  const count = el('span', 'count');
  title.append(' ', count);
  const sheet = button('↓ Sheet', 'Export the whole collection as one packed sprite sheet, at the sheet scale', h.onExportSheet);
  head.append(title, sheet);
  const list = el('ol', 'col-list');
  root.append(head, list);

  // Kept sprites never change, so each thumbnail is drawn once.
  const cache = new Map();
  const look = item => {
    const key = `${item.id}:${item.seed}:${item.paletteSeed}:${JSON.stringify(item.gen)}`;
    let v = cache.get(key);
    if (!v){
      const s = h.spriteFor(item);
      v = { canvas: imageToCanvas(rasterizeSolo(s, { scale: 1 })), w: s.w, h: s.h, text: s.recipeText };
      cache.set(key, v);
    }
    return v;
  };

  let items = [], dragIdx = null;
  const clearMarks = () => { for (const r of list.children) r.classList.remove('dragging', 'drop-before', 'drop-after'); };
  const slot = (row, e) => {
    const b = row.getBoundingClientRect();
    return Number(row.dataset.idx) + (e.clientY < b.top + b.height / 2 ? 0 : 1);
  };
  list.addEventListener('dragstart', e => {
    const row = e.target.closest('.item');
    if (!row) return;
    dragIdx = Number(row.dataset.idx);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch {}
  });
  list.addEventListener('dragover', e => {
    const row = e.target.closest('.item');
    if (!row || dragIdx === null) return;
    e.preventDefault();
    for (const r of list.children) r.classList.remove('drop-before', 'drop-after');
    row.classList.add(slot(row, e) === Number(row.dataset.idx) ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('drop', e => {
    const row = e.target.closest('.item');
    if (!row || dragIdx === null) return;
    e.preventDefault();
    const from = dragIdx;
    dragIdx = null;
    clearMarks();
    h.onMove(from, slot(row, e));
  });
  list.addEventListener('dragend', () => { dragIdx = null; clearMarks(); });

  function row(item, idx){
    const v = look(item);
    const li = el('li', 'item');
    li.draggable = true;
    li.dataset.idx = idx;
    li.dataset.id = item.id;

    const thumb = el('div', 'thumb');
    const fit = THUMB / Math.max(v.w, v.h), k = fit >= 1 ? Math.floor(fit) : fit;
    v.canvas.style.width = `${v.w * k}px`; v.canvas.style.height = `${v.h * k}px`;
    thumb.title = v.text;
    thumb.append(v.canvas);   // each item is in the list once, so its canvas can move between renders

    const body = el('div', 'body');
    const name = el('input', 'name');
    name.type = 'text'; name.value = item.name; name.title = 'Rename (Alt+↑/↓ moves it)';
    name.setAttribute('aria-label', 'Name');
    name.draggable = false;
    name.addEventListener('change', () => h.onRename(item.id, name.value.trim() || item.name));
    name.addEventListener('keydown', e => {
      if (e.key === 'Enter') name.blur();
      else if (e.key === 'Escape'){ name.value = item.name; name.blur(); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
        e.preventDefault();
        const to = e.key === 'ArrowUp' ? idx - 1 : idx + 2;
        if (to < 0 || to > items.length) return;
        h.onMove(idx, to);
        const moved = list.querySelector(`.item[data-id="${item.id}"] .name`);
        if (moved) moved.focus();
      }
    });
    const meta = el('div', 'meta', `${v.w}×${v.h} · #${item.entry} · ${item.seed.toString(16).padStart(8, '0')}`);
    meta.title = `Kept from cell [${item.cell.join(',')}] of timeline entry #${item.entry}; seed ${item.seed}`;
    const acts = el('div', 'acts');
    acts.append(
      button('⟲', 'Restore: use this sprite\'s settings, and put it in the first cell', () => h.onRestore(item.id)),
      button('⧉', 'Copy this sprite\'s recipe (JSON)', () => h.onCopy(item.id)),
      button('↓', 'Export this sprite as PNG, at the sheet scale', () => h.onExport(item.id)),
      button('✕', 'Remove from the collection', () => h.onRemove(item.id), 'del'),
    );
    body.append(name, meta, acts);
    li.append(thumb, body);
    return li;
  }

  return {
    /** Show the list. @param {number} [reveal]  an item id to scroll into view */
    render(next, reveal){
      items = next;
      count.textContent = String(items.length);
      sheet.disabled = !items.length;
      list.textContent = '';
      if (!items.length){
        list.append(el('li', 'col-empty hint', 'Nothing kept yet. Select a sprite and press K, Alt-click it, or click "+ Keep".'));
        return;
      }
      items.forEach((it, i) => list.append(row(it, i)));
      const live = new Set(items.map(i => `${i.id}:`));
      for (const key of cache.keys()) if (!live.has(key.slice(0, key.indexOf(':') + 1))) cache.delete(key);
      if (reveal !== undefined){
        const r = list.querySelector(`.item[data-id="${reveal}"]`);
        if (r){ r.scrollIntoView({ block: 'nearest' }); r.classList.add('new'); }
      }
    },
  };
}

function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(text, title, onClick, cls){
  const b = el('button', cls, text);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
