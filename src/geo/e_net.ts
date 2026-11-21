import { V3, add, sub, mul, norm, dist, rng, rotAxis, perp, spline, cross } from './math';
import { tube } from './tube';
import type { Geo } from './mesher';

/** Piece E helpers: smooth, tapering, bounded vessel arborisation. */

export type Inside = (p: V3) => number;

const grad = (f: Inside, p: V3): V3 => {
  const e = 0.0015;
  return norm([
    f([p[0] + e, p[1], p[2]]) - f([p[0] - e, p[1], p[2]]),
    f([p[0], p[1] + e, p[2]]) - f([p[0], p[1] - e, p[2]]),
    f([p[0], p[1], p[2] + e]) - f([p[0], p[1], p[2] - e]),
  ]);
};

/** Push a point inward until f(p) <= -margin (f negative inside). */
export function tuck(p: V3, f: Inside, margin: number): V3 {
  let q = p;
  for (let i = 0; i < 5; i++) {
    const d = f(q);
    if (d <= -margin) break;
    q = sub(q, mul(grad(f, q), d + margin + 0.0005));
  }
  return q;
}

export interface ArborOpts {
  seed: number;
  count: number;
  /** base radius of first-order branches (clamped to 0.72 x parent radius) */
  r: number;
  len: [number, number];
  depth?: number;
  flow0?: number;
  inside?: Inside;
  margin?: number;
  map?: (p: V3) => V3;
  range?: [number, number];
  bias?: V3;
  biasW?: number;
  spread?: number;
  fwd?: number;
  lenDecay?: number;
  taper?: number;
  /** parent radius at start/end of path */
  rp?: [number, number];
  /** restrict side branches to this half-space (dot(side, onlyDir) > 0) */
  only?: V3;
  wander?: number;
  minR?: number;
}

/** Side branches along a path, each with bifurcating, tapering sub-branches. */
export function arbor(path: V3[], o: ArborOpts): Geo[] {
  const R = rng(o.seed);
  const dense = spline(path, Math.max(40, Math.min(200, path.length * 12)));
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist(dense[i], dense[i - 1]));
  const total = cum[cum.length - 1] || 1;
  const out: Geo[] = [];
  const margin = o.margin ?? 0.004;
  const taper = o.taper ?? 0.5;
  const spread = o.spread ?? 0.62;
  const lenDecay = o.lenDecay ?? 0.78;
  const minR = o.minR ?? 0.00032;
  const wander = o.wander ?? 0.22;
  const [ra, rb] = o.range ?? [0.08, 0.97];

  const grow = (p: V3, d: V3, L: number, r: number, depth: number, flow: number) => {
    if (r < minR) return;
    const n = 4;
    let dd = norm(d);
    const pts: V3[] = [p];
    let cur = p;
    const side = perp(dd);
    const ph = R() * 6.28;
    for (let i = 1; i <= n; i++) {
      const w = Math.sin(ph + i * 1.7) * wander * (L / n);
      let nd = norm(add(dd, add(mul(side, w / (L / n) * 0.5), o.bias ? mul(o.bias, o.biasW ?? 0.3) : [0, 0, 0])));
      let q = add(cur, mul(nd, L / n));
      if (o.inside) {
        let tries = 0;
        while (o.inside(q) > -(margin + r) && tries < 6) {
          nd = norm(sub(nd, mul(grad(o.inside, q), 0.7)));
          q = add(cur, mul(nd, L / n));
          tries++;
        }
        if (o.inside(q) > -(margin + r * 0.5)) break;
      }
      if (o.map) q = o.map(q);
      pts.push(q);
      dd = norm(sub(q, cur));
      cur = q;
    }
    if (pts.length < 3) return;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i], pts[i - 1]);
    if (len < 0.004) return;
    const r1 = Math.max(minR * 0.8, r * taper);
    out.push(tube(pts, {
      r: (t) => r + (r1 - r) * t,
      radial: r > 0.0025 ? 10 : r > 0.0012 ? 7 : 5,
      seg: Math.max(0.0025, Math.min(0.006, len / 5)),
      flow0: o.flow0 !== undefined ? flow : undefined,
    }));
    if (depth <= 0) return;
    const end = pts[pts.length - 1];
    const T = norm(sub(end, pts[pts.length - 2]));
    const s0 = perp(T);
    const base = R() * 6.28;
    for (let k = 0; k < 2; k++) {
      const ax = rotAxis(s0, T, base + k * Math.PI);
      const nd = rotAxis(T, norm(cross(T, ax)), spread * (0.6 + R() * 0.7));
      grow(end, nd, len * lenDecay * (0.8 + R() * 0.4), r1 * 0.92, depth - 1, flow + len);
    }
  };

  for (let i = 0; i < o.count; i++) {
    const t = ra + (rb - ra) * ((i + 0.15 + R() * 0.7) / o.count);
    const k = Math.min(dense.length - 2, Math.max(0, Math.floor(t * (dense.length - 1))));
    const p = dense[k];
    const T = norm(sub(dense[k + 1], dense[k]));
    let sd = rotAxis(perp(T), T, R() * 6.28);
    if (o.only) {
      const dn = sd[0] * o.only[0] + sd[1] * o.only[1] + sd[2] * o.only[2];
      if (dn < 0) sd = mul(sd, -1);
    }
    const fwd = o.fwd ?? 0.5;
    const dir = norm(add(mul(sd, 0.85), mul(T, fwd)));
    const L = o.len[0] + (o.len[1] - o.len[0]) * R();
    let r = o.r * (0.75 + R() * 0.5);
    if (o.rp) r = Math.min(r, 0.72 * (o.rp[0] + (o.rp[1] - o.rp[0]) * t));
    grow(p, dir, L, r, o.depth ?? 2, (o.flow0 ?? 0) + cum[k]);
  }
  void total;
  return out;
}
