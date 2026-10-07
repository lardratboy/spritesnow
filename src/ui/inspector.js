/* The selected sprite: a large preview, its recipe text, the requested
   group, the EFFECTIVE group (highlighted whenever a non-square grid
   reduces it, newdesign.md D3), and aut(), the number of symmetries the
   finished sprite actually has.
   With tiers (M5c): each tier's shape and resulting groups, and the free
   cells (orbits) once its groups are added to the outer tiers', so each
   tier's share of the repetition can be read off. With tiers on, the
   guaranteed symmetry is the tiered sprite's group, which can be more than
   the Symmetry setting. Tiers or a tier field that are off say why. */
import { groupById, orbitTable } from '../core/groups2d.js';
import { tierFieldState } from '../core/tierfields.js';
import { tierReadout } from '../recipe/tiers.js';
import { imageToCanvas } from '../raster/png.js';

/**
 * @param {HTMLElement} root
 * @param {{ onCopyRecipe:() => void, onExport:() => void, onLock:() => void, onReroll:() => void,
 *           onKeep:() => void }} handlers
 */
export function mountInspector(root, { onCopyRecipe, onExport, onLock, onReroll, onKeep }){
  root.innerHTML = '';
  const title = document.createElement('h1');
  title.textContent = 'Selected sprite';
  const body = document.createElement('div');
  body.style.display = 'contents';
  root.append(title, body);

  return {
    /** @param {null | { index, seed, sprite, gen, paletteSeed, aut, image, locked, differs:string[] }} info */
    show(info){
      body.innerHTML = '';
      if (!info){
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'Click a sprite on the sheet to see its recipe and symmetry.';
        body.append(p);
        return;
      }
      const { sprite, gen } = info;
      const req = groupById(sprite.symmetry), eff = groupById(sprite.effectiveSymmetry);

      const preview = document.createElement('div');
      preview.className = 'preview';
      const cv = imageToCanvas(info.image);
      const k = Math.max(1, Math.floor(224 / Math.max(sprite.w, sprite.h)));
      cv.style.width = `${sprite.w * k}px`; cv.style.height = `${sprite.h * k}px`;
      preview.append(cv);

      const dl = document.createElement('dl');
      const row = (dt, dd, cls) => {
        const a = document.createElement('dt'); a.textContent = dt;
        const b = document.createElement('dd'); b.textContent = dd; if (cls) b.className = cls;
        dl.append(a, b);
      };
      row('Cell', `#${info.index + 1}`);
      if (info.locked)
        row('Locked', info.differs.length ? `keeps its own ${info.differs.join(', ')}` : 'keeps the settings it was locked with',
            'locked');
      row('Seed', info.seed.toString(16).padStart(8, '0'));
      row('Size', `${sprite.w} × ${sprite.h}`);
      row('Symmetry', req.name);
      if (eff.id !== req.id) row('Effective', `${eff.name} (a ${sprite.w}×${sprite.h} grid is not square)`, 'reduced');
      const tiers = tierReadout(gen);
      const sure = tiers?.on ? groupById(tiers.group) : eff;
      if (sure.id !== eff.id) row('With tiers', `${sure.name} (the tiers add symmetry)`);
      const extra = info.aut > sure.order ? ' · more than asked for' : '';
      row('Symmetries', `${info.aut} of ${sprite.w === sprite.h ? 8 : 4} (guaranteed ${sure.order})${extra}`);
      row('Chiral', eff.chiral ? 'yes: has a distinct mirror twin' : 'no');
      row('Fold', gen.fold === 1 ? 'v1: the old app, exact' : 'v2: corrected');
      if (tiers && !tiers.on) row('Tiers', `${tiers.text} (off: ${tiers.reason})`, 'reduced');
      if (tiers?.on){
        row('Tiers', tiers.text);
        const last = tiers.tiers.length - 1;
        tiers.tiers.forEach((t, i) => {
          const what = i === last ? `${t.rx}×${t.ry} cells` : `${t.rx}×${t.ry} blocks of ${t.sx}×${t.sy}`;
          const misfit = ['block', 'copy'].some(k => t[k].asked && t[k].fit !== t[k].asked);
          row(`Tier ${i + 1}`, `${what} · blocks ${groupById(t.block.result).name} · copies ${groupById(t.copy.result).name}` +
              `${misfit ? ' · a group does not fit' : ''} · ${t.orbits} free cells`, misfit ? 'reduced' : '');
        });
      }
      const free = tiers?.on ? tiers.orbits : gen.fold === 2 ? orbitTable(gen.symmetry, sprite.w, sprite.h, 2).orbitCount : null;
      if (free !== null)
        row('Free cells', `${free} of ${sprite.w * sprite.h}` + (tiers?.on ? ` (${tiers.plain} without tiers)` : ''));
      const field = tierFieldState(gen);
      if (field.id !== 'none') row('Tier field', field.on ? field.id : `${field.id} (off: ${field.reason})`, field.on ? '' : 'reduced');
      row('Recipe', sprite.recipeText, 'recipe-text');

      const cells = document.createElement('div');
      cells.className = 'buttons';
      const lock = document.createElement('button'); lock.type = 'button';
      lock.textContent = info.locked ? 'Unlock' : 'Lock';
      lock.className = info.locked ? 'locked' : '';
      lock.setAttribute('aria-pressed', String(info.locked));
      lock.title = info.locked ? 'Let this sprite follow the sheet settings again (L)'
                               : 'Keep this sprite as it is while the settings change (L, or ⌘/Ctrl-click)';
      lock.addEventListener('click', onLock);
      const reroll = document.createElement('button'); reroll.type = 'button'; reroll.textContent = 'Reroll';
      reroll.title = 'A new seed for this sprite only; also unlocks it (Shift+R, or Shift-click)';
      reroll.addEventListener('click', onReroll);
      const keep = document.createElement('button'); keep.type = 'button'; keep.textContent = '+ Keep';
      keep.title = 'Add this sprite to the collection (K, or Alt-click)';
      keep.addEventListener('click', onKeep);
      cells.append(lock, reroll, keep);

      const bar = document.createElement('div');
      bar.className = 'buttons';
      const b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = 'Copy recipe';
      b1.title = 'This one sprite as a spritesnow/1 recipe (JSON)';
      b1.addEventListener('click', onCopyRecipe);
      const b2 = document.createElement('button'); b2.type = 'button'; b2.textContent = '↓ PNG';
      b2.title = 'This sprite alone, at the sheet scale';
      b2.addEventListener('click', onExport);
      bar.append(b1, b2);
      body.append(preview, cells, dl, bar);
    },
  };
}
