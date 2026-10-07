/* The 11 shape masks. Pure.
   Ported from reference `MASKS` and the CA "blob" mask inside
   `generateSprite`. As with FIELDS, the order is part of every recipe.
   Note for the symmetry engine: shape masks are evaluated per cell, so they
   move to orbits cleanly. The blob mask and the noise+CA source look at
   neighbours in the seed region, so fold:2 keeps the seed region as the
   evaluation area (docs/from3Dto2D.md §6 P1, caveat). */

/** @type {{id:string, name:string, m:((nx:number, ny:number, r:number) => boolean) | null}[]} */
export const MASKS = [
  {id:'none',    name:'None',              m:(nx,ny,r)=> true},
  {id:'disc',    name:'Disc',              m:(nx,ny,r)=> nx*nx+ny*ny <= r*r},
  {id:'diamond', name:'Diamond',           m:(nx,ny,r)=> Math.abs(nx)+Math.abs(ny) <= r*1.25},
  {id:'square',  name:'Square',            m:(nx,ny,r)=> Math.max(Math.abs(nx),Math.abs(ny)) <= r*0.95},
  {id:'super',   name:'Superellipse',      m:(nx,ny,r)=> Math.pow(Math.abs(nx),4)+Math.pow(Math.abs(ny),4) <= Math.pow(r,4)},
  {id:'ring',    name:'Ring',              m:(nx,ny,r)=>{const d=Math.hypot(nx,ny); return d<=r && d>=r*0.5;}},
  {id:'cross',   name:'Cross',             m:(nx,ny,r)=> (Math.abs(nx)<=r*0.34 || Math.abs(ny)<=r*0.34) && Math.max(Math.abs(nx),Math.abs(ny))<=r},
  {id:'taper',   name:'Taper (tree)',      m:(nx,ny,r)=> Math.abs(nx) <= r*(0.18+0.82*(ny+1)/2)},
  {id:'hourglass',name:'Hourglass',        m:(nx,ny,r)=> Math.abs(nx) <= r*(0.16+0.9*Math.abs(ny))},
  {id:'lens',    name:'Lens (vesica)',     m:(nx,ny,r)=> Math.abs(ny) <= r*Math.sqrt(Math.max(0,1-nx*nx))*0.9},
  {id:'blob',    name:'Random blob (CA)',  m:null},
];
export const MASK_BY_ID = Object.fromEntries(MASKS.map(m=>[m.id,m]));

/** CA-smoothed random blob over the sw x sh seed region: one draw per cell
 *  in row-major order, then two smoothing passes. Consumes exactly sw*sh
 *  values from rnd, as the reference does.
 *  @returns {Uint8Array[]} sh rows of sw cells, 1 = inside */
export function blobMask(rnd, sw, sh){
  let blob = Array.from({length:sh},()=>new Uint8Array(sw));
  for(let y=0;y<sh;y++) for(let x=0;x<sw;x++) blob[y][x] = rnd()<0.58 ? 1:0;
  for(let pass=0; pass<2; pass++){
    const nb = Array.from({length:sh},()=>new Uint8Array(sw));
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){
      let n=0;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy) continue;
        const ax=x+dx, ay=y+dy;
        if(ax>=0&&ax<sw&&ay>=0&&ay<sh) n+=blob[ay][ax];
      }
      nb[y][x] = blob[y][x] ? (n>=2?1:0) : (n>=5?1:0);
    }
    blob = nb;
  }
  return blob;
}
