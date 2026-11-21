import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as fs from 'fs';
import { defineAll } from '../src/anatomy';
import { warpGeo } from '../src/geo/warp';
const man = JSON.parse(fs.readFileSync('src/data/bp3d_manifest.json', 'utf8'));
const bins: Record<string, Buffer> = {};
const posL: number[] = [], idxL: number[] = [];
let base = 0;
const want = (id: string) => /rib|vertebra|sternum|scapula|clavicle|hip_bone|sacrum|coccyx|costal/.test(id);
for (const p of man.parts) {
  if (p.system !== 'skeletal' || p.tissue !== 'bone' || !want(p.id)) continue;
  const b = (bins[p.chunk] ??= fs.readFileSync('public/' + man.chunks[p.chunk].file));
  const pa = p.attrs.position; const n = p.vertexCount;
  const pos = new Float32Array(b.buffer.slice(b.byteOffset + pa.off, b.byteOffset + pa.off + n * 12));
  for (let i = 0; i < n; i++) posL.push(pos[i * 3] + p.center[0], pos[i * 3 + 1] + p.center[1], pos[i * 3 + 2] + p.center[2]);
  const ix = p.index; const arr = ix.type === 'u16' ? new Uint16Array(b.buffer.slice(b.byteOffset + ix.off, b.byteOffset + ix.off + ix.count * 2)) : new Uint32Array(b.buffer.slice(b.byteOffset + ix.off, b.byteOffset + ix.off + ix.count * 4));
  for (const k of arr) idxL.push(k + base);
  base += n;
}
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.Float32BufferAttribute(posL, 3)); g.setIndex(idxL);
const bvh = new MeshBVH(g);
console.log('bone verts', base);
const mesh = new THREE.Mesh(g);
const { parts } = defineAll();
const H: Record<string, string[]> = {};
const dirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0.1, 0.2).normalize(), new THREE.Vector3(0.1, 0.2, 1).normalize()];
const pt = new THREE.Vector3(), ray = new THREE.Ray(), tmp: any = { target: { point: new THREE.Vector3(), distance: 0, faceIndex: 0 } };
for (const p of parts) {
  if (!/^(resp\.lung\.|dig\.liver\.|nerv\.spinalcord|nerv\.spinal_roots|nerv\.intercostal|nerv\.sympathetic)/.test(p.id) && !p.id.startsWith('heart.valve')) continue;
  const gg = p.build(); warpGeo(gg.pos, gg.nor, gg.idx);
  const acc = new THREE.Vector3(), dsum = new THREE.Vector3(); let bad = 0, maxd = 0, n = gg.pos.length / 3; const step = Math.max(1, Math.floor(n / 4000));
  for (let i = 0; i < n; i += step) {
    pt.set(gg.pos[i * 3], gg.pos[i * 3 + 1], gg.pos[i * 3 + 2]);
    let inside = 0;
    for (const d of dirs) { ray.origin.copy(pt); ray.direction.copy(d); const hits = bvh.raycast(ray, THREE.DoubleSide); inside += hits.length % 2; }
    if (inside >= 2) { bad++; const r = bvh.closestPointToPoint(pt); if (r && r.distance > maxd) maxd = r.distance; if (p.id === "nerv.spinalcord" || p.id === "dig.liver.left") { const k = p.id[0] + Math.round(pt.y * 50) / 50; (H[k] ??= []).push(pt.z.toFixed(3) + "/" + (r ? (r.distance * 1000).toFixed(0) : "")); } if (r) { acc.add(pt); dsum.add(r.point.clone().sub(pt)); } }
  }
  { const b = new THREE.Box3().setFromArray(Array.from(gg.pos)); if (p.id.startsWith("dig.liver")) console.log(p.id, "bbox", b.min.toArray().map((v) => v.toFixed(3)).join(","), b.max.toArray().map((v) => v.toFixed(3)).join(",")); }
  if (p.id.startsWith("heart.valve") || p.id.startsWith("heart.chordae")) { const b = new THREE.Box3().setFromArray(Array.from(gg.pos)); console.log(p.id, b.min.toArray().map((v) => v.toFixed(3)).join(","), b.max.toArray().map((v) => v.toFixed(3)).join(",")); }
  if (bad) console.log(p.id, "at", acc.clone().divideScalar(bad).toArray().map((v) => v.toFixed(3)).join(","), "push", dsum.clone().divideScalar(bad).multiplyScalar(1000).toArray().map((v) => v.toFixed(1)).join(","), "inside", bad, 'maxdepth_mm', (maxd * 1000).toFixed(1));
}
for (const k of Object.keys(H).sort()) console.log(k, H[k].length, H[k].slice(0, 3).join(" "));
