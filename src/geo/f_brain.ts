import { V3, spline, rng, norm, cross, sub, add, mul } from './math';
import { Shape } from './sdf';
import { noise3 } from './noise';

/** Sulcal grooves as polylines on a base surface, evaluated through a spatial hash (fast, deterministic). */
export interface Sulcus {
  pts: V3[]; // dense polyline on the surface
  w: number; // half width of the groove (m)
  depth: number; // max depth (m)
  ends: number; // depth fraction at the ends (0..1)
}

export function snap(base: Shape, p: V3, it = 8): V3 {
  let q: V3 = [p[0], p[1], p[2]];
  const e = 0.0006;
  for (let i = 0; i < it; i++) {
    const d = base.d(q[0], q[1], q[2]);
    const gx = base.d(q[0] + e, q[1], q[2]) - base.d(q[0] - e, q[1], q[2]);
    const gy = base.d(q[0], q[1] + e, q[2]) - base.d(q[0], q[1] - e, q[2]);
    const gz = base.d(q[0], q[1], q[2] + e) - base.d(q[0], q[1], q[2] - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    q = [q[0] - (gx / gl) * d, q[1] - (gy / gl) * d, q[2] - (gz / gl) * d];
    if (Math.abs(d) < 0.00008) break;
  }
  return q;
}

/** outward unit normal of base at p */
export function normalAt(base: Shape, p: V3): V3 {
  const e = 0.0008;
  return norm([
    base.d(p[0] + e, p[1], p[2]) - base.d(p[0] - e, p[1], p[2]),
    base.d(p[0], p[1] + e, p[2]) - base.d(p[0], p[1] - e, p[2]),
    base.d(p[0], p[1], p[2] + e) - base.d(p[0], p[1], p[2] - e),
  ]);
}

/** Smooth, densify (3 mm) and snap a rough polyline onto the surface. */
export function densify(base: Shape, rough: V3[], jitter = 0.0008, seed = 1): V3[] {
  const snapped = rough.map((p) => snap(base, p));
  let L = 0;
  for (let i = 1; i < snapped.length; i++) L += Math.hypot(snapped[i][0] - snapped[i - 1][0], snapped[i][1] - snapped[i - 1][1], snapped[i][2] - snapped[i - 1][2]);
  const n = Math.max(4, Math.ceil(L / 0.003));
  const sp = spline(snapped, n);
  return sp.map((p, i) => {
    const t = i / (sp.length - 1);
    const edge = Math.min(1, Math.min(t, 1 - t) * 8);
    const q: V3 = [
      p[0] + jitter * edge * noise3(p[0] * 90 + seed * 13, p[1] * 90, p[2] * 90),
      p[1] + jitter * edge * noise3(p[0] * 90, p[1] * 90 + seed * 7, p[2] * 90 + 5),
      p[2] + jitter * edge * noise3(p[0] * 90 + 3, p[1] * 90, p[2] * 90 + seed * 5),
    ];
    return snap(base, q, 4);
  });
}

/**
 * Secondary sulci: side branches leaving a primary sulcus on alternating sides, lying in the
 * surface tangent plane (as the real "comb" of tributary sulci).
 */
export function branches(base: Shape, s: Sulcus, seed: number, o: { every: number; len: [number, number]; keep?: (p: V3) => boolean }): Sulcus[] {
  const R = rng(seed);
  const out: Sulcus[] = [];
  const P = s.pts;
  let side = R() < 0.5 ? 1 : -1;
  const step = Math.max(1, Math.round(o.every / 0.003));
  for (let i = 3 + Math.floor(R() * step); i < P.length - 3; i += step + Math.floor(R() * 2)) {
    const p = P[i];
    if (o.keep && !o.keep(p)) continue;
    const tan = norm(sub(P[i + 1], P[i - 1]));
    const nor = normalAt(base, p);
    let perp = norm(cross(nor, tan));
    side = -side;
    perp = mul(perp, side);
    const len = o.len[0] + (o.len[1] - o.len[0]) * R();
    const bend = (R() - 0.5) * 1.1;
    const dir = norm(add(perp, mul(tan, 0.45 * (R() < 0.5 ? 1 : -1))));
    const rough: V3[] = [p];
    let q = p;
    let d = dir;
    const k = Math.max(2, Math.round(len / 0.004));
    for (let j = 1; j <= k; j++) {
      d = norm(add(d, mul(tan, bend * 0.18)));
      q = snap(base, add(q, mul(d, len / k)), 4);
      rough.push(q);
    }
    const dense = spline(rough, Math.max(4, k * 2)).map((x) => snap(base, x, 3));
    out.push({ pts: dense, w: s.w * 0.72, depth: s.depth * (0.5 + 0.2 * R()), ends: 0.12 });
  }
  return out;
}

/** Build the field fn: amount (>=0) pushing the surface inwards. */
export function sulcalField(list: Sulcus[], bucket = 0.006): (x: number, y: number, z: number) => number {
  let lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  let wmax = 0;
  for (const s of list) {
    wmax = Math.max(wmax, s.w);
    for (const p of s.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  lo = lo.map((v) => v - wmax - bucket) as V3;
  hi = hi.map((v) => v + wmax + bucket) as V3;
  const nx = Math.ceil((hi[0] - lo[0]) / bucket) + 1, ny = Math.ceil((hi[1] - lo[1]) / bucket) + 1, nz = Math.ceil((hi[2] - lo[2]) / bucket) + 1;
  // segments
  const A: number[] = [], Wd: number[] = [], Dp: number[] = [];
  const cells: number[][] = new Array(nx * ny * nz);
  const seg: number[] = []; // ax ay az bx by bz wa wb da db
  for (const s of list) {
    const n = s.pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = s.pts[i], b = s.pts[i + 1];
      const ta = i / n, tb = (i + 1) / n;
      const f = (t: number) => s.ends + (1 - s.ends) * Math.pow(Math.sin(Math.PI * t), 0.6);
      const da = s.depth * f(ta), db = s.depth * f(tb);
      const wa = s.w * (0.7 + 0.3 * f(ta)), wb = s.w * (0.7 + 0.3 * f(tb));
      const id = seg.length / 10;
      seg.push(a[0], a[1], a[2], b[0], b[1], b[2], wa, wb, da, db);
      const x0 = Math.floor((Math.min(a[0], b[0]) - s.w - lo[0]) / bucket), x1 = Math.floor((Math.max(a[0], b[0]) + s.w - lo[0]) / bucket);
      const y0 = Math.floor((Math.min(a[1], b[1]) - s.w - lo[1]) / bucket), y1 = Math.floor((Math.max(a[1], b[1]) + s.w - lo[1]) / bucket);
      const z0 = Math.floor((Math.min(a[2], b[2]) - s.w - lo[2]) / bucket), z1 = Math.floor((Math.max(a[2], b[2]) + s.w - lo[2]) / bucket);
      for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) for (let ii = x0; ii <= x1; ii++) {
        const c = ii + nx * (j + ny * k);
        (cells[c] ??= []).push(id);
      }
    }
  }
  void A; void Wd; void Dp;
  const S = Float64Array.from(seg);
  return (x, y, z) => {
    const ix = Math.floor((x - lo[0]) / bucket), iy = Math.floor((y - lo[1]) / bucket), iz = Math.floor((z - lo[2]) / bucket);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return 0;
    const c = cells[ix + nx * (iy + ny * iz)];
    if (!c) return 0;
    let best = 0;
    for (let q = 0; q < c.length; q++) {
      const o = c[q] * 10;
      const ax = S[o], ay = S[o + 1], az = S[o + 2];
      const bx = S[o + 3] - ax, by = S[o + 4] - ay, bz = S[o + 5] - az;
      const px = x - ax, py = y - ay, pz = z - az;
      const l2 = bx * bx + by * by + bz * bz || 1e-12;
      let t = (px * bx + py * by + pz * bz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      const w = S[o + 6] + (S[o + 7] - S[o + 6]) * t;
      const u2 = d2 / (w * w);
      if (u2 < 1) {
        const v = 1 - u2;
        const g = (S[o + 8] + (S[o + 9] - S[o + 8]) * t) * v * v;
        if (g > best) best = g;
      }
    }
    return best;
  };
}
