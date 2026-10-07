/* The screen sheet as GPU data (newdesign.md §5.1, M4b). Pure: no DOM and
   no GL, so Node tests can check that what the shader reads draws the same
   pixels as rasterizeSheet at scale 1.
   - index: the R8 atlas, one byte per sprite cell (its grid value, 0 is
     empty). Each sheet cell's sprite has its own slot. All slots are the
     size of the largest sprite, laid out row by row, so a changed sprite
     that still fits its slot is rewritten in place.
   - palette: RGBA8, one row of `pw` colours per sheet cell, packed several
     to a texture row. Entry 0 is never read; entries past a sprite's
     colours are white, as in the rasteriser.
   - instances: 8 ints per sheet cell, drawn in cell order: the sprite's box
     in sheet pixels (x, y, w, h), centred in its cell and rounded down as
     rasterizeSheet does, then where its slot and its palette row start
     (ax, ay, px, py). A locked sprite larger than its cell overlaps its
     neighbours exactly as it does in the CPU raster.
   The shader's rule for one sheet pixel is drawAtlas() below, which the
   tests compare with rasterizeSheet. */
import { hexRgb } from '../core/palette.js';

/* Texture widths. WebGL2 guarantees 2048 at least; the atlas also stays
   under the device's MAX_TEXTURE_SIZE, which callers pass as maxSize. */
export const ATLAS_WIDTH = 4096, PALETTE_WIDTH = 2048;
export const STRIDE = 8;                  // ints per instance

/** @typedef {{cols:number, rows:number, cellW:number, cellH:number, spacing:number}} Layout */

const sameLayout = (a, b) => a.cols === b.cols && a.rows === b.rows && a.cellW === b.cellW &&
                             a.cellH === b.cellH && a.spacing === b.spacing;

/** Pack every sprite. @returns {object|null} null when a texture would
 *  exceed maxSize, and the caller draws the sheet another way. */
export function packAtlas(sprites, layout, maxSize = ATLAS_WIDTH){
  const n = sprites.length;
  let slotW = 1, slotH = 1, colours = 0;
  for (const s of sprites){
    slotW = Math.max(slotW, s.w); slotH = Math.max(slotH, s.h); colours = Math.max(colours, s.colors.length);
  }
  const pw = colours + 1;
  const perRow = Math.max(1, Math.floor(Math.min(ATLAS_WIDTH, maxSize) / slotW));
  const palPerRow = Math.max(1, Math.floor(Math.min(PALETTE_WIDTH, maxSize) / pw));
  const width = Math.min(n, perRow) * slotW, height = Math.ceil(n / perRow) * slotH;
  const palW = Math.min(n, palPerRow) * pw, palH = Math.ceil(n / palPerRow);
  if (!n || width > maxSize || height > maxSize || palW > maxSize || palH > maxSize) return null;
  const atlas = {
    layout: { ...layout }, count: n, slotW, slotH, perRow, pw, palPerRow,
    width, height, index: new Uint8Array(width * height),
    palW, palH, palette: new Uint8Array(palW * palH * 4),
    instances: new Int32Array(n * STRIDE),
    sheetW: layout.cols * (layout.cellW + layout.spacing), sheetH: layout.rows * (layout.cellH + layout.spacing),
    sprites: new Array(n),
  };
  for (let i = 0; i < n; i++) writeCell(atlas, i, sprites[i]);
  return atlas;
}

/** Bring a packed atlas up to date with new sprites, in place.
 *  @returns {number[]|null} the cells rewritten, or null when the atlas
 *    must be packed again: a new layout, or a sprite too big for its slot
 *    or with more colours than a palette row holds. */
export function updateAtlas(atlas, sprites, layout){
  if (sprites.length !== atlas.count || !sameLayout(atlas.layout, layout)) return null;
  const changed = [];
  for (let i = 0; i < sprites.length; i++){
    const s = sprites[i];
    if (s === atlas.sprites[i]) continue;
    if (s.w > atlas.slotW || s.h > atlas.slotH || s.colors.length >= atlas.pw) return null;
    changed.push(i);
  }
  for (const i of changed) writeCell(atlas, i, sprites[i]);
  return changed;
}

/** Where cell i's slot and palette row start. */
export const slotOf = (atlas, i) => ({ ax: (i % atlas.perRow) * atlas.slotW, ay: ((i / atlas.perRow) | 0) * atlas.slotH,
                                       px: (i % atlas.palPerRow) * atlas.pw, py: (i / atlas.palPerRow) | 0 });

function writeCell(atlas, i, s){
  const { layout: L, slotW, slotH, width, index, pw, palW, palette, instances } = atlas;
  const { ax, ay, px, py } = slotOf(atlas, i);
  for (let y = 0; y < slotH; y++){
    const row = (ay + y) * width + ax;
    if (y < s.h){ index.set(s.grid[y], row); index.fill(0, row + s.w, row + slotW); }
    else index.fill(0, row, row + slotW);
  }
  const p = (py * palW + px) * 4;
  palette.fill(255, p, p + pw * 4);
  palette.fill(0, p, p + 4);
  s.colors.forEach((c, k) => palette.set(hexRgb(c), p + (k + 1) * 4));
  const col = i % L.cols, rw = (i / L.cols) | 0;
  instances.set([col * (L.cellW + L.spacing) + Math.floor((L.cellW - s.w) / 2),
                 rw * (L.cellH + L.spacing) + Math.floor((L.cellH - s.h) / 2),
                 s.w, s.h, ax, ay, px, py], i * STRIDE);
  atlas.sprites[i] = s;
}

/** The shader's rule on the CPU: the sheet at scale 1, drawn instance by
 *  instance from the atlas alone. For tests; the screen uses the GPU.
 *  @returns {{width:number, height:number, data:Uint8ClampedArray}} */
export function drawAtlas(atlas){
  const { sheetW: W, sheetH: H, instances, index, width, palette, palW, pw } = atlas;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < atlas.count; i++){
    const [x, y, w, h, ax, ay, px, py] = instances.subarray(i * STRIDE, (i + 1) * STRIDE);
    for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++){
      const sx = x + lx, sy = y + ly;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const v = index[(ay + ly) * width + ax + lx];
      if (!v) continue;
      const k = (sy * W + sx) * 4;
      if (v < pw) data.set(palette.subarray((py * palW + px + v) * 4, (py * palW + px + v) * 4 + 4), k);
      else data.fill(255, k, k + 4);
    }
  }
  return { width: W, height: H, data };
}
