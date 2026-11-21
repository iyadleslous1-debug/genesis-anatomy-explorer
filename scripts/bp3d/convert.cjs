'use strict';
// BP3D OBJ -> app-space indexed, decimated, skinned chunks + manifest.
// usage: node scripts/bp3d/convert.cjs [--limit N] [--only regex] [--out dir] [--manifest path]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.resolve(__dirname, '..', '..');
const OBJ_DIR = path.join(ROOT, 'data/bp3d/obj/isa_BP3D_4.0_obj_99');
const PART_TRI_CAP = 12000;
const CREDIT = 'BodyParts3D, © The Database Center for Life Science, CC BY 4.0';
const SOFT_TISSUE = new Set(['skin', 'fat', 'muscle', 'tendon', 'artery', 'vein', 'nerve', 'cord', 'esophagus', 'ligament', 'lymph', 'node', 'mucosa', 'cartilage']);
const TRUNK_BONE = { lung: 'spine_T7', liver: 'spine_T7', spleen: 'spine_T7', myocardium: 'spine_T7', atrium: 'spine_T7', valve: 'spine_T7', coronary: 'spine_T7', gallbladder: 'spine_T7', diaphragm: 'spine_T12', stomach: 'spine_L3', intestine: 'spine_L3', colon: 'spine_L3', pancreas: 'spine_L3', kidney: 'spine_L3', medulla: 'spine_L3', bladder: 'pelvis', prostate: 'pelvis' };
const CHUNK_OF = { integumentary: 'skin', skeletal: 'skeleton', muscular: 'muscles', cardiovascular: 'cardio', nervous: 'nervous' };
const rigidTissue = (t) => ['bone', 'tooth', 'disc', 'brain', 'brainstem', 'cerebellum', 'eye', 'iris', 'lens', 'lung', 'liver', 'spleen', 'myocardium', 'atrium', 'valve', 'coronary', 'gallbladder', 'diaphragm', 'stomach', 'intestine', 'colon', 'pancreas', 'kidney', 'medulla', 'bladder', 'prostate', 'tongue', 'airway'].includes(t);

// ------------------------------------------------------------------ shared per-part processing
let MS = null, BW = null, BVH = null, THREE = null;
async function initLibs(bwPath) {
  const mo = await import('meshoptimizer');
  MS = mo.MeshoptSimplifier; await MS.ready;
  BW = require(bwPath);
}
async function initSkin(skin) {
  THREE = await import('three');
  const bv = await import('three-mesh-bvh');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(skin.pos, 3));
  g.setIndex(new THREE.BufferAttribute(skin.idx, 1));
  const bvh = new bv.MeshBVH(g);
  const tgt = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }, pv = new THREE.Vector3();
  const P = skin.pos, I = skin.idx;
  BVH = (x, y, z, out) => {
    pv.set(x, y, z);
    bvh.closestPointToPoint(pv, tgt);
    const f = tgt.faceIndex * 3, a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[0] = tgt.point.x; out[1] = tgt.point.y; out[2] = tgt.point.z;
    const dot = (x - tgt.point.x) * nx + (y - tgt.point.y) * ny + (z - tgt.point.z) * nz;
    return dot > 0 ? tgt.distance : -tgt.distance;
  };
}

function readObj(file) {
  const txt = fs.readFileSync(path.join(OBJ_DIR, file + '.obj'), 'latin1');
  const P = [], F = [];
  for (const line of txt.split('\n')) {
    const c = line.charCodeAt(0);
    if (c === 118 && line.charCodeAt(1) === 32) { // 'v '
      const s = line.trim().split(/\s+/);
      const x = +s[1], y = +s[2], z = +s[3];
      P.push(x * 0.001, (z + 78) * 0.001, -y * 0.001);
    } else if (c === 102 && line.charCodeAt(1) === 32) { // 'f '
      const s = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
      for (let k = 1; k + 1 < s.length; k++) F.push(s[0], s[k], s[k + 1]);
    }
  }
  return { P, F };
}

