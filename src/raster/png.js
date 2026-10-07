/* PNG export. Puts a rasterised Image on a canvas and downloads it. The
   pixels are exactly the rasteriser's: no smoothing, no overlays.
   downloadBlob also saves session files.
   Animated export (M6b): encodeAPNG writes an APNG itself (a canvas can
   only make stills): the acTL, fcTL and fdAT chunks of the APNG spec, RGBA
   frames compressed with the platform's zlib (CompressionStream), so it
   runs in Node too and the tests decode what it writes. Every browser
   plays APNG; a viewer that does not shows frame 0. */

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

/* ------------------------------------------------------------------- APNG */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** One chunk: length, type, data, CRC of type and data. */
function chunk(type, data){
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const u32s = (...values) => {
  const out = new Uint8Array(values.length * 4), view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
};
async function zlib(bytes){
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/* Scanlines: a row equal to the one above uses the Up filter (all zeros),
   others none. Integer-scale sprites repeat each row scale times. */
function scanlines({ width: W, height: H, data }){
  const stride = W * 4, out = new Uint8Array(H * (stride + 1));
  for (let y = 0; y < H; y++){
    const row = data.subarray(y * stride, (y + 1) * stride), o = y * (stride + 1);
    let same = y > 0;
    if (same) for (let x = 0; x < stride; x++) if (row[x] !== data[(y - 1) * stride + x]){ same = false; break; }
    out[o] = same ? 2 : 0;
    if (!same) out.set(row, o + 1);
  }
  return out;
}

/** The most raw RGBA bytes one animated export may hold, all frames
 *  together; a larger one is refused before anything is drawn. */
export const APNG_LIMIT = 512 * 1024 * 1024;

/** An animated PNG, looping forever, with every frame the full image.
 *  Each frame replaces the last (blend SOURCE, dispose NONE), transparent
 *  pixels included. With count 1 it is a plain PNG (no acTL or fcTL).
 *  @param {{ width:number, height:number, count:number, fps:number,
 *            frame:(t:number) => {width, height, data} }} opts
 *         frame(t) is asked for each frame in turn, so only one is held
 *  @returns {Promise<Uint8Array>} the file's bytes */
export async function encodeAPNG({ width, height, count, fps, frame }){
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)];
  const ihdr = new Uint8Array(13);
  ihdr.set(u32s(width, height));
  ihdr.set([8, 6, 0, 0, 0], 8);                      // 8-bit RGBA, not interlaced
  parts.push(chunk('IHDR', ihdr));
  const animated = count > 1;
  if (animated) parts.push(chunk('acTL', u32s(count, 0)));
  let seq = 0;
  for (let t = 0; t < count; t++){
    const image = frame(t);
    if (image.width !== width || image.height !== height) throw new Error(`frame ${t} is ${image.width}×${image.height}`);
    if (animated){
      const fc = new Uint8Array(26), view = new DataView(fc.buffer);
      view.setUint32(0, seq++); view.setUint32(4, width); view.setUint32(8, height);
      view.setUint32(12, 0); view.setUint32(16, 0);   // x, y offset
      view.setUint16(20, 1); view.setUint16(22, fps); // delay 1/fps s
      fc[24] = 0; fc[25] = 0;                         // dispose NONE, blend SOURCE
      parts.push(chunk('fcTL', fc));
    }
    const z = await zlib(scanlines(image));
    if (t === 0) parts.push(chunk('IDAT', z));
    else {
      const fd = new Uint8Array(4 + z.length);
      fd.set(u32s(seq++)); fd.set(z, 4);
      parts.push(chunk('fdAT', fd));
    }
  }
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts){ out.set(p, o); o += p.length; }
  return out;
}

/** Encode and download an animation. @returns {Promise<boolean>} */
export async function downloadAPNG(opts, filename){
  try { downloadBlob(new Blob([await encodeAPNG(opts)], { type: 'image/apng' }), filename); return true; }
  catch (err){ console.warn('spritesnow: APNG export failed:', err); return false; }
}
