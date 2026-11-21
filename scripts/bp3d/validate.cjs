'use strict';
// node validate.cjs [manifest] [publicDir]: checks offsets, alignment, index ranges, weights
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const mp = process.argv[2] || path.join(ROOT, 'src/data/bp3d_manifest.json');
const base = process.argv[3] || path.join(ROOT, 'public');
const M = JSON.parse(fs.readFileSync(mp, 'utf8'));
const bufs = {};
for (const [k, c] of Object.entries(M.chunks)) { bufs[k] = fs.readFileSync(path.join(base, c.file)); if (bufs[k].length !== c.bytes) throw new Error('chunk size ' + k); }
const SZ = { f32: 4, u8: 1, u8n: 1, i8n: 1, u16: 2, u32: 4 };
let err = 0, tris = 0; const bad = (m) => { if (err++ < 20) console.error('BAD', m); };
const ids = new Set(), groups = new Set(M.groups.map((g) => g.id));
for (const p of M.parts) {
  if (ids.has(p.id)) bad('dup ' + p.id); ids.add(p.id);
  const b = bufs[p.chunk], n = p.vertexCount;
  const chk = (a, count, name) => { if (a.off % 4) bad(p.id + ' align ' + name); if (a.off + count * SZ[a.type] > b.length) bad(p.id + ' range ' + name); };
  chk(p.index, p.index.count, 'index');
  const I = p.index.type === 'u16' ? new Uint16Array(b.buffer, b.byteOffset + p.index.off, p.index.count) : new Uint32Array(b.buffer, b.byteOffset + p.index.off, p.index.count);
  let mx = 0; for (let i = 0; i < I.length; i++) if (I[i] > mx) mx = I[i];
  if (mx >= n || I.length % 3) bad(p.id + ' index>=vc');
  tris += I.length / 3;
  for (const [k, a] of Object.entries(p.attrs)) chk(a, n * (a.stride || a.size), k);
  const sw = p.attrs.skinWeight, si = p.attrs.skinIndex;
  for (let v = 0; v < n; v += 7) { let s = 0; for (let j = 0; j < 4; j++) s += b[sw.off + v * 4 + j]; if (s !== 255) { bad(p.id + ' weights sum ' + s); break; } }
  const pos = new Float32Array(b.buffer.slice(b.byteOffset + p.attrs.position.off, b.byteOffset + p.attrs.position.off + n * 12));
  for (let i = 0; i < pos.length; i++) if (!isFinite(pos[i])) { bad(p.id + ' NaN'); break; }
  if (!groups.has(p.parent) && !/^[a-z]+$/.test(p.parent)) bad(p.id + ' parent ' + p.parent);
}
console.log(`validate: parts=${M.parts.length} tris=${tris} errors=${err}`);
process.exit(err ? 1 : 0);
