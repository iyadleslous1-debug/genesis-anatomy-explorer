// P7 helpers: bean-shaped lymph nodes (direct meshes, no SDF) and node clusters with fine lymph vessels.
import { V3, add, mul, sub, norm, cross, dot, rng, spline, dist } from './math';
import type { Geo } from './mesher';
import { tube, merge, emptyGeo } from './tube';

/** One kidney-bean lymph node. a = half length (m). dir = long axis. */
export function beanGeo(c: V3, dir: V3, a: number, seed: number, nu = 12, nv = 8): Geo {
  const rnd = rng(seed);
  const y = norm(dir);
  const h0: V3 = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x0 = norm(cross(y, h0));
  const z0 = cross(x0, y);
  const ang = rnd() * Math.PI * 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const X: V3 = add(mul(x0, ca), mul(z0, sa));
  const Z: V3 = sub(mul(z0, ca), mul(x0, sa));
  const b = a * (0.55 + rnd() * 0.15), cc = a * (0.5 + rnd() * 0.15);
  const ph = rnd() * 6.28, f1 = 2 + rnd() * 2;
  const nVert = nu * (nv - 1) + 2;
  const pos = new Float32Array(nVert * 3), nor = new Float32Array(nVert * 3);
  const put = (i: number, u: number, v: number) => {
    const sv = Math.sin(v), cv = Math.cos(v), cu = Math.cos(u), su = Math.sin(u);
    const px = sv * cu, py = cv, pz = sv * su;
    const k = Math.max(0, px);
    const dent = 1 - 0.34 * Math.pow(k, 4) * (1 - 0.5 * py * py);
    const lump = 1 + 0.05 * Math.sin(f1 * u + ph) * Math.sin(2 * v + ph * 0.5);
    const lx = b * px * dent * lump, ly = a * py * lump, lz = cc * pz * lump;
    pos[i * 3] = c[0] + X[0] * lx + y[0] * ly + Z[0] * lz;
    pos[i * 3 + 1] = c[1] + X[1] * lx + y[1] * ly + Z[1] * lz;
    pos[i * 3 + 2] = c[2] + X[2] * lx + y[2] * ly + Z[2] * lz;
  };
  put(0, 0, 0.0001);
  for (let j = 1; j < nv; j++) for (let i = 0; i < nu; i++) put(1 + (j - 1) * nu + i, (i / nu) * Math.PI * 2, (j / nv) * Math.PI);
  const last = nVert - 1;
  put(last, 0, Math.PI - 0.0001);
  const idx: number[] = [];
  for (let i = 0; i < nu; i++) idx.push(0, 1 + ((i + 1) % nu), 1 + i);
  for (let j = 0; j < nv - 2; j++)
    for (let i = 0; i < nu; i++) {
      const p = 1 + j * nu + i, q = 1 + j * nu + ((i + 1) % nu), r = p + nu, s = q + nu;
      idx.push(p, q, r, q, s, r);
    }
  const base = 1 + (nv - 2) * nu;
  for (let i = 0; i < nu; i++) idx.push(last, base + i, base + ((i + 1) % nu));
  for (let i = 0; i < idx.length; i += 3) {
    const A = idx[i] * 3, B = idx[i + 1] * 3, C = idx[i + 2] * 3;
    const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
    const vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [A, B, C]) { nor[k] += nx; nor[k + 1] += ny; nor[k + 2] += nz; }
  }
  // winding check: outward normals should point away from centre; flip if inverted
  let s = 0;
  for (let i = 0; i < nVert; i++) s += nor[i * 3] * (pos[i * 3] - c[0]) + nor[i * 3 + 1] * (pos[i * 3 + 1] - c[1]) + nor[i * 3 + 2] * (pos[i * 3 + 2] - c[2]);
  const flip = s < 0;
  if (flip) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  for (let i = 0; i < nVert; i++) {
    const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
    const sg = flip ? -1 : 1;
    nor[i * 3] = (sg * nor[i * 3]) / l; nor[i * 3 + 1] = (sg * nor[i * 3 + 1]) / l; nor[i * 3 + 2] = (sg * nor[i * 3 + 2]) / l;
  }
  return { pos, nor, idx: new Uint32Array(idx) };
}

