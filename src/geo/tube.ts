import { V3, spline, sub, norm, cross, dot, dist, perp, rotAxis } from './math';
import type { Geo, Attr } from './mesher';

export interface TubeOpts {
  /** radius at normalized t (0..1) and arc-length s (meters) */
  r: number | ((t: number, s: number) => number);
  radial?: number;
  /** target segment length (m) */
  seg?: number;
  /** elliptical cross-section scale [normalScale, binormalScale] */
  ellipse?: [number, number];
  /** reference direction for cross-section orientation */
  up?: V3;
  /** add 'flow' attribute = arc length + flow0 */
  flow0?: number;
  caps?: boolean;
  /** raw points are already dense; skip spline */
  raw?: boolean;
}

export function tube(points: V3[], o: TubeOpts): Geo {
  const radial = o.radial ?? 10;
  let approxLen = 0;
  for (let i = 1; i < points.length; i++) approxLen += dist(points[i], points[i - 1]);
  const seg = o.seg ?? 0.006;
  const n = o.raw ? points.length : Math.max(4, Math.min(600, Math.ceil(approxLen / seg) + 1));
  const P = o.raw ? points : spline(points, n);
  const rf = typeof o.r === 'number' ? (() => o.r as number) : o.r;
  const [ea, eb] = o.ellipse ?? [1, 1];
  // tangents
  const T: V3[] = P.map((_, i) => norm(sub(P[Math.min(i + 1, n - 1)], P[Math.max(i - 1, 0)])));
  // parallel transport frames
  const N: V3[] = [];
  let n0: V3;
  if (o.up) {
    const u = o.up;
    n0 = norm(sub(u, [T[0][0] * dot(u, T[0]), T[0][1] * dot(u, T[0]), T[0][2] * dot(u, T[0])]));
    if (!isFinite(n0[0])) n0 = perp(T[0]);
  } else n0 = perp(T[0]);
  N.push(n0);
  for (let i = 1; i < n; i++) {
    const a = T[i - 1], b = T[i];
    const ax = cross(a, b);
    const al = Math.hypot(ax[0], ax[1], ax[2]);
    let nn = N[i - 1];
    if (al > 1e-6) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
      nn = rotAxis(nn, [ax[0] / al, ax[1] / al, ax[2] / al], ang);
    }
    if (o.up) {
      // keep cross-section aligned to up hint (for ribs etc.)
      const u = o.up;
      const pu = sub(u, [b[0] * dot(u, b), b[1] * dot(u, b), b[2] * dot(u, b)]);
      if (Math.hypot(pu[0], pu[1], pu[2]) > 1e-3) nn = norm(pu);
    }
    N.push(norm(nn));
  }
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(P[i], P[i - 1]));
  const total = cum[n - 1] || 1;

  const ringV = radial + 1;
  const vCount = n * ringV + (o.caps !== false ? 2 : 0);
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const flow = o.flow0 !== undefined ? new Float32Array(vCount) : null;
  const along = new Float32Array(vCount);
  let vi = 0;
  for (let i = 0; i < n; i++) {
    const t = cum[i] / total;
    const r = rf(t, cum[i]);
    const nn = N[i];
    const bb = norm(cross(T[i], nn));
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const ox = nn[0] * c * ea + bb[0] * s * eb;
      const oy = nn[1] * c * ea + bb[1] * s * eb;
      const oz = nn[2] * c * ea + bb[2] * s * eb;
      pos[vi * 3] = P[i][0] + ox * r;
      pos[vi * 3 + 1] = P[i][1] + oy * r;
      pos[vi * 3 + 2] = P[i][2] + oz * r;
      // normal of ellipse
      const nx = nn[0] * c / ea + bb[0] * s / eb;
      const ny = nn[1] * c / ea + bb[1] * s / eb;
      const nz = nn[2] * c / ea + bb[2] * s / eb;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nor[vi * 3] = nx / nl;
      nor[vi * 3 + 1] = ny / nl;
      nor[vi * 3 + 2] = nz / nl;
      if (flow) flow[vi] = (o.flow0 as number) + cum[i];
      along[vi] = t;
      vi++;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * ringV + j, b = a + 1, c = a + ringV, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  if (o.caps !== false) {
    const s0 = vi, s1 = vi + 1;
    const pts = [P[0], P[n - 1]];
    const tans = [T[0], T[n - 1]];
    for (let k = 0; k < 2; k++) {
      pos[(vi) * 3] = pts[k][0] - (k === 0 ? 1 : -1) * tans[k][0] * rf(k, k ? total : 0) * 0.5;
      pos[(vi) * 3 + 1] = pts[k][1] - (k === 0 ? 1 : -1) * tans[k][1] * rf(k, k ? total : 0) * 0.5;
      pos[(vi) * 3 + 2] = pts[k][2] - (k === 0 ? 1 : -1) * tans[k][2] * rf(k, k ? total : 0) * 0.5;
      const sg = k === 0 ? -1 : 1;
      nor[vi * 3] = tans[k][0] * sg;
      nor[vi * 3 + 1] = tans[k][1] * sg;
      nor[vi * 3 + 2] = tans[k][2] * sg;
      if (flow) flow[vi] = (o.flow0 as number) + (k ? total : 0);
      along[vi] = k;
      vi++;
    }
    const last = (n - 1) * ringV;
    for (let j = 0; j < radial; j++) {
      idx.push(s0, j + 1, j);
      idx.push(s1, last + j, last + j + 1);
    }
  }
  const attrs: Record<string, Attr> = { along: { data: along, size: 1 } };
  if (flow) attrs.flow = { data: flow, size: 1 };
  return { pos, nor, idx: new Uint32Array(idx), attrs };
}

/** Concatenate geometries; missing attributes are zero-filled. */
export function merge(list: Geo[]): Geo {
  const geos = list.filter((g) => g && g.pos.length > 0);
  if (geos.length === 1) return geos[0];
  let nv = 0, ni = 0;
  const attrNames = new Map<string, number>();
  for (const g of geos) {
    nv += g.pos.length / 3;
    ni += g.idx.length;
    if (g.attrs) for (const [k, a] of Object.entries(g.attrs)) attrNames.set(k, a.size);
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  const attrs: Record<string, Attr> = {};
  for (const [k, s] of attrNames) attrs[k] = { data: new Float32Array(nv * s), size: s };
  let vo = 0, io = 0;
  for (const g of geos) {
    const c = g.pos.length / 3;
    pos.set(g.pos, vo * 3);
    nor.set(g.nor, vo * 3);
    for (let i = 0; i < g.idx.length; i++) idx[io + i] = g.idx[i] + vo;
    if (g.attrs) for (const [k, a] of Object.entries(g.attrs)) attrs[k].data.set(a.data, vo * a.size);
    vo += c;
    io += g.idx.length;
  }
  return { pos, nor, idx, attrs: attrNames.size ? attrs : undefined };
}

export function emptyGeo(): Geo {
  return { pos: new Float32Array(0), nor: new Float32Array(0), idx: new Uint32Array(0) };
}
