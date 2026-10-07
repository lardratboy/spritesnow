/* PNG export (browser only). Puts a rasterised Image on a canvas and
   downloads it. The pixels are exactly the rasteriser's: no smoothing,
   no overlays. downloadBlob also saves session files. */

/** @param {{width:number, height:number, data:Uint8ClampedArray}} image */
export function imageToCanvas(image, canvas = document.createElement('canvas')){
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}

/** Copy only some boxes of `image` to a canvas that already shows it. */
export function updateCanvas(image, canvas, boxes){
  const g = canvas.getContext('2d'), all = new ImageData(image.data, image.width, image.height);
  for (const b of boxes) g.putImageData(all, 0, 0, b.x, b.y, b.w, b.h);
  return canvas;
}

/* Browsers refuse canvases past a size: Chrome and Firefox at 32,767 px a
   side or about 268 million px (16,384²) in all. canvasFits checks before
   any pixels are allocated; a null blob from toBlob is the backstop. */
export const canvasFits = (w, h) => w <= 32767 && h <= 32767 && w * h <= 16384 * 16384;

/** @returns {Promise<boolean>} false when the browser could not encode it */
export function downloadPNG(image, filename){
  return new Promise(resolve => imageToCanvas(image).toBlob(blob => {
    if (blob) downloadBlob(blob, filename);
    resolve(!!blob);
  }, 'image/png'));
}

/** Save any Blob (a PNG, a session file) through the browser's downloads. */
export function downloadBlob(blob, filename){
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
