/* Integer-scale rasteriser. Pure: it fills an RGBA byte buffer and never
   touches a canvas, so Node tests can check it pixel by pixel.
   v1 is integer scale only: every pixel is a palette colour (or the matte),
   there are no seams, and the output is exact. Fractional scale (the
   seam-colour kernel from mosprites-ng) is deferred (newdesign.md §3).
   Overlays (selection, locks) are never drawn here. */
import { hexRgb } from '../core/palette.js';

/** @typedef {{ width:number, height:number, data:Uint8ClampedArray }} Image */

/** Pixel size of a sheet. Lets a caller refuse a sheet too big to
 *  allocate before rasterising it.
 *  @param {{cols:number, rows:number, cellW:number, cellH:number, spacing:number}} layout
 *  @returns {{width:number, height:number}} */
export function sheetSize(layout, scale){
  return { width: Math.max(1, layout.cols * (layout.cellW + layout.spacing) * scale),
           height: Math.max(1, layout.rows * (layout.cellH + layout.spacing) * scale) };
}

/** Lay sprites out on a grid of equal cells, as the old app's rasterize()
 *  did: each sprite is centred in its cell, rounded down to whole cells.
 *  @param {{sprite:object, col:number, row:number}[]} items
 *  @param {{cols:number, rows:number, cellW:number, cellH:number, spacing:number}} layout
 *  @param {{scale:number, matte?:string|null}} policy  scale must be a whole number >= 1
 *  @returns {Image} */
export function rasterizeSheet(items, layout, policy){
  const p = policy.scale;
  if (!Number.isInteger(p) || p < 1) throw new Error(`integer scale only in v1, got ${p}`);
  const { width: W, height: H } = sheetSize(layout, p);
  const image = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  if (policy.matte){
    const [r, g, b] = hexRgb(policy.matte), data = image.data;
    for (let k = 0; k < W * H; k++){ data[k*4] = r; data[k*4+1] = g; data[k*4+2] = b; data[k*4+3] = 255; }
  }
  for (const it of items) paintSprite(image, it, layout, p);
  return image;
}

/** Redraw some cells of a transparent sheet that rasterizeSheet made with
 *  the same layout and scale: each cell's box is cleared, then its sprite
 *  is drawn. Only for sprites that fit their cell, so no cell overlaps a
 *  neighbour (a locked sprite larger than the sheet's cells does).
 *  @returns {{x:number, y:number, w:number, h:number}[]} the changed boxes */
export function redrawCells(image, items, layout, policy){
  const p = policy.scale, { width: W, data } = image;
  const outerW = (layout.cellW + layout.spacing) * p, outerH = (layout.cellH + layout.spacing) * p;
  const w = layout.cellW * p, h = layout.cellH * p;
  return items.map(it => {
    if (it.sprite.w > layout.cellW || it.sprite.h > layout.cellH) throw new Error('sprite larger than its cell');
    const x = it.col * outerW, y = it.row * outerH;
    for (let py = y; py < y + h; py++) data.fill(0, (py*W + x) * 4, (py*W + x + w) * 4);
    paintSprite(image, it, layout, p);
    return { x, y, w, h };
  });
}

function paintSprite({ width: W, height: H, data }, { sprite: s, col, row }, layout, p){
  const outerW = (layout.cellW + layout.spacing) * p, outerH = (layout.cellH + layout.spacing) * p;
  const rgb = s.colors.map(hexRgb);
  const X = col*outerW + Math.floor((layout.cellW - s.w)/2)*p;
  const Y = row*outerH + Math.floor((layout.cellH - s.h)/2)*p;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++){
    const v = s.grid[y][x];
    if (!v) continue;
    const [r, g, b] = rgb[v-1] || [255, 255, 255];
    for (let dy = 0; dy < p; dy++){
      const py = Y + y*p + dy;
      if (py < 0 || py >= H) continue;
      for (let dx = 0; dx < p; dx++){
        const px = X + x*p + dx;
        if (px < 0 || px >= W) continue;
        const k = (py*W + px) * 4;
        data[k] = r; data[k+1] = g; data[k+2] = b; data[k+3] = 255;
      }
    }
  }
}

/** One sprite, no spacing. @returns {Image} */
export function rasterizeSolo(sprite, policy){
  return rasterizeSheet([{ sprite, col: 0, row: 0 }],
    { cols: 1, rows: 1, cellW: sprite.w, cellH: sprite.h, spacing: 0 }, policy);
}

/** Several sprites of any sizes on one sheet, `cols` across, filled row by
 *  row. Cells are sized to the largest sprite so mixed sizes still align to
 *  a regular grid (the old app's collection export).
 *  @param {object[]} sprites
 *  @param {{cols:number, spacing:number}} layout
 *  @returns {Image} */
export function rasterizePacked(sprites, { cols, spacing }, policy){
  if (!sprites.length) throw new Error('nothing to pack');
  return rasterizeSheet(sprites.map((sprite, i) => ({ sprite, col: i % cols, row: (i / cols) | 0 })),
    packedLayout(sprites, { cols, spacing }), policy);
}
export function packedLayout(sprites, { cols, spacing }){
  return { cols, rows: Math.ceil(sprites.length / cols), spacing,
           cellW: Math.max(...sprites.map(s => s.w)), cellH: Math.max(...sprites.map(s => s.h)) };
}
