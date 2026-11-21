import { V3, norm, cross, sub, dot, spline as splinePts } from './math';

/** A signed distance shape with a conservative bounding box of its surface. */
export interface Shape {
  d: (x: number, y: number, z: number) => number;
  lo: V3;
  hi: V3;
}

/** Orthonormal local frame: [xAxis, yAxis, zAxis] in world space. */
export type Frame = [V3, V3, V3];

export const IDENTITY: Frame = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const INF = 1e9;

/** Frame whose local Y = dir, local Z as close as possible to hint. */
export function frameY(dir: V3, hint: V3 = [0, 0, 1]): Frame {
  const y = norm(dir);
  let z = sub(hint, [y[0] * dot(y, hint), y[1] * dot(y, hint), y[2] * dot(y, hint)]);
  if (Math.hypot(z[0], z[1], z[2]) < 1e-4) z = Math.abs(y[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  z = norm(z);
  const x = norm(cross(y, z));
  return [x, y, z];
}

/** Frame from Euler angles (XYZ order, radians). */
export function frameEuler(rx: number, ry: number, rz: number): Frame {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx ; columns are local axes
  const m = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

export function frameAxes(x: V3, y: V3): Frame {
  const yy = norm(y);
  const zz = norm(cross(x, yy));
  const xx = norm(cross(yy, zz));
  return [xx, yy, zz];
}

function boundsFromFrame(c: V3, ext: V3, f: Frame): { lo: V3; hi: V3 } {
  const lo: V3 = [0, 0, 0], hi: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const e = Math.abs(f[0][i]) * ext[0] + Math.abs(f[1][i]) * ext[1] + Math.abs(f[2][i]) * ext[2];
    lo[i] = c[i] - e;
    hi[i] = c[i] + e;
  }
  return { lo, hi };
}

function ellipsoidExtent(r: V3, f: Frame): V3 {
  const e: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    e[i] = Math.sqrt((f[0][i] * r[0]) ** 2 + (f[1][i] * r[1]) ** 2 + (f[2][i] * r[2]) ** 2);
  }
  return e;
}

export function sphere(c: V3, r: number): Shape {
  const [cx, cy, cz] = c;
  return {
    d: (x, y, z) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r,
    lo: [cx - r, cy - r, cz - r],
    hi: [cx + r, cy + r, cz + r],
  };
}

export function ellipsoid(c: V3, r: V3, f: Frame = IDENTITY): Shape {
  const [cx, cy, cz] = c;
  const [ax, ay, az] = f;
  const [rx, ry, rz] = r;
  const e = ellipsoidExtent(r, f);
  return {
    d: (x, y, z) => {
      const px = x - cx, py = y - cy, pz = z - cz;
      const lx = px * ax[0] + py * ax[1] + pz * ax[2];
      const ly = px * ay[0] + py * ay[1] + pz * ay[2];
      const lz = px * az[0] + py * az[1] + pz * az[2];
      const k0 = Math.sqrt((lx / rx) ** 2 + (ly / ry) ** 2 + (lz / rz) ** 2);
      const k1 = Math.sqrt((lx / (rx * rx)) ** 2 + (ly / (ry * ry)) ** 2 + (lz / (rz * rz)) ** 2);
      if (k1 < 1e-9) return -Math.min(rx, ry, rz);
      return (k0 * (k0 - 1)) / k1;
    },
    lo: [cx - e[0], cy - e[1], cz - e[2]],
    hi: [cx + e[0], cy + e[1], cz + e[2]],
  };
}

/** Round cone (tapered capsule) between a (radius ra) and b (radius rb). */
export function roundCone(a: V3, b: V3, ra: number, rb: number): Shape {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const lo: V3 = [Math.min(a[0] - ra, b[0] - rb), Math.min(a[1] - ra, b[1] - rb), Math.min(a[2] - ra, b[2] - rb)];
  const hi: V3 = [Math.max(a[0] + ra, b[0] + rb), Math.max(a[1] + ra, b[1] + rb), Math.max(a[2] + ra, b[2] + rb)];
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  if (l2 < 1e-12 || a2 <= 1e-12) {
    return ra > rb ? sphere(a, ra) : sphere(b, rb);
  }
  const il2 = 1 / l2;
  const srr = Math.sign(rr);
  return {
    d: (x, y, z) => {
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const xvx = pax * l2 - bax * yy, xvy = pay * l2 - bay * yy, xvz = paz * l2 - baz * yy;
      const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = srr * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    },
    lo,
    hi,
  };
}

export const capsule = (a: V3, b: V3, r: number) => roundCone(a, b, r, r);

/** Rounded box: half extents (excluding rounding r) in local frame. */
export function roundBox(c: V3, half: V3, f: Frame = IDENTITY, r = 0): Shape {
  const [cx, cy, cz] = c;
  const [ax, ay, az] = f;
  const b = boundsFromFrame(c, [half[0] + r, half[1] + r, half[2] + r], f);
  return {
    d: (x, y, z) => {
      const px = x - cx, py = y - cy, pz = z - cz;
      const qx = Math.abs(px * ax[0] + py * ax[1] + pz * ax[2]) - half[0];
      const qy = Math.abs(px * ay[0] + py * ay[1] + pz * ay[2]) - half[1];
      const qz = Math.abs(px * az[0] + py * az[1] + pz * az[2]) - half[2];
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
    },
    lo: b.lo,
    hi: b.hi,
  };
}

/** Rounded cylinder along local Y. */
export function cylinder(c: V3, radius: number, halfH: number, f: Frame = IDENTITY, round = 0, rz?: number): Shape {
  const [cx, cy, cz] = c;
  const [ax, ay, az] = f;
  const sx = 1, sz = rz ? radius / rz : 1;
  const ext: V3 = [radius + round, halfH + round, (rz ?? radius) + round];
  const b = boundsFromFrame(c, ext, f);
  return {
    d: (x, y, z) => {
      const px = x - cx, py = y - cy, pz = z - cz;
      const lx = (px * ax[0] + py * ax[1] + pz * ax[2]) * sx;
      const ly = px * ay[0] + py * ay[1] + pz * ay[2];
      const lz = (px * az[0] + py * az[1] + pz * az[2]) * sz;
      const dx = Math.sqrt(lx * lx + lz * lz) - radius + round;
      const dy = Math.abs(ly) - halfH + round;
      return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - round;
    },
    lo: b.lo,
    hi: b.hi,
  };
}

/** Torus lying in local XZ plane (axis = local Y). */
export function torus(c: V3, R: number, r: number, f: Frame = IDENTITY): Shape {
  const [cx, cy, cz] = c;
  const [ax, ay, az] = f;
  const b = boundsFromFrame(c, [R + r, r, R + r], f);
  return {
    d: (x, y, z) => {
      const px = x - cx, py = y - cy, pz = z - cz;
      const lx = px * ax[0] + py * ax[1] + pz * ax[2];
      const ly = px * ay[0] + py * ay[1] + pz * ay[2];
      const lz = px * az[0] + py * az[1] + pz * az[2];
      const q = Math.sqrt(lx * lx + lz * lz) - R;
      return Math.sqrt(q * q + ly * ly) - r;
    },
    lo: b.lo,
    hi: b.hi,
  };
}

/** Thick triangle (distance to triangle minus thickness). */
export function triangle(a: V3, b: V3, c: V3, t: number): Shape {
  const ba = sub(b, a), cb = sub(c, b), ac = sub(a, c);
  const nor = cross(ba, ac);
  const nn = dot(nor, nor);
  const cba = cross(ba, nor), ccb = cross(cb, nor), cac = cross(ac, nor);
  const dba = dot(ba, ba), dcb = dot(cb, cb), dac = dot(ac, ac);
  const lo: V3 = [Math.min(a[0], b[0], c[0]) - t, Math.min(a[1], b[1], c[1]) - t, Math.min(a[2], b[2], c[2]) - t];
  const hi: V3 = [Math.max(a[0], b[0], c[0]) + t, Math.max(a[1], b[1], c[1]) + t, Math.max(a[2], b[2], c[2]) + t];
  const cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  return {
    d: (x, y, z) => {
      const pa: V3 = [x - a[0], y - a[1], z - a[2]];
      const pb: V3 = [x - b[0], y - b[1], z - b[2]];
      const pc: V3 = [x - c[0], y - c[1], z - c[2]];
      const s = Math.sign(dot(cba, pa)) + Math.sign(dot(ccb, pb)) + Math.sign(dot(cac, pc));
      let d2: number;
      if (s < 2) {
        const t1 = cl(dot(ba, pa) / dba);
        const t2 = cl(dot(cb, pb) / dcb);
        const t3 = cl(dot(ac, pc) / dac);
        const e1 = (ba[0] * t1 - pa[0]) ** 2 + (ba[1] * t1 - pa[1]) ** 2 + (ba[2] * t1 - pa[2]) ** 2;
        const e2 = (cb[0] * t2 - pb[0]) ** 2 + (cb[1] * t2 - pb[1]) ** 2 + (cb[2] * t2 - pb[2]) ** 2;
        const e3 = (ac[0] * t3 - pc[0]) ** 2 + (ac[1] * t3 - pc[1]) ** 2 + (ac[2] * t3 - pc[2]) ** 2;
        d2 = Math.min(e1, e2, e3);
      } else {
        const dn = dot(nor, pa);
        d2 = (dn * dn) / nn;
      }
      return Math.sqrt(d2) - t;
    },
    lo,
    hi,
  };
}

/** Half-space: negative on the side opposite to n (n points outward). */
export function plane(n: V3, p0: V3): Shape {
  const nn = norm(n);
  const c = dot(nn, p0);
  return {
    d: (x, y, z) => x * nn[0] + y * nn[1] + z * nn[2] - c,
    lo: [-INF, -INF, -INF],
    hi: [INF, INF, INF],
  };
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** Smooth union with bounding-box culling. */
export function union(shapes: Shape[], k = 0): Shape {
  const list = shapes.filter(Boolean);
  if (list.length === 1 && k === 0) return list[0];
  const n = list.length;
  const LO = new Float64Array(n * 3), HI = new Float64Array(n * 3);
  const lo: V3 = [INF, INF, INF], hi: V3 = [-INF, -INF, -INF];
  list.forEach((s, i) => {
    for (let j = 0; j < 3; j++) {
      LO[i * 3 + j] = s.lo[j];
      HI[i * 3 + j] = s.hi[j];
      lo[j] = Math.min(lo[j], s.lo[j]);
      hi[j] = Math.max(hi[j], s.hi[j]);
    }
  });
  const pad = k * 0.3;
  const ds = list.map((s) => s.d);
  return {
    d: (x, y, z) => {
      let r = INF;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const dx = Math.max(LO[i3] - x, 0, x - HI[i3]);
        const dy = Math.max(LO[i3 + 1] - y, 0, y - HI[i3 + 1]);
        const dz = Math.max(LO[i3 + 2] - z, 0, z - HI[i3 + 2]);
        const lb = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (lb >= r + k && r < INF) continue;
        const v = ds[i](x, y, z);
        r = k > 0 && r < INF ? smin(r, v, k) : Math.min(r, v);
      }
      return r;
    },
    lo: [lo[0] - pad, lo[1] - pad, lo[2] - pad],
    hi: [hi[0] + pad, hi[1] + pad, hi[2] + pad],
  };
}

export function subtract(a: Shape, b: Shape, k = 0): Shape {
  const bl = b.lo, bh = b.hi;
  return {
    d: (x, y, z) => {
      const da = a.d(x, y, z);
      // cull: if outside b's box by more than k, subtraction has no effect
      const dx = Math.max(bl[0] - x, 0, x - bh[0]);
      const dy = Math.max(bl[1] - y, 0, y - bh[1]);
      const dz = Math.max(bl[2] - z, 0, z - bh[2]);
      if (dx * dx + dy * dy + dz * dz > (k + 1e-4) ** 2 + 1e-9 && bl[0] > -INF / 2) return da;
      const db = b.d(x, y, z);
      return k > 0 ? smax(da, -db, k) : Math.max(da, -db);
    },
    lo: a.lo,
    hi: a.hi,
  };
}

export function subtractAll(a: Shape, bs: Shape[], k = 0): Shape {
  return bs.reduce((acc, b) => subtract(acc, b, k), a);
}

export function intersect(a: Shape, b: Shape, k = 0): Shape {
  const lo: V3 = [Math.max(a.lo[0], b.lo[0]), Math.max(a.lo[1], b.lo[1]), Math.max(a.lo[2], b.lo[2])];
  const hi: V3 = [Math.min(a.hi[0], b.hi[0]), Math.min(a.hi[1], b.hi[1]), Math.min(a.hi[2], b.hi[2])];
  return {
    d: (x, y, z) => {
      const da = a.d(x, y, z);
      const db = b.d(x, y, z);
      return k > 0 ? smax(da, db, k) : Math.max(da, db);
    },
    lo,
    hi,
  };
}

/** Keep the layer of thickness t just inside the surface (hollow organ wall). */
export function hollow(a: Shape, t: number): Shape {
  return { d: (x, y, z) => { const d = a.d(x, y, z); return Math.max(d, -d - t); }, lo: a.lo, hi: a.hi };
}

export function shell(a: Shape, t: number): Shape {
  return {
    d: (x, y, z) => Math.abs(a.d(x, y, z)) - t,
    lo: [a.lo[0] - t, a.lo[1] - t, a.lo[2] - t],
    hi: [a.hi[0] + t, a.hi[1] + t, a.hi[2] + t],
  };
}

export function offset(a: Shape, r: number): Shape {
  return {
    d: (x, y, z) => a.d(x, y, z) - r,
    lo: [a.lo[0] - r, a.lo[1] - r, a.lo[2] - r],
    hi: [a.hi[0] + r, a.hi[1] + r, a.hi[2] + r],
  };
}

/** Add a displacement field (|fn| <= amp). Positive fn pushes surface inward. */
export function displace(a: Shape, fn: (x: number, y: number, z: number) => number, amp: number): Shape {
  return {
    d: (x, y, z) => {
      const d = a.d(x, y, z);
      if (d > amp * 2 || d < -amp * 4) return d; // far from surface: skip noise
      return d + fn(x, y, z);
    },
    lo: [a.lo[0] - amp, a.lo[1] - amp, a.lo[2] - amp],
    hi: [a.hi[0] + amp, a.hi[1] + amp, a.hi[2] + amp],
  };
}

/** Override/tighten bounds (caller guarantees surface lies within). Also clips d by box. */
export function clipBox(a: Shape, lo: V3, hi: V3): Shape {
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const h: V3 = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2];
  const box = roundBox(c, h);
  return intersect(a, box);
}

