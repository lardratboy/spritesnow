/* PNG export (browser only). Puts a rasterised Image on a canvas and
   downloads it. The pixels are exactly the rasteriser's: no smoothing,
   no overlays. */

/** @param {{width:number, height:number, data:Uint8ClampedArray}} image */
export function imageToCanvas(image, canvas = document.createElement('canvas')){
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}

export function downloadPNG(image, filename){
  imageToCanvas(image).toBlob(blob => {
    const a = document.createElement('a');
    a.download = filename;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}