export interface NodeRun {
  path: V3[];
  count: number;
  /** lateral scatter (m) */
  spread: number;
  /** half-length range (m) */
  size: [number, number];
  /** optional per-point fix-up (e.g. conform to skin) */
  fix?: (p: V3, r: number) => V3;
}

export interface Cluster { nodes: Geo; centers: V3[]; sizes: number[]; dirs: V3[]; fixes: (((p: V3, r: number) => V3) | undefined)[] }

/** Scatter nodes along paths. Deterministic. */
export function scatterNodes(runs: NodeRun[], seed: number): Cluster {
  const rnd = rng(seed);
  const geos: Geo[] = [];
  const centers: V3[] = [], sizes: number[] = [], dirs: V3[] = [], fixes: Cluster['fixes'] = [];
  let k = 0;
  for (const run of runs) {
    const pts = spline(run.path, Math.max(8, run.count * 4));
    for (let i = 0; i < run.count; i++) {
      const t = run.count === 1 ? 0.5 : (i + 0.2 + rnd() * 0.6) / run.count;
      const j = Math.min(pts.length - 2, Math.floor(Math.min(0.999, t) * (pts.length - 1)));
      const tan = norm(sub(pts[j + 1], pts[j]));
      let p: V3 = [...pts[j]] as V3;
      const o: V3 = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      p = add(p, mul(o, run.spread * 2));
      const r = run.size[0] + (run.size[1] - run.size[0]) * Math.pow(rnd(), 1.4);
      if (run.fix) p = run.fix(p, r);
      const d = norm(add(tan, mul([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], 0.9)));
      geos.push(beanGeo(p, d, r, seed * 131 + k++));
      centers.push(p); sizes.push(r); dirs.push(d); fixes.push(run.fix);
    }
  }
  return { nodes: geos.length ? merge(geos) : emptyGeo(), centers, sizes, dirs, fixes };
}

/** Fine lymph vessels: a collector running through the nodes plus short afferent twigs. */
export function nodeVessels(cl: Cluster, seed: number, r = 0.00035): Geo {
  const rnd = rng(seed);
  const out: Geo[] = [];
  const c = cl.centers;
  if (c.length >= 2) {
    // order greedily from the first node
    const left = c.map((_, i) => i);
    const order = [left.shift()!];
    while (left.length) {
      const last = c[order[order.length - 1]];
      let bi = 0, bd = 1e9;
      left.forEach((ii, li) => { const d = dist(c[ii], last); if (d < bd) { bd = d; bi = li; } });
      order.push(left.splice(bi, 1)[0]);
    }
    for (let i = 0; i + 1 < order.length; i++) {
      const a = c[order[i]], b = c[order[i + 1]];
      let m = add(mul(add(a, b), 0.5), mul([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], dist(a, b) * 0.25));
      const fx = cl.fixes[order[i]];
      if (fx) m = fx(m, 0.0004);
      if (dist(a, b) < 0.001) continue;
      out.push(tube([a, m, b], { r, radial: 5, seg: 0.005, flow0: 0 }));
    }
  }
  for (let i = 0; i < c.length; i++) {
    const L = 0.003 + rnd() * 0.005;
    const d: V3 = norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    let s = add(c[i], mul(d, L + cl.sizes[i]));
    if (cl.fixes[i]) s = cl.fixes[i]!(s, 0.0004);
    out.push(tube([s, add(s, mul(d, -L * 0.5)), add(c[i], mul(d, cl.sizes[i] * 0.6))], { r: r * 0.7, radial: 4, seg: 0.004, flow0: 0 }));
  }
  return out.length ? merge(out) : emptyGeo();
}

export { dot };