/** Chain of round cones through points with radii. */
export function chain(points: V3[], radii: number[], k = 0): Shape {
  const segs: Shape[] = [];
  for (let i = 0; i < points.length - 1; i++) segs.push(roundCone(points[i], points[i + 1], radii[i], radii[i + 1]));
  return union(segs, k);
}

/** Smooth spline tube as SDF: radius function of t in [0,1]. */
export function splineTube(points: V3[], r: (t: number) => number, segments = 12, k = 0): Shape {
  const pts = splinePts(points, segments + 1);
  const radii = pts.map((_, i) => r(i / segments));
  return chain(pts, radii, k);
}

/** Mirror across x=0 (shape defined for x>0 becomes symmetric). */
export function mirrorX(a: Shape): Shape {
  const ex = Math.max(Math.abs(a.lo[0]), Math.abs(a.hi[0]));
  return { d: (x, y, z) => a.d(Math.abs(x), y, z), lo: [-ex, a.lo[1], a.lo[2]], hi: [ex, a.hi[1], a.hi[2]] };
}

/** Region mask from half-spaces: inside if all planes negative. gap shrinks pieces for visible sutures. */
export type PlaneFn = (x: number, y: number, z: number) => number;
export function region(a: Shape, planes: PlaneFn[], gap = 0, lo?: V3, hi?: V3): Shape {
  return {
    d: (x, y, z) => {
      let d = a.d(x, y, z);
      for (const p of planes) d = Math.max(d, p(x, y, z) + gap);
      return d;
    },
    lo: lo ?? a.lo,
    hi: hi ?? a.hi,
  };
}

/** Plane function helper: n·p - c, normalized. */
export function pf(n: V3, p0: V3): PlaneFn {
  const nn = norm(n);
  const c = dot(nn, p0);
  return (x, y, z) => x * nn[0] + y * nn[1] + z * nn[2] - c;
}
export const neg = (f: PlaneFn): PlaneFn => (x, y, z) => -f(x, y, z);