/** weld, drop degenerates */
function weld(P, F) {
  const map = new Map(), remap = new Int32Array(P.length / 3), pos = [];
  for (let i = 0; i < P.length / 3; i++) {
    const k = Math.round(P[i * 3] * 1e5) + ',' + Math.round(P[i * 3 + 1] * 1e5) + ',' + Math.round(P[i * 3 + 2] * 1e5);
    let j = map.get(k);
    if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); }
    remap[i] = j;
  }
  const idx = [];
  for (let i = 0; i < F.length; i += 3) {
    const a = remap[F[i]], b = remap[F[i + 1]], c = remap[F[i + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

function decimate(m, ratio) {
  const nt = m.idx.length / 3;
  if (ratio >= 0.999 || nt < 300) return m;
  const target = Math.max(3, Math.floor(nt * ratio) * 3);
  const [ni] = MS.simplify(m.idx, m.pos, 3, target, 0.01);
  const used = new Int32Array(m.pos.length / 3).fill(-1);
  let n = 0;
  for (let i = 0; i < ni.length; i++) if (used[ni[i]] < 0) used[ni[i]] = n++;
  const pos = new Float32Array(n * 3), idx = new Uint32Array(ni.length);
  for (let v = 0; v < used.length; v++) if (used[v] >= 0) { pos[used[v] * 3] = m.pos[v * 3]; pos[used[v] * 3 + 1] = m.pos[v * 3 + 1]; pos[used[v] * 3 + 2] = m.pos[v * 3 + 2]; }
  for (let i = 0; i < ni.length; i++) idx[i] = used[ni[i]];
  return { pos, idx };
}

function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += x; n[o + 1] += y; n[o + 2] += z; }
  }
  const out = new Int8Array((pos.length / 3) * 4);
  for (let v = 0; v < pos.length / 3; v++) {
    const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    out[v * 4] = Math.round((n[v * 3] / l) * 127); out[v * 4 + 1] = Math.round((n[v * 3 + 1] / l) * 127); out[v * 4 + 2] = Math.round((n[v * 3 + 2] / l) * 127);
  }
  return out;
}

/** principal axis via covariance + power iteration; returns unit axis and projected [min,max] */
function pca(pos) {
  const n = pos.length / 3;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += pos[i * 3]; my += pos[i * 3 + 1]; mz += pos[i * 3 + 2]; }
  mx /= n; my /= n; mz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] - mx, y = pos[i * 3 + 1] - my, z = pos[i * 3 + 2] - mz;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  let v = [0.577, 0.577, 0.577];
  for (let it = 0; it < 30; it++) {
    const a = xx * v[0] + xy * v[1] + xz * v[2], b = xy * v[0] + yy * v[1] + yz * v[2], c = xz * v[0] + yz * v[1] + zz * v[2];
    const l = Math.hypot(a, b, c) || 1; v = [a / l, b / l, c / l];
  }
  if (v[1] < 0 || (Math.abs(v[1]) < 1e-6 && v[0] < 0)) v = [-v[0], -v[1], -v[2]];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const t = pos[i * 3] * v[0] + pos[i * 3 + 1] * v[1] + pos[i * 3 + 2] * v[2]; if (t < lo) lo = t; if (t > hi) hi = t; }
  return { v, lo, hi };
}

function quantW(w) {
  const out = new Uint8Array(w.length);
  for (let v = 0; v < w.length / 4; v++) {
    let s = 0, bi = 0;
    for (let j = 0; j < 4; j++) { out[v * 4 + j] = Math.round(w[v * 4 + j] * 255); s += out[v * 4 + j]; if (w[v * 4 + j] > w[v * 4 + bi]) bi = j; }
    out[v * 4 + bi] += 255 - s;
  }
  return out;
}

