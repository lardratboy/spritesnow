/* Frame identity for the timeline pruner. "Hundreds of entries that look
   very similar" is a perceptual problem, so it is answered perceptually:
   an 8×8 average hash of the sheet image (mosprites-ng's frameHash).
   NG hashed its canvas thumbnail, so its hash depended on the browser's
   smoothing. This one box-averages the rasterised sheet directly, so it is
   pure and the same in every browser and in Node.
   An animated sheet (M6b) hashes every frame it holds: its hash is the
   frames' hashes in order, two numbers each (workshop/sheet.js sheetHash). */
import { popcount } from '../core/fields.js';

export const HASH_N = 8;

/** @param {{width:number, height:number, data:Uint8ClampedArray}} image  RGBA;
 *         transparent pixels count as black
 *  @returns {number[]} [lo, hi]: bit (row*8 + col) is set where that block is
 *           brighter than the image's mean */
export function averageHash(image){
  const { width: W, height: H, data } = image, N = HASH_N;
  const y = new Float64Array(N * N);
  const span = (k, size) => {
    const a = Math.min(size - 1, Math.floor(k * size / N));
    return [a, Math.max(a + 1, Math.floor((k + 1) * size / N))];
  };
  let mean = 0;
  for (let by = 0; by < N; by++){
    const [y0, y1] = span(by, H);
    for (let bx = 0; bx < N; bx++){
      const [x0, x1] = span(bx, W);
      let sum = 0;
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++){
        const k = (py * W + px) * 4;
        sum += (0.2126*data[k] + 0.7152*data[k+1] + 0.0722*data[k+2]) * data[k+3] / 255;
      }
      y[by*N + bx] = sum / ((y1 - y0) * (x1 - x0));
      mean += y[by*N + bx];
    }
  }
  mean /= N * N;
  let lo = 0, hi = 0;
  for (let i = 0; i < 32; i++)  if (y[i] > mean) lo |= 1 << i;
  for (let i = 32; i < 64; i++) if (y[i] > mean) hi |= 1 << (i - 32);
  return [lo >>> 0, hi >>> 0];
}

/** How different two hashes are, 0..64: the number of differing bits, or
 *  for animated sheets the most in any one frame, so the pruner's
 *  threshold means the same for stills and animations. Hashes of different
 *  frame counts are as different as can be (64). */
export function hamming(a, b){
  if (a.length !== b.length) return 64;
  let most = 0;
  for (let k = 0; k < a.length; k += 2) most = Math.max(most, popcount(a[k] ^ b[k]) + popcount(a[k+1] ^ b[k+1]));
  return most;
}
