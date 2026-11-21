import { V3, add, mul, norm, sub, cross, rotAxis, perp, rng, lerp, spline, dist } from './math';
import { tube, merge } from './tube';
import type { Geo } from './mesher';

export interface BranchOpts {
  len: number;
  r: number;
  depth: number;
  seed?: number;
  spread?: number;
  lenDecay?: number;
  rDecay?: number;
  /** signed distance: negative = allowed region */
  inside?: (p: V3) => number;
  margin?: number;
  flow0?: number;
  radial?: number;
  children?: number;
  /** optional point transform (e.g. conform to skin) */
  map?: (p: V3) => V3;
  minR?: number;
}

/** Recursive branching tube tree (bronchi, vessels, nerves). */
export function branchTree(start: V3, dir: V3, o: BranchOpts): Geo {
  const R = rng(o.seed ?? 7);
  const geos: Geo[] = [];
  const spread = o.spread ?? 0.55;
  const lenDecay = o.lenDecay ?? 0.78;
  const rDecay = o.rDecay ?? 0.72;
  const margin = o.margin ?? 0.004;
  const inside = o.inside;
  const grad = (p: V3): V3 => {
    if (!inside) return [0, 0, 0];
    const e = 0.002;
    return norm([
      inside([p[0] + e, p[1], p[2]]) - inside([p[0] - e, p[1], p[2]]),
      inside([p[0], p[1] + e, p[2]]) - inside([p[0], p[1] - e, p[2]]),
      inside([p[0], p[1], p[2] + e]) - inside([p[0], p[1], p[2] - e]),
    ]);
  };
  const grow = (p: V3, d: V3, len: number, r: number, depth: number, flow: number) => {
    let dd = norm(d);
    let L = len;
    let end = add(p, mul(dd, L));
    if (inside) {
      let tries = 0;
      while (inside(end) > -margin && tries < 10) {
        const g = grad(end);
        dd = norm(sub(dd, mul(g, 0.6)));
        if (tries > 4) L *= 0.7;
        end = add(p, mul(dd, L));
        tries++;
      }
      if (inside(end) > -margin * 0.3) return;
    }
    const side = perp(dd);
    const mid = add(lerp(p, end, 0.5), mul(rotAxis(side, dd, R() * Math.PI * 2), L * 0.08 * (R() - 0.3)));
    let pts: V3[] = [p, mid, end];
    if (o.map) pts = pts.map((q, i) => (i === 0 ? q : o.map!(q)));
    const r1 = Math.max(o.minR ?? 0.0004, r * rDecay);
    geos.push(
      tube(pts, {
        r: (t) => r + (r1 - r) * t,
        radial: r > 0.003 ? 10 : r > 0.0015 ? 7 : 5,
        seg: Math.max(0.003, L / 6),
        flow0: o.flow0 !== undefined ? flow : undefined,
        caps: depth === 0,
      }),
    );
    if (depth <= 0) return;
    const realEnd = pts[pts.length - 1];
    const n = depth === o.depth && o.children ? o.children : 2;
    const baseAng = R() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const axis = rotAxis(side, dd, baseAng + (i * Math.PI * 2) / n);
      const ang = spread * (0.65 + R() * 0.6);
      const nd = rotAxis(dd, norm(cross(dd, axis)), ang);
      grow(realEnd, nd, L * lenDecay * (0.85 + R() * 0.3), r1, depth - 1, flow + dist(p, realEnd));
    }
  };
  grow(start, dir, o.len, o.r, o.depth, o.flow0 ?? 0);
  return merge(geos);
}

/** Add short side branches along a vessel/nerve path. */
export function twigs(path: V3[], count: number, o: { seed?: number; len: [number, number]; r: number; depth?: number; flow0?: number; map?: (p: V3) => V3; avoid?: V3; range?: [number, number]; inside?: (p: V3) => number }): Geo[] {
  const R = rng(o.seed ?? 11);
  const dense = spline(path, 80);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist(dense[i], dense[i - 1]));
  const out: Geo[] = [];
  const [a, b] = o.range ?? [0.12, 0.96];
  for (let i = 0; i < count; i++) {
    const t = a + (b - a) * ((i + R() * 0.8) / count);
    const k = Math.min(dense.length - 2, Math.floor(t * (dense.length - 1)));
    const p = dense[k];
    const T = norm(sub(dense[k + 1], dense[k]));
    let side = rotAxis(perp(T), T, R() * Math.PI * 2);
    if (o.avoid) {
      const away = norm(sub(p, o.avoid));
      side = norm(add(side, mul(away, 0.8)));
    }
    const dir = norm(add(mul(side, 0.85), mul(T, 0.55)));
    const len = o.len[0] + (o.len[1] - o.len[0]) * R();
    out.push(
      branchTree(p, dir, {
        len, r: o.r, depth: o.depth ?? 1, seed: Math.floor(R() * 1e6), spread: 0.6, lenDecay: 0.7, rDecay: 0.7,
        flow0: o.flow0 !== undefined ? o.flow0 + cum[k] : undefined, map: o.map, inside: o.inside, margin: 0.0015,
      }),
    );
  }
  return out;
}