function processPart(job, ctx) {
  const cls = job.cls;
  const tissue0 = cls.tissue;
  let m;
  if (job.fat) {
    m = decimate(ctx.skinGeo, 0.35);
    const nn = normals(m.pos, m.idx);
    const pos = new Float32Array(m.pos);
    for (let v = 0; v < pos.length / 3; v++) for (let a = 0; a < 3; a++) pos[v * 3 + a] -= (nn[v * 4 + a] / 127) * 0.0035;
    m = { pos, idx: m.idx };
  } else {
    const o = readObj(job.file);
    const w0 = weld(o.P, o.F);
    const cap = tissue0 === 'skin' ? Infinity : PART_TRI_CAP;
    m = decimate(w0, Math.min(cls.decimate || 1, cap / Math.max(1, w0.idx.length / 3)));
  }
  const n = m.pos.length / 3, tissue = cls.tissue;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const x = m.pos[i * 3 + a]; if (x < lo[a]) lo[a] = x; if (x > hi[a]) hi[a] = x; }
  const center = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  const res = { id: cls.id, file: job.file, center, vertexCount: n, tris: m.idx.length / 3, abs: m.pos, idx: m.idx };
  res.normal = normals(m.pos, m.idx);
  // skin weights
  let rb = -1;
  if (!job.fat && tissue !== 'skin') {
    if (cls.rigidBone && BW.boneIndex(cls.rigidBone) >= 0) rb = BW.boneIndex(cls.rigidBone);
    else if (rigidTissue(tissue) && !SOFT_TISSUE.has(tissue)) {
      const tb = TRUNK_BONE[tissue];
      rb = tb ? BW.boneIndex(tb) : BW.nearestBone(center[0], center[1], center[2]);
    }
  }
  if (rb >= 0) {
    res.sidx = new Uint8Array(n * 4); res.sw = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { res.sidx[i * 4] = rb; res.sw[i * 4] = 255; }
  } else {
    const own = job.fat || tissue === 'skin';
    const w = BW.softWeights(m.pos, own ? null : BVH, /^(muscle|tendon|ligament|artery|vein|nerve|lymph|node)$/.test(tissue));
    res.sidx = w.idx; res.sw = quantW(w.w);
  }
  // per-tissue attributes
  const rel = new Float32Array(m.pos.length);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) rel[i * 3 + a] = m.pos[i * 3 + a] - center[a];
  res.pos = rel;
  if (tissue === 'muscle' || tissue === 'tendon') {
    const { v } = pca(m.pos);
    res.fdir = new Int8Array(n * 4);
    for (let i = 0; i < n; i++) { res.fdir[i * 4] = Math.round(v[0] * 127); res.fdir[i * 4 + 1] = Math.round(v[1] * 127); res.fdir[i * 4 + 2] = Math.round(v[2] * 127); }
  }
  if (tissue === 'artery' || tissue === 'vein' || tissue === 'coronary') {
    res.flow = new Float32Array(n);
    const h = ctx.heart;
    for (let i = 0; i < n; i++) res.flow[i] = 1.25 * Math.hypot(m.pos[i * 3] - h[0], m.pos[i * 3 + 1] - h[1], m.pos[i * 3 + 2] - h[2]);
  }
  if (tissue === 'intestine' || tissue === 'colon' || tissue === 'esophagus') {
    const { v, lo: l0, hi: h0 } = pca(m.pos);
    const len = h0 - l0 || 1;
    res.along = new Float32Array(n);
    for (let i = 0; i < n; i++) res.along[i] = ((m.pos[i * 3] * v[0] + m.pos[i * 3 + 1] * v[1] + m.pos[i * 3 + 2] * v[2] - l0) / len) * len;
  }
  return res;
}

// ------------------------------------------------------------------ worker entry
if (!isMainThread) {
  (async () => {
    await initLibs(workerData.bw);
    BW.setEyes(workerData.eyes[0], workerData.eyes[1]);
    await initSkin(workerData.skin);
    const ctx = { heart: workerData.heart, skinGeo: workerData.skin };
    parentPort.on('message', (job) => {
      if (job === 'exit') { process_exit(); return; }
      try {
        const r = processPart(job, ctx);
        const tr = [r.abs.buffer, r.idx.buffer, r.pos.buffer, r.normal.buffer, r.sidx.buffer, r.sw.buffer];
        for (const k of ['fdir', 'flow', 'along']) if (r[k]) tr.push(r[k].buffer);
        parentPort.postMessage({ r }, tr);
      } catch (e) { parentPort.postMessage({ err: String(e && e.stack || e), id: job.cls.id }); }
    });
    parentPort.postMessage({ ready: true });
  })();
  function process_exit() { setImmediate(() => globalThis.process.exit(0)); }
  return;
}

