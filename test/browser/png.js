/* Minimal PNG reader, for sheet-view.test.js (copied from block-showroom):
   enough to turn a DevTools screenshot into pixels without a dependency.
   8-bit truecolour (RGB/RGBA), non-interlaced, which is what Chrome's
   Page.captureScreenshot produces; zlib is built into Node.
   decodeAPNG (M6b) also reads the frames of an animated PNG, so the tests
   can check what raster/png.js encodeAPNG writes. */
import { inflateSync } from 'node:zlib';

function chunks(buf){
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const out = [];
  let off = 8;
  while (off < buf.length){
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    out.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}

function unfilter(raw, width, height, bpp){
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++){
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++){
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter){
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad PNG filter ' + filter);
      }
      cur[x] = v & 0xff;
    }
  }
  return out;
}

function header(list){
  const h = list.find(c => c.type === 'IHDR').data;
  const width = h.readUInt32BE(0), height = h.readUInt32BE(4), depth = h[8], colour = h[9], interlace = h[12];
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6))
    throw new Error(`unsupported PNG: depth=${depth} colour=${colour} interlace=${interlace}`);
  return { width, height, bpp: colour === 6 ? 4 : 3 };
}

export function decodePNG(buf){
  const list = chunks(buf), { width, height, bpp } = header(list);
  const raw = inflateSync(Buffer.concat(list.filter(c => c.type === 'IDAT').map(c => c.data)));
  return { width, height, bpp, data: unfilter(raw, width, height, bpp) };
}

/** Every frame of an APNG, as stored (not composited), checking the
 *  sequence numbers and the chunk CRCs on the way.
 *  @returns {{ width, height, bpp, plays:number, frames:{ x, y, width, height, delay:[number, number],
 *              dispose:number, blend:number, data:Buffer }[] }} */
export function decodeAPNG(buf){
  const list = chunks(buf), { width, height, bpp } = header(list);
  crcCheck(buf);
  const actl = list.find(c => c.type === 'acTL');
  if (!actl) throw new Error('not animated: no acTL');
  const frames = [];
  let seq = 0, cur = null;
  const finish = () => {
    if (!cur) return;
    cur.data = unfilter(inflateSync(Buffer.concat(cur.parts)), cur.width, cur.height, bpp);
    delete cur.parts;
    frames.push(cur);
  };
  for (const c of list){
    if (c.type === 'fcTL'){
      finish();
      const d = c.data;
      if (d.readUInt32BE(0) !== seq++) throw new Error('fcTL out of sequence');
      cur = { width: d.readUInt32BE(4), height: d.readUInt32BE(8), x: d.readUInt32BE(12), y: d.readUInt32BE(16),
              delay: [d.readUInt16BE(20), d.readUInt16BE(22)], dispose: d[24], blend: d[25], parts: [] };
    } else if (c.type === 'IDAT' && cur) cur.parts.push(c.data);
    else if (c.type === 'fdAT'){
      if (c.data.readUInt32BE(0) !== seq++) throw new Error('fdAT out of sequence');
      cur.parts.push(c.data.subarray(4));
    }
  }
  finish();
  if (frames.length !== actl.data.readUInt32BE(0)) throw new Error(`acTL says ${actl.data.readUInt32BE(0)} frames, found ${frames.length}`);
  return { width, height, bpp, plays: actl.data.readUInt32BE(4), frames };
}

function crcCheck(buf){
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let off = 8;
  while (off < buf.length){
    const len = buf.readUInt32BE(off);
    let c = 0xffffffff;
    for (let i = off + 4; i < off + 8 + len; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    if (((c ^ 0xffffffff) >>> 0) !== buf.readUInt32BE(off + 8 + len))
      throw new Error(`bad CRC on ${buf.toString('ascii', off + 4, off + 8)}`);
    off += 12 + len;
  }
}
