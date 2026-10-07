/* The selected sprite: a large preview, its recipe text, the requested
   group, the EFFECTIVE group (highlighted whenever a non-square grid
   reduces it, newdesign.md D3), and aut(), the number of symmetries the
   finished sprite actually has. */
import { groupById } from '../core/groups2d.js';
import { imageToCanvas } from '../raster/png.js';

/**
 * @param {HTMLElement} root
 * @param {{ onCopyRecipe:() => void, onExport:() => void }} handlers
 */
export function mountInspector(root, { onCopyRecipe, onExport }){
  root.innerHTML = '';
  const title = document.createElement('h1');
  title.textContent = 'Selected sprite';
  const body = document.createElement('div');
  body.style.display = 'contents';
  root.append(title, body);

  return {
    /** @param {null | { index, seed, sprite, gen, paletteSeed, aut, image, override }} info */
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
      row('Cell', `#${info.index + 1}${info.override ? ' · own settings (locked in the old app)' : ''}`);
      row('Seed', info.seed.toString(16).padStart(8, '0'));
      row('Size', `${sprite.w} × ${sprite.h}`);
      row('Symmetry', req.name);
      if (eff.id !== req.id) row('Effective', `${eff.name} (a ${sprite.w}×${sprite.h} grid is not square)`, 'reduced');
      const extra = info.aut > eff.order ? ' · more than asked for' : '';
      row('Symmetries', `${info.aut} of ${sprite.w === sprite.h ? 8 : 4} (guaranteed ${eff.order})${extra}`);
      row('Chiral', eff.chiral ? 'yes: has a distinct mirror twin' : 'no');
      row('Fold', gen.fold === 1 ? 'v1: the old app, exact' : 'v2: corrected');
      row('Recipe', sprite.recipeText, 'recipe-text');

      const bar = document.createElement('div');
      bar.className = 'buttons';
      const b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = 'Copy recipe';
      b1.title = 'This one sprite as a spritesnow/1 recipe (JSON)';
      b1.addEventListener('click', onCopyRecipe);
      const b2 = document.createElement('button'); b2.type = 'button'; b2.textContent = '↓ PNG';
      b2.title = 'This sprite alone, at the sheet scale';
      b2.addEventListener('click', onExport);
      bar.append(b1, b2);
      body.append(preview, dl, bar);
    },
  };
}