// ------------------------------------------------------------------ main
function arg(name, d) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d; }

function provisional(rows) {
  const files = {};
  for (const [file, fma, name] of rows) {
    const nm = name.toLowerCase();
    const side = /^left /.test(nm) ? 'L' : /^right /.test(nm) ? 'R' : '';
    const e = { name: name[0].toUpperCase() + name.slice(1), system: 'digestive', tissue: 'mucosa', decimate: 0.7 };
    const t = (s, ti, d) => { e.system = s; e.tissue = ti; e.decimate = d; };
    if (fma === 'FMA7163') t('integumentary', 'skin', 1);
    else if (/valve|cusp|leaflet|cavity of|lumen/.test(nm)) e.skip = true;
    else if (/tooth|molar|incisor|canine|premolar/.test(nm)) t('skeletal', 'tooth', 1);
    else if (/intervertebral|cartilage|disc\b/.test(nm)) t('skeletal', 'cartilage', 0.8);
    else if (/bone|vertebra|\brib\b|sternum|sacrum|coccyx|phalanx|femur|tibia|fibula|humerus|radius|ulna|scapula|clavicle|patella|skull|mandible|maxilla|talus|calcaneus/.test(nm)) t('skeletal', 'bone', 0.7);
    else if (/tendon/.test(nm)) t('muscular', 'tendon', 1);
    else if (/muscle|diaphragm|intercostal/.test(nm)) { t('muscular', 'muscle', 0.45); if (/diaphragm/.test(nm)) e.anim = 'diaphragm'; }
    else if (/wall of .*ventric|ventricle.*wall/.test(nm)) { t('cardiovascular', 'myocardium', 1); e.anim = 'ventricle'; }
    else if (/wall of .*atri/.test(nm)) { t('cardiovascular', 'atrium', 1); e.anim = 'atrium'; }
    else if (/coronary|cardiac vein/.test(nm)) t('cardiovascular', 'coronary', 0.8);
    else if (/arter|aorta/.test(nm)) t('cardiovascular', 'artery', 0.55);
    else if (/vein|vena|sinus/.test(nm)) t('cardiovascular', 'vein', 0.55);
    else if (/sclera|cornea|iris|lens|eyeball|choroid|retina|chamber|vitreous/.test(nm)) { t('nervous', 'eye', 1); if (side) e.rigidBone = 'eye.' + side; }
    else if (/nerve|ganglion/.test(nm)) t('nervous', 'nerve', 0.8);
    else if (/gyrus|lobe|cerebell|thalamus|hemisphere|brain|white matter|ventricle|fornix|hypothal|midbrain|hindbrain|pons|medulla ob/.test(nm)) t('nervous', 'brain', 0.7);
    else if (/bronch|trachea|larynx/.test(nm)) t('respiratory', 'airway', 0.8);
    else if (/kidney|ureter|bladder/.test(nm)) t('urinary', /bladder/.test(nm) ? 'bladder' : 'kidney', 1);
    else if (/colon|rectum|cecum|appendix/.test(nm)) t('digestive', 'colon', 0.8);
    else if (/intestin|duoden|jejun|ileum/.test(nm)) t('digestive', 'intestine', 0.8);
    else if (/stomach/.test(nm)) t('digestive', 'stomach', 1);
    else if (/esophag/.test(nm)) t('digestive', 'esophagus', 1);
    files[file] = Object.assign(e, { id: 'bp.' + nm.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(left|right)_(.*)$/, '$2') + (side ? '.' + side : '') + '.' + file.toLowerCase(), parent: e.system });
  }
  return { files, groups: [] };
}

