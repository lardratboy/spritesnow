/* The screen sheet in WebGL2 (newdesign.md §5.1, M4b). The GPU holds the
   compact data from raster/atlas.js: the R8 index atlas, the palette rows
   and one instanced quad per sprite. Pan, zoom and scale are uniforms, so
   moving the view uploads nothing; only changed sprites are re-uploaded.
   Screen only: exports and Node tests use the CPU raster, which is exact.

   The fragment shader finds the sheet pixel under each screen pixel the way
   a 2D canvas does with smoothing off, floor((pixel centre - offset) / zoom),
   so at a whole-number zoom the two show the same pixels. The view's origin
   is split into a whole sheet pixel (u_origin, an int) and a remainder of
   under one sheet pixel (u_offset), so the float maths stays small even when
   zoomed far into a big sheet.

   Animation (M6b): each cell holds a slot per frame, and the u_frame
   uniform is the time. The vertex shader picks each sprite's slot for it
   (raster/atlas.js), so playing a frame uploads nothing. */
import { packAtlas, updateAtlas, slotOf, STRIDE } from '../raster/atlas.js';

const VS = `#version 300 es
layout(location = 0) in ivec4 a_box;     // sprite box in sheet px: x, y, w, h
layout(location = 1) in ivec4 a_src;     // first frame's slot, palette row origin (x, y), unused
layout(location = 2) in ivec4 a_time;    // frames in the loop T, stride, unused
uniform vec2 u_canvas, u_offset;
uniform ivec2 u_origin, u_slot;          // u_slot: one slot's size
uniform float u_zoom;
uniform int u_frame, u_perRow;
flat out ivec4 v_box, v_src;
void main(){
  int k = a_src.x + (u_frame % max(a_time.x, 1)) / max(a_time.y, 1);
  v_src = ivec4(ivec2(k % u_perRow, k / u_perRow) * u_slot, a_src.yz);
  vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  // one device px larger on every side; the fragment shader decides coverage
  vec2 p = u_offset + (vec2(a_box.xy - u_origin) + c * vec2(a_box.zw)) * u_zoom + (c * 2.0 - 1.0);
  gl_Position = vec4(p.x / u_canvas.x * 2.0 - 1.0, 1.0 - p.y / u_canvas.y * 2.0, 0.0, 1.0);
  v_box = a_box;
}`;

const FS = `#version 300 es
precision highp float; precision highp int;
uniform highp usampler2D u_atlas;
uniform highp sampler2D u_palette;
uniform vec2 u_canvas, u_offset;
uniform ivec2 u_origin, u_sheet;
uniform float u_zoom;
uniform int u_pw;
flat in ivec4 v_box, v_src;
out vec4 color;
void main(){
  vec2 px = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y);     // from the top left, as in 2D
  ivec2 s = u_origin + ivec2(floor((px - u_offset) / u_zoom));
  ivec2 l = s - v_box.xy;
  if (any(lessThan(s, ivec2(0))) || any(greaterThanEqual(s, u_sheet)) ||
      any(lessThan(l, ivec2(0))) || any(greaterThanEqual(l, v_box.zw))) discard;
  int v = int(texelFetch(u_atlas, v_src.xy + l, 0).r);
  if (v == 0) discard;
  color = v < u_pw ? texelFetch(u_palette, ivec2(v_src.z + v, v_src.w), 0) : vec4(1.0);
}`;

function compile(gl, type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

/** @param {HTMLCanvasElement} canvas
 *  @returns {object|null} null when WebGL2 or the shaders are unavailable */
export function createGLSheet(canvas){
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) return null;
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err){
    console.warn('spritesnow: WebGL2 sheet unavailable, using the 2D path:', err.message);
    return null;
  }
  const U = name => gl.getUniformLocation(prog, name);
  const u = { canvas: U('u_canvas'), offset: U('u_offset'), origin: U('u_origin'), zoom: U('u_zoom'),
              sheet: U('u_sheet'), pw: U('u_pw'), atlas: U('u_atlas'), palette: U('u_palette'),
              frame: U('u_frame'), perRow: U('u_perRow'), slot: U('u_slot') };
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  const vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const loc of [0, 1, 2]){
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribIPointer(loc, 4, gl.INT, STRIDE * 4, loc * 16);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  const texture = unit => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return t;
  };
  const atlasTex = texture(0), paletteTex = texture(1);
  gl.useProgram(prog);
  gl.uniform1i(u.atlas, 0); gl.uniform1i(u.palette, 1);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  let atlas = null, frame = 0;
  /* full: whole textures uploaded; cells: sprites re-uploaded alone; draws */
  const stats = { full: 0, cells: 0, draws: 0 };

  function uploadAll(){
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, atlas.width, atlas.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, atlas.index);
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlas.palW, atlas.palH, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.palette);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, atlas.instances, gl.DYNAMIC_DRAW);
    stats.full++;
  }
  /* Upload one box of a CPU array that is rowLength texels wide. */
  function subUpload(unit, rowLength, x, y, w, h, format, data){
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLength);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, format, gl.UNSIGNED_BYTE, data);
  }
  function uploadCells(cells){
    for (const i of cells){
      for (let j = 0; j < atlas.frames; j++){
        const { ax, ay } = slotOf(atlas, i, j);
        subUpload(0, atlas.width, ax, ay, atlas.slotW, atlas.slotH, gl.RED_INTEGER, atlas.index);
      }
      const { px, py } = slotOf(atlas, i);
      subUpload(1, atlas.palW, px, py, atlas.pw, 1, gl.RGBA, atlas.palette);
    }
    for (const p of [gl.UNPACK_ROW_LENGTH, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS]) gl.pixelStorei(p, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, atlas.instances);
    stats.cells += cells.length;
  }

  return {
    stats,
    /** Show these sprites. @returns {boolean} false when the sheet is too
     *  big for this GPU's textures, and the caller must draw it another way */
    setSheet(sprites, layout){
      const cells = atlas && updateAtlas(atlas, sprites, layout);
      if (cells){
        // past a quarter of the sheet, one upload beats many small ones
        if (cells.length > atlas.count / 4) uploadAll(); else if (cells.length) uploadCells(cells);
        return true;
      }
      atlas = packAtlas(sprites, layout, maxSize);
      if (!atlas) return false;
      uploadAll();
      return true;
    },
    resize(w, h){ canvas.width = w; canvas.height = h; },
    /** The time drawn next (a whole number of frames, from 0). */
    setFrame(t){ frame = Math.max(0, t | 0); },
    /** @param {{x:number, y:number, zoom:number}} v  device px: the sheet's
     *  top left on the canvas, and device px per sheet px */
    draw(v){
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!atlas || !v) return;
      const ox = Math.floor(-v.x / v.zoom), oy = Math.floor(-v.y / v.zoom);
      gl.useProgram(prog);
      gl.uniform2f(u.canvas, canvas.width, canvas.height);
      gl.uniform2f(u.offset, v.x + ox * v.zoom, v.y + oy * v.zoom);
      gl.uniform2i(u.origin, ox, oy);
      gl.uniform1f(u.zoom, v.zoom);
      gl.uniform2i(u.sheet, atlas.sheetW, atlas.sheetH);
      gl.uniform1i(u.pw, atlas.pw);
      gl.uniform1i(u.frame, frame);
      gl.uniform1i(u.perRow, atlas.perRow);
      gl.uniform2i(u.slot, atlas.slotW, atlas.slotH);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, atlas.count);
      gl.bindVertexArray(null);
      stats.draws++;
    },
  };
}
