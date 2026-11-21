export type V3 = [number, number, number];

export const v = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** a + b*s + c*t ... weighted sum helper */
export const madd = (a: V3, ...terms: [V3, number][]): V3 => {
  const r: V3 = [a[0], a[1], a[2]];
  for (const [d, s] of terms) {
    r[0] += d[0] * s;
    r[1] += d[1] * s;
    r[2] += d[2] * s;
  }
  return r;
};
export const mirror = (a: V3): V3 => [-a[0], a[1], a[2]];
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const mixn = (a: number, b: number, t: number) => a + (b - a) * t;

/** Orthonormalize b against a */
export const ortho = (a: V3, b: V3): V3 => norm(sub(b, mul(a, dot(a, b))));

/** Deterministic PRNG */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotate vector v around unit axis k by angle a (Rodrigues) */
export function rotAxis(vv: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kd = dot(k, vv);
  const kc = cross(k, vv);
  return [
    vv[0] * c + kc[0] * s + k[0] * kd * (1 - c),
    vv[1] * c + kc[1] * s + k[1] * kd * (1 - c),
    vv[2] * c + kc[2] * s + k[2] * kd * (1 - c),
  ];
}

/** Any unit vector perpendicular to d */
export function perp(d: V3): V3 {
  const h: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(d, h));
}

/** Centripetal-ish Catmull-Rom sampling through points, then arc-length resample to n points */
export function spline(points: V3[], n: number): V3[] {
  if (points.length < 2) return points.slice();
  const pts = [mul(sub(points[0], points[1]), 1) as V3, ...points];
  pts[0] = add(points[0], sub(points[0], points[1]));
  const last = points[points.length - 1];
  pts.push(add(last, sub(last, points[points.length - 2])));
  const dense: V3[] = [];
  const per = 24;
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t, t3 = t2 * t;
      const out: V3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        out[k] =
          0.5 *
          (2 * p1[k] +
            (-p0[k] + p2[k]) * t +
            (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
            (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      }
      dense.push(out);
    }
  }
  dense.push(last);
  // arc-length resample
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist(dense[i], dense[i - 1]));
  const total = cum[cum.length - 1];
  const res: V3[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    res.push(lerp(dense[j], dense[j + 1], (target - cum[j]) / seg));
  }
  return res;
}

export function pathLength(p: V3[]) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i], p[i - 1]);
  return l;
}