async function main() {
  const t0 = Date.now();
  const limit = +arg('limit', 0), only = arg('only', ''), outDir = path.resolve(arg('out', path.join(ROOT, 'public/bp3d')));
  const manifestPath = path.resolve(arg('manifest', path.join(ROOT, 'src/data/bp3d_manifest.json')));
  const rows = fs.readFileSync(path.join(ROOT, 'data/bp3d_leaf.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')).map((c) => [c[0], c[1], c[2]]);
  const insp = require(path.join(ROOT, 'data/bp3d_inspect.json')).info;
  const clsPath = path.join(ROOT, 'data/bp3d_classified.json');
  const haveCls = fs.existsSync(clsPath) && !process.argv.includes('--provisional');
  const C = haveCls ? JSON.parse(fs.readFileSync(clsPath, 'utf8')) : provisional(rows);
  console.log(haveCls ? 'using data/bp3d_classified.json' : 'using PROVISIONAL classification');
  const skinRow = rows.find((r) => r[1] === 'FMA7163');
  // landmarks from raw bboxes (mm, z-up) -> app
  const bc = (f) => { const i = insp[f]; return [(i.mn[0] + i.mx[0]) / 2 * 0.001, ((i.mn[2] + i.mx[2]) / 2 + 78) * 0.001, -(i.mn[1] + i.mx[1]) / 2 * 0.001]; };
  const hf = Object.entries(C.files).filter(([f, c]) => (c.anim === 'ventricle' || c.anim === 'atrium') && insp[f]);
  let heart = [0.01, 1.28, 0.035];
  if (hf.length) { heart = [0, 0, 0]; for (const [f] of hf) { const c = bc(f); for (let a = 0; a < 3; a++) heart[a] += c[a] / hf.length; } }
  const eyes = [null, null];
  for (let s = 0; s < 2; s++) {
    const fs_ = Object.entries(C.files).filter(([f, c]) => !c.skip && c.rigidBone === 'eye.' + 'LR'[s] && insp[f]);
    if (fs_.length) { const e = [0, 0, 0]; for (const [f] of fs_) { const c = bc(f); for (let a = 0; a < 3; a++) e[a] += c[a] / fs_.length; } eyes[s] = e; }
  }
  console.log('heart', heart.map((x) => x.toFixed(3)).join(','), 'eyes', JSON.stringify(eyes.map((e) => e && e.map((x) => +x.toFixed(3)))));

  // bundle weights helper
  const bwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp3d_bw_'));
  const bwPath = path.join(bwDir, 'bw.cjs');
  require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'bw.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bwPath, logLevel: 'error' });
  await initLibs(bwPath);
  BW.setEyes(eyes[0], eyes[1]);

  // job list
  let jobs = [];
  for (const [file, c] of Object.entries(C.files)) {
    if (c.skip || !insp[file]) continue;
    const cls = Object.assign({}, c);
    if (skinRow && file === skinRow[0]) { cls.id = 'bp.skin'; cls.tissue = 'skin'; cls.system = 'integumentary'; cls.decimate = 1; cls.parent = 'integumentary'; cls.name = 'Skin'; cls.rigidBone = undefined; }
    if (only && !new RegExp(only).test(cls.id + ' ' + cls.name)) continue;
    jobs.push({ file, cls, tris: insp[file].tr });
  }
  if (limit) jobs = jobs.filter((j, i) => i % Math.ceil(jobs.length / limit) === 0 || (skinRow && j.file === skinRow[0]));
  const skinJob = skinRow && jobs.find((j) => j.file === skinRow[0]);
  if (!skinJob) throw new Error('skin file missing from selection (use a selection including skin)');

  // skin first (in main), cached for BVH + fat
  const skinRes = processPart(skinJob, { heart });
  const skinGeo = { pos: skinRes.abs, idx: skinRes.idx };
  console.log('skin', skinRes.tris, 'tris', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  const fatJob = { file: 'fat', fat: true, tris: skinRes.tris, cls: { id: 'bp.subcutaneous_fat', name: 'Subcutaneous fat', system: 'integumentary', tissue: 'fat', parent: skinJob.cls.parent || 'integumentary', decimate: 0.35 } };
  const rest = jobs.filter((j) => j !== skinJob).concat([fatJob]).sort((a, b) => b.tris - a.tris);

  const results = new Map();
  results.set(skinJob.cls.id, { job: skinJob, r: skinRes });
  const nW = Math.max(1, Math.min(10, os.cpus().length - 2));
  let next = 0, done = 0, failed = 0;
  await new Promise((resolve) => {
    let alive = nW;
    const pump = (w) => {
      if (next >= rest.length) { w.postMessage('exit'); if (--alive === 0) resolve(); return; }
      const job = rest[next++];
      w.postMessage(job);
      w.job = job;
    };
    for (let i = 0; i < nW; i++) {
      const w = new Worker(__filename, { workerData: { bw: bwPath, eyes, heart, skin: skinGeo } });
      w.on('message', (m) => {
        if (m.ready) return pump(w);
        if (m.err) { failed++; console.error('FAIL', m.id, m.err.split('\n')[0]); } else { results.set(m.r.id, { job: w.job, r: m.r }); }
        if (++done % 200 === 0) console.log(done + '/' + rest.length, ((Date.now() - t0) / 1000).toFixed(0) + 's');
        pump(w);
      });
      w.on('error', (e) => { console.error('worker error', e); failed++; if (--alive === 0) resolve(); });
    }
  });

  // ---------------------------------------------------------------- assemble chunks
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.bin')) fs.unlinkSync(path.join(outDir, f));
  const chunks = {}, parts = [];
  const order = [...results.values()].sort((a, b) => (a.r.id < b.r.id ? -1 : 1));
  const ids = new Set();
  let totalTris = 0;
  for (const { job, r } of order) {
    const cls = job.cls;
    if (ids.has(r.id)) { console.warn('duplicate id', r.id); continue; }
    ids.add(r.id);
    const cn = CHUNK_OF[cls.system] || 'viscera';
    const ch = chunks[cn] || (chunks[cn] = { bufs: [], off: 0 });
    const put = (ta) => {
      const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
      const pad = (4 - (b.length % 4)) % 4;
      const off = ch.off;
      ch.bufs.push(b); if (pad) ch.bufs.push(Buffer.alloc(pad));
      ch.off += b.length + pad;
      return off;
    };
    const u32 = r.vertexCount > 65535 ? r.idx : Uint16Array.from(r.idx);
    const part = { id: r.id, name: cls.name, parent: cls.parent, system: cls.system, tissue: cls.tissue };
    if (cls.desc) part.desc = cls.desc;
    if (cls.anim) part.anim = cls.anim;
    if (cls.driver) part.driver = cls.driver;
    part.chunk = cn; part.center = r.center.map((x) => +x.toFixed(5)); part.vertexCount = r.vertexCount;
    part.index = { off: put(u32), type: r.vertexCount > 65535 ? 'u32' : 'u16', count: r.idx.length };
    part.attrs = {
      position: { off: put(r.pos), type: 'f32', size: 3 },
      normal: { off: put(r.normal), type: 'i8n', size: 3, stride: 4 },
      skinIndex: { off: put(r.sidx), type: 'u8', size: 4 },
      skinWeight: { off: put(r.sw), type: 'u8n', size: 4 },
    };
    if (r.fdir) part.attrs.fdir = { off: put(r.fdir), type: 'i8n', size: 3, stride: 4 };
    if (r.flow) part.attrs.flow = { off: put(r.flow), type: 'f32', size: 1 };
    if (r.along) part.attrs.along = { off: put(r.along), type: 'f32', size: 1 };
    parts.push(part);
    totalTris += r.tris;
  }
  const chunkMeta = {};
  let bytes = 0;
  for (const [cn, ch] of Object.entries(chunks)) {
    fs.writeFileSync(path.join(outDir, cn + '.bin'), Buffer.concat(ch.bufs));
    chunkMeta[cn] = { file: 'bp3d/' + cn + '.bin', bytes: ch.off };
    bytes += ch.off;
  }
  const used = new Set(parts.map((p) => p.parent));
  const gmap = new Map((C.groups || []).map((g) => [g.id, g]));
  const keep = new Set();
  for (const p of used) { let g = p; while (g && gmap.has(g) && !keep.has(g)) { keep.add(g); g = gmap.get(g).parent; } }
  const groups = (C.groups || []).filter((g) => keep.has(g.id)).map((g) => ({ id: g.id, name: g.name, parent: g.parent, system: g.system }));
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, credit: CREDIT, groups, parts, chunks: chunkMeta }));
  fs.rmSync(bwDir, { recursive: true, force: true });
  console.log(`DONE parts=${parts.length} tris=${totalTris} bytes=${(bytes / 1048576).toFixed(1)}MB failed=${failed} time=${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
