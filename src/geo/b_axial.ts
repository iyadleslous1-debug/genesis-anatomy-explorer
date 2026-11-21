/** Piece B: skull, teeth, vertebrae, sternum (SDF). */
import { V3, add, mul, sub, norm, cross, lerp, madd } from './math';
import {
  Shape, ellipsoid, capsule, roundCone, union, subtract, sphere, roundBox, chain, cylinder, torus,
  hollow, PlaneFn, frameAxes, offset, triangle,
} from './sdf';
import { noise3 } from './noise';
import { bell } from './b_bones';
import { HEAD, VInfo, SIDES, Side, STERNUM } from '../anatomy/rig';

// ====================================================================== SKULL
let vaultCache: Shape | null = null;
export function craniumVault(): Shape {
  return (vaultCache ??= union(
    [
      ellipsoid([0, 1.669, -0.008], [0.0705, 0.084, 0.093]),
      ellipsoid([0, 1.652, -0.046], [0.064, 0.064, 0.06]),
      ellipsoid([0, 1.676, 0.038], [0.06, 0.062, 0.05]),
      ellipsoid([0, 1.628, -0.005], [0.062, 0.035, 0.06]),
    ],
    0.02,
  ));
}
export const brainSpaceShape = () => offset(craniumVault(), -0.0078);

/** project a point onto the shape surface */
function snap(sh: Shape, p: V3): V3 {
  let q: V3 = [p[0], p[1], p[2]];
  const e = 0.0005;
  for (let k = 0; k < 4; k++) {
    const d = sh.d(q[0], q[1], q[2]);
    const g = norm([sh.d(q[0] + e, q[1], q[2]) - sh.d(q[0] - e, q[1], q[2]), sh.d(q[0], q[1] + e, q[2]) - sh.d(q[0], q[1] - e, q[2]), sh.d(q[0], q[1], q[2] + e) - sh.d(q[0], q[1], q[2] - e)]);
    q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d];
  }
  return q;
}

/** raised ridge following a polyline lying on the surface */
function ridgeOn(a: Shape, pts: V3[], w: number, h: number): Shape {
  const n = pts.length - 1;
  return {
    d: (x, y, z) => {
      const d = a.d(x, y, z);
      if (Math.abs(d) > w * 3 + h) return d;
      let best = 1e9;
      for (let i = 0; i < n; i++) {
        const A = pts[i], B = pts[i + 1];
        const bx = B[0] - A[0], by = B[1] - A[1], bz = B[2] - A[2];
        const px = x - A[0], py = y - A[1], pz = z - A[2];
        let u = (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const dx = px - bx * u, dy = py - by * u, dz = pz - bz * u;
        const q = dx * dx + dy * dy + dz * dz;
        if (q < best) best = q;
      }
      return d - h * Math.exp(-best / (w * w));
    },
    lo: [a.lo[0] - h, a.lo[1] - h, a.lo[2] - h],
    hi: [a.hi[0] + h, a.hi[1] + h, a.hi[2] + h],
  };
}

const vaultPt = (phi: number, th: number): V3 => [0.0705 * Math.sin(phi) * Math.cos(th), 1.669 + 0.084 * Math.sin(th), -0.008 + 0.093 * Math.cos(phi) * Math.cos(th)];

function craniumOuter(): Shape {
  const vault = craniumVault();
  let c: Shape = hollow(vault, 0.0065);
  const parts: Shape[] = [c];
  // supraorbital ridges + glabella
  parts.push(sphere([0, 1.6695, 0.0915], 0.0052));
  for (const s of SIDES) {
    parts.push(chain([[s * 0.004, 1.6725, 0.0908], [s * 0.02, 1.6745, 0.0895], [s * 0.0375, 1.673, 0.0805], [s * 0.0485, 1.667, 0.0665]], [0.0036, 0.0036, 0.0036, 0.0034], 0.003));
    // orbital rim
    const ey = HEAD.eye(s);
    parts.push(torus([s * 0.0318, ey[1] + 0.001, 0.0866], 0.0206, 0.0028, frameAxes([1, 0, 0], norm([s * 0.3, 0, 1]))));
    // occipital condyles
    parts.push(ellipsoid([s * 0.0175, 1.5965, -0.037], [0.0042, 0.004, 0.0105]));
    // mastoid process, styloid process
    parts.push(roundCone([s * 0.056, 1.62, -0.022], [s * 0.0585, 1.5995, -0.0295], 0.0078, 0.0058));
    parts.push(roundCone([s * 0.0515, 1.604, -0.0205], [s * 0.0485, 1.578, -0.0115], 0.0021, 0.0011));
    // external acoustic meatus rim
    parts.push(torus([s * 0.0662, 1.632, -0.0085], 0.0056, 0.0022, frameAxes([0, 1, 0], [s, 0, 0])));
  }
  parts.push(sphere([0, 1.639, -0.1035], 0.0042)); // external occipital protuberance
  let sh = union(parts, 0.002);
  // temporal lines and superior nuchal line
  const surf = (pts: V3[]) => pts.map((p) => snap(vault, p));
  for (const s of SIDES) {
    const tl = surf([vaultPt(0.95, 0.1), vaultPt(1.2, 0.38), vaultPt(1.65, 0.52), vaultPt(2.15, 0.4), vaultPt(2.55, 0.14)]).map((p): V3 => [s * p[0], p[1], p[2]]);
    sh = ridgeOn(sh, tl, 0.0028, 0.0011);
  }
  const nl = surf([[0.07, 1.641, -0.07], [0.05, 1.643, -0.093], [0.0, 1.641, -0.104], [-0.05, 1.643, -0.093], [-0.07, 1.641, -0.07]]);
  sh = ridgeOn(sh, nl, 0.003, 0.0013);
  for (const s of SIDES) {
    sh = subtract(sh, sphere(add(HEAD.eye(s), [0, 0.001, 0.004]), 0.0195), 0.004);
    sh = subtract(sh, sphere([s * 0.0215, 1.6709, 0.0892], 0.0021), 0.0012); // supraorbital notch
    sh = subtract(sh, sphere([s * 0.0678, 1.632, -0.0085], 0.0042), 0.001); // meatus
    sh = subtract(sh, capsule([s * 0.0678, 1.632, -0.0085], [s * 0.056, 1.632, -0.0085], 0.0036), 0.001);
  }
  sh = subtract(sh, cylinder([0, 1.598, -0.03], 0.014, 0.02), 0.002); // foramen magnum
  sh = subtract(sh, ellipsoid([0, 1.625, 0.08], [0.012, 0.022, 0.03]), 0.003);
  return sh;
}
let craniumCache: Shape | null = null;
export const cranium = () => (craniumCache ??= craniumOuter());

/** make a suture plane jagged (same function is used by both neighbouring bones) */
const jag = (f: PlaneFn, k = 0): PlaneFn => (x, y, z) => f(x, y, z) + 0.0011 * noise3(x * 230 + k, y * 230, z * 230 + k) + 0.0007 * noise3(x * 90, y * 90 + k, z * 90);
export const frontalFn: PlaneFn = jag((x, y, z) => 0.012 + 0.3 * (1.752 - y) - z, 3);
export const occFn: PlaneFn = jag((x, y, z) => z - (-0.062 + 0.25 * (1.73 - y)), 7);
export const tempFn = (s: Side): PlaneFn => jag((x, y) => Math.max(y - 1.658, 0.048 - s * x), 11);
export const baseFn: PlaneFn = jag((x, y) => y - 1.622, 5);
export const sagFn = (s: Side): PlaneFn => jag((x) => -s * x, 13);
export const nf = (f: PlaneFn): PlaneFn => (x, y, z) => -f(x, y, z);

export function archTeeth(upper: 1 | 0, y: number, z0: number, dz = 0): V3[] {
  const res: V3[] = [];
  for (const s of SIDES)
    for (let i = 0; i < 8; i++) {
      const u = (i + 0.5) / 8;
      const x = s * (0.004 + 0.023 * Math.sin(Math.min(1, u * 1.5) * 1.3));
      const z = z0 - 0.044 * Math.pow(u, 1.35) - dz;
      res.push([x, y + (upper ? 0 : 0), z]);
    }
  return res;
}

export function maxilla(): Shape {
  let m = union(
    [
      ellipsoid([0, 1.598, 0.068], [0.034, 0.022, 0.027]),
      ellipsoid([0.026, 1.61, 0.062], [0.016, 0.017, 0.018]),
      ellipsoid([-0.026, 1.61, 0.062], [0.016, 0.017, 0.018]),
      roundCone([0.012, 1.615, 0.087], [0.009, 1.655, 0.087], 0.005, 0.0035),
      roundCone([-0.012, 1.615, 0.087], [-0.009, 1.655, 0.087], 0.005, 0.0035),
      ...archTeeth(1, 1.586, 0.083, 0.0068).map((p) => sphere(p, 0.0062)),
      roundCone([0, 1.6055, 0.0905], [0, 1.6045, 0.0975], 0.0028, 0.0011), // anterior nasal spine
      ...SIDES.map((s) => ellipsoid([s * 0.0265, 1.628, 0.0745], [0.011, 0.007, 0.009])), // infra-orbital margin
    ],
    0.008,
  );
  // pear-shaped nasal aperture (wide below, narrow above)
  const apert = union([ellipsoid([0, 1.6075, 0.083], [0.0128, 0.0095, 0.03]), ellipsoid([0, 1.626, 0.083], [0.0072, 0.0128, 0.03])], 0.004);
  m = subtract(m, apert, 0.002);
  for (const s of SIDES) {
    m = subtract(m, sphere(add(HEAD.eye(s), [0, 0.001, 0.004]), 0.0195), 0.003);
    m = subtract(m, capsule([s * 0.0285, 1.6205, 0.0825], [s * 0.0255, 1.6205, 0.07], 0.0014), 0.001); // infra-orbital foramen
  }
  m = subtract(m, ellipsoid([0, 1.6, 0.045], [0.026, 0.01, 0.03]), 0.004);
  return m;
}

export function zygomatic(s: Side): Shape {
  let z = union(
    [
      ellipsoid([s * 0.0478, 1.6285, 0.0615], [0.0145, 0.0125, 0.0105]),
      chain([[s * 0.0505, 1.6275, 0.0595], [s * 0.06, 1.6255, 0.0445], [s * 0.0655, 1.6245, 0.0255], [s * 0.0662, 1.6235, 0.0075], [s * 0.0635, 1.622, -0.0055]], [0.0042, 0.0037, 0.0033, 0.0034, 0.0038], 0.003),
      roundCone([s * 0.0465, 1.64, 0.0685], [s * 0.0505, 1.661, 0.0645], 0.0048, 0.0035),
      sphere([s * 0.0452, 1.6445, 0.0705], 0.0042),
    ],
    0.005,
  );
  z = subtract(z, sphere(add(HEAD.eye(s), [0, 0.001, 0.004]), 0.0195), 0.002);
  return z;
}

export function mandible(): Shape {
  const parts: Shape[] = [];
  for (const s of SIDES) {
    parts.push(chain([HEAD.jawAngle(s), [s * 0.036, 1.548, 0.044], [s * 0.012, 1.539, 0.068]], [0.0062, 0.0058, 0.006], 0.004));
    parts.push(chain([[s * 0.046, 1.584, 0.012], [s * 0.033, 1.572, 0.05], [s * 0.01, 1.567, 0.074]], [0.0048, 0.0048, 0.0046], 0.004));
    parts.push(triangle(HEAD.jawAngle(s), [s * 0.046, 1.584, 0.012], [s * 0.036, 1.55, 0.044], 0.003));
    parts.push(triangle([s * 0.046, 1.584, 0.012], [s * 0.033, 1.572, 0.05], [s * 0.036, 1.55, 0.044], 0.003));
    parts.push(chain([HEAD.jawAngle(s), [s * 0.052, 1.592, -0.008], [s * 0.0525, 1.603, -0.0105]], [0.0062, 0.005, 0.0042], 0.004));
    parts.push(roundCone([s * 0.0525, 1.603, -0.0105], HEAD.condyle(s), 0.0042, 0.0036)); // condylar neck
    parts.push(ellipsoid(HEAD.condyle(s), [0.0085, 0.0046, 0.0052])); // condyle
    parts.push(roundCone([s * 0.049, 1.588, 0.002], [s * 0.0462, 1.6075, 0.0225], 0.0052, 0.0027)); // coronoid
    parts.push(triangle([s * 0.052, 1.592, -0.008], [s * 0.0462, 1.6075, 0.0225], [s * 0.047, 1.585, 0.01], 0.0025));
    parts.push(sphere([s * 0.051, 1.576, -0.0005], 0.0066)); // angle
  }
  parts.push(chain([[-0.012, 1.539, 0.068], [0, 1.538, 0.072], [0.012, 1.539, 0.068]], [0.006, 0.0068, 0.006]));
  parts.push(chain([[-0.01, 1.567, 0.074], [0, 1.566, 0.077], [0.01, 1.567, 0.074]], [0.0046, 0.0046, 0.0046]));
  parts.push(ellipsoid([0, 1.548, 0.0745], [0.0125, 0.0125, 0.0052])); // chin
  parts.push(...[1, -1].map((s) => sphere([s * 0.0105, 1.5405, 0.0775], 0.0032))); // mental tubercles
  // alveolar arch around the lower tooth roots
  for (const s of SIDES) {
    const pts = archTeeth(0, 1.5668, 0.0805).filter((p) => Math.sign(p[0]) === s);
    parts.push(chain(pts, pts.map(() => 0.0046), 0.003));
  }
  let m = union(parts, 0.005);
  for (const s of SIDES) {
    m = subtract(m, sphere([s * 0.0498, 1.6075, 0.0075], 0.0062), 0.002); // mandibular notch
    m = subtract(m, capsule([s * 0.0285, 1.5575, 0.0585], [s * 0.0255, 1.557, 0.0525], 0.0016), 0.001); // mental foramen
    m = subtract(m, sphere([s * 0.0468, 1.5845, 0.0145], 0.0022), 0.001); // mandibular foramen region dimple
  }
  return m;
}

export function hyoid(): Shape {
  const pts = (s: Side): V3[] => [[s * 0.026, 1.5475, 0.0105], [s * 0.015, 1.5485, 0.029], [s * 0.006, 1.5495, 0.0355]];
  return union(
    [
      ...SIDES.map((s) => chain(pts(s), [0.0016, 0.0024, 0.0034])),
      roundBox([0, 1.5495, 0.0372], [0.0075, 0.0034, 0.0016], undefined, 0.0014),
      ...SIDES.map((s) => roundCone([s * 0.008, 1.55, 0.034], [s * 0.0105, 1.558, 0.0295], 0.0019, 0.0012)),
    ],
    0.002,
  );
}

// ====================================================================== TEETH
function tooth(i: number, p: V3, upper: boolean, tan: V3): Shape {
  const dir = upper ? 1 : -1;
  const up: V3 = [0, dir, 0];
  const bv = norm(cross(tan, up));
  const fr = frameAxes(tan, up);
  const w = i === 0 ? 0.0043 : i === 1 ? 0.0036 : i === 2 ? 0.0039 : i < 5 ? 0.0034 : 0.0051;
  const th = i < 2 ? 0.0028 : i === 2 ? 0.0042 : i < 5 ? 0.0045 : 0.005;
  const hc = i < 2 ? 0.0078 : i === 2 ? 0.0088 : i < 5 ? 0.0066 : 0.0058;
  const base = madd(p, [up, 0.0042]);
  const edge = madd(p, [up, 0.0042 - hc]);
  const mid = lerp(base, edge, 0.5);
  const list: Shape[] = [];
  const rootTip = madd(p, [up, i === 2 ? 0.0225 : i < 2 ? 0.0165 : 0.0155]);
  if (i < 2) {
    list.push(roundBox(mid, [w * 0.88, hc / 2 - 0.0009, th * 0.5], fr, 0.0009));
    list.push(ellipsoid(madd(base, [up, -0.0006], [bv, -0.0006]), [w * 0.7, 0.0022, th * 0.8], fr));
  } else if (i === 2) {
    list.push(roundCone(base, edge, w * 0.95, 0.0007));
    list.push(ellipsoid(mid, [w * 0.95, hc * 0.42, th * 0.85], fr));
  } else if (i < 5) {
    list.push(ellipsoid(mid, [w, hc / 2, th], fr));
    for (const sg of [1, -1]) list.push(sphere(madd(edge, [bv, sg * th * 0.52], [up, 0.0006]), 0.0021));
  } else {
    list.push(roundBox(mid, [w * 0.86, hc / 2 - 0.0012, th * 0.86], fr, 0.0014));
    for (const a of [1, -1]) for (const b of [1, -1]) list.push(sphere(madd(edge, [tan, a * w * 0.5], [bv, b * th * 0.5], [up, 0.0008]), 0.0023));
  }
  const crown = union(list, 0.0007);
  const cr = i >= 5 ? subtract(crown, sphere(madd(edge, [up, -0.0008]), 0.0017), 0.0007) : crown;
  const roots: Shape[] = [];
  if (i < 5) roots.push(roundCone(madd(base, [up, 0.0006]), rootTip, w * 0.72, 0.0009));
  else {
    const n = upper ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const o = n === 2 ? (k === 0 ? -1 : 1) : [-1, 1, 0][k];
      const ob = n === 3 && k === 2 ? -1 : 0.5;
      roots.push(roundCone(madd(base, [tan, o * w * 0.45], [bv, (n === 3 ? (k === 2 ? -1 : 1) : 0) * th * 0.35]), madd(rootTip, [tan, o * w * 0.75], [bv, ob * 0.0]), w * 0.42, 0.0009));
    }
  }
  return union([cr, ...roots], 0.0009);
}

export function teeth(upper: boolean): Shape {
  const pts = archTeeth(upper ? 1 : 0, 1.578, upper ? 0.0835 : 0.0805);
  const list: Shape[] = [];
  pts.forEach((p, k) => {
    const i = k % 8, sideBase = k - i;
    const a = pts[sideBase + Math.max(0, i - 1)], b = pts[sideBase + Math.min(7, i + 1)];
    let tan = norm([b[0] - a[0], 0, b[2] - a[2]]);
    if (i === 0) tan = norm([p[0] > 0 ? 1 : -1, 0, 0.12 * (p[0] > 0 ? 1 : -1) * 0]);
    list.push(tooth(i, p, upper, tan));
  });
  return union(list, 0.0006);
}

// ====================================================================== VERTEBRAE
/** vertebral body with concave sides, raised rims and slight posterior kidney notch */
function vBody(v: VInfo): Shape {
  const L = v.lat, U = v.up, Fw = v.fwd, c = v.c;
  const Wl = v.bodyR * (v.region === 'C' ? 1.3 : 1.14), Dp = v.bodyR * 0.84, hh = v.bodyH / 2;
  const ext = Math.max(Wl, Dp, hh) + 0.005;
  const rr = Math.min(0.0016, hh * 0.45);
  const wd = Math.min(Wl, Dp);
  return {
    lo: [c[0] - ext, c[1] - ext, c[2] - ext],
    hi: [c[0] + ext, c[1] + ext, c[2] + ext],
    d: (x, y, z) => {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const a = px * L[0] + py * L[1] + pz * L[2];
      const b = px * U[0] + py * U[1] + pz * U[2];
      const f = px * Fw[0] + py * Fw[1] + pz * Fw[2];
      const tb = Math.min(1, Math.abs(b) / hh);
      const sc = 1 - 0.1 * (1 - tb * tb) + 0.025 * bell(tb, 1, 0.16);
      let rad = Math.hypot(a / Wl, f / Dp);
      if (f < 0) rad *= 1 + 0.12 * Math.exp(-((a / (Wl * 0.55)) ** 2)) * Math.min(1, -f / Dp * 2); // posterior concavity
      const dr = (rad - sc) * wd + rr;
      const dy = Math.abs(b) - hh + rr;
      return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) - rr;
    },
  };
}

function atlas(v: VInfo): Shape {
  const L = v.lat, U = v.up, Fw = v.fwd;
  const p = (a: number, b: number, c: number): V3 => add(add(add(v.c, mul(L, a)), mul(U, b)), mul(Fw, c));
  const frame = frameAxes(L, U);
  const cr = v.canalR;
  const parts: Shape[] = [
    torus(p(0, 0, -cr * 1.1), cr * 1.45 + 0.0023, 0.0025, frame),
    sphere(p(0, 0, -cr * 2.6), 0.0032), // posterior tubercle
    ellipsoid(p(0, 0, 0.0072), [0.0058, 0.0042, 0.0032], frame), // anterior arch
    sphere(p(0, 0, 0.0095), 0.0022), // anterior tubercle
  ];
  for (const sd of [1, -1]) {
    parts.push(ellipsoid(p(sd * 0.0155, 0, 0.0015), [0.0072, 0.0058, 0.0092], frame)); // lateral mass
    parts.push(roundCone(p(sd * 0.0165, 0, -0.002), p(sd * 0.0345, -0.001, -0.003), 0.0036, 0.0026)); // transverse process
  }
  let sh = union(parts, 0.0025);
  sh = subtract(sh, cylinder(p(0, 0, -cr * 1.1), cr * 1.45, 0.04, frame), 0.0012);
  for (const sd of [1, -1]) {
    sh = subtract(sh, capsule(p(sd * 0.0305, -0.01, -0.003), p(sd * 0.0305, 0.01, -0.003), 0.0021)); // transverse foramen
    sh = subtract(sh, sphere(p(sd * 0.0155, H(v) * 0.75 + 0.0036, 0.0015), 0.0058), 0.002); // superior facet dish
  }
  sh = subtract(sh, ellipsoid(p(0, 0, 0.0052), [0.0042, 0.0036, 0.0028], frame), 0.001); // dens facet
  return sh;
}
const H = (v: VInfo) => v.bodyH;

export function vertebraShape(v: VInfo): Shape {
  if (v.name === 'C1') return atlas(v);
  const L = v.lat, U = v.up, Fw = v.fwd;
  const p = (a: number, b: number, c: number): V3 => add(add(add(v.c, mul(L, a)), mul(U, b)), mul(Fw, c));
  const frame = frameAxes(L, U);
  const R = v.bodyR, Hh = v.bodyH, cr = v.canalR;
  const Dp = R * 0.84;
  const archR = v.region === 'C' ? 0.0021 : v.region === 'T' ? 0.0026 : 0.0034;
  const K = p(0, 0, -(Dp + cr));
  const parts: Shape[] = [vBody(v)];
  const back = p(0, 0, -(Dp + 2 * cr + archR * 1.2));
  for (const sd of [1, -1]) {
    const ped0 = p(sd * (cr + archR * 0.4), 0, -Dp * 0.55);
    const ped1 = p(sd * (cr + archR * 0.8), 0, -(Dp + cr * 0.9));
    parts.push(capsule(ped0, ped1, archR * 1.05)); // pedicle
    const lam = lerp(ped1, back, 0.55);
    parts.push(ellipsoid(lam, [cr * 0.62, Hh * 0.62, archR * 1.15], frame)); // lamina plate
    parts.push(roundCone(ped1, add(back, mul(L, sd * archR * 0.3)), archR * 1.05, archR * 1.0));
    // articular processes
    if (v.region === 'C') {
      parts.push(ellipsoid(p(sd * (cr + 0.0085), 0, -(Dp + cr * 0.9)), [0.0034, Hh * 0.8, 0.0042], frame));
      parts.push(ellipsoid(p(sd * (R * 1.05), Hh / 2, 0), [0.0032, 0.0018, 0.0042], frame)); // uncinate lip
    } else {
      parts.push(ellipsoid(p(sd * (cr + archR * 0.9 + (v.region === 'L' ? 0.0018 : 0)), Hh * 0.62 + 0.0012, -(Dp + cr * 1.0)), [0.0027, 0.0046, 0.0033], frame));
      parts.push(ellipsoid(p(sd * (cr + archR * 0.9 + (v.region === 'L' ? 0.0018 : 0) - 0.0004), -Hh * 0.62 - 0.0014, -(Dp + cr * 1.5)), [0.0026, 0.0042, 0.0032], frame));
    }
    // transverse process
    let tip: V3, tr = 0.0025;
    const base = p(sd * (cr + archR * 0.9), 0, -(Dp + cr * 0.9));
    if (v.region === 'C') { tip = p(sd * 0.0245, -0.0012, 0.0015); tr = 0.0026; }
    else if (v.region === 'T') { tip = p(sd * (0.03 - Math.max(0, v.n - 9) * 0.0045), 0.0015, -(Dp + cr) - 0.0085); tr = 0.003; }
    else { tip = p(sd * 0.039, 0.0005, -(Dp + cr) + 0.0012); tr = 0.0023; }
    parts.push(roundCone(base, tip, tr * 1.3, tr));
    if (v.region === 'T') parts.push(sphere(tip, 0.0034));
    if (v.region === 'T' && v.n <= 10) parts.push(sphere(p(sd * (R * 0.95), Hh * 0.38, -R * 0.35), 0.0026)); // costal facet
    if (v.region === 'L') parts.push(sphere(p(sd * (cr + 0.011), Hh * 0.55, -(Dp + cr) - 0.002), 0.0018)); // mammillary
    if (v.region === 'C') parts.push(sphere(p(sd * 0.0245, 0.0006, 0.0028), 0.0021)); // anterior tubercle
  }
  // spinous process
  let spLen = 0.012, spDrop = 0.004, spR = 0.0026;
  if (v.region === 'C' && v.n === 7) { spLen = 0.022; spDrop = 0.006; spR = 0.0032; }
  if (v.region === 'T') { spLen = 0.026 - Math.abs(v.n - 7) * 0.0008; spDrop = v.n < 3 ? 0.01 : v.n > 10 ? 0.006 : 0.019; spR = 0.0029; }
  if (v.region === 'L') { spLen = 0.021; spDrop = 0.002; spR = 0.0036; }
  const tip = add(back, add(mul(Fw, -spLen), mul(U, -spDrop)));
  if (v.region === 'L') {
    const mid = lerp(back, tip, 0.55);
    parts.push(ellipsoid(add(mid, mul(U, 0.0006)), [0.0026, 0.0088, spLen * 0.52], frameAxes(L, add(mul(U, 1), mul(Fw, -0.1)))));
  } else {
    parts.push(roundCone(back, tip, spR, spR * 0.8));
    if (v.region === 'C' && v.n < 7) {
      parts.push(sphere(add(tip, mul(L, 0.0028)), spR * 0.85));
      parts.push(sphere(add(tip, mul(L, -0.0028)), spR * 0.85));
    } else parts.push(sphere(tip, spR * 0.95));
  }
  if (v.name === 'C2') {
    parts.push(roundCone(p(0, Hh / 2 - 0.002, 0.0006), p(0, Hh / 2 + 0.0145, 0.0006), 0.0046, 0.0036)); // dens
    parts.push(ellipsoid(p(0, Hh / 2 + 0.001, 0), [R * 1.2, 0.0035, R * 0.7], frame)); // superior articular surfaces
  }
  let sh = union(parts, 0.0022);
  sh = subtract(sh, cylinder(K, cr, 0.04, frame), 0.0012); // vertebral canal
  if (v.region === 'C') for (const sd of [1, -1]) sh = subtract(sh, capsule(p(sd * 0.0188, -0.01, -0.001), p(sd * 0.0188, 0.01, -0.001), 0.0021)); // transverse foramina
  return sh;
}

// ====================================================================== STERNUM
export function sternumShape(): Shape {
  const tilt = norm(sub(STERNUM.top, STERNUM.bottom));
  const fr = frameAxes([1, 0, 0], tilt);
  const parts: Shape[] = [
    roundBox(lerp(STERNUM.top, STERNUM.angle, 0.45), [0.0205, 0.0165, 0.0034], fr, 0.0042),
    roundBox(lerp(STERNUM.angle, STERNUM.bottom, 0.5), [0.0112, 0.0745, 0.0026], fr, 0.0042),
    capsule(add(STERNUM.angle, [-0.0105, 0, 0.0018]), add(STERNUM.angle, [0.0105, 0, 0.0018]), 0.0028), // sternal angle
    ellipsoid(lerp(STERNUM.bottom, STERNUM.xiphoid, 0.5), [0.0058, 0.0145, 0.0021], fr), // xiphoid
    roundCone(add(STERNUM.xiphoid, [0, 0.002, -0.0005]), add(STERNUM.xiphoid, [0, -0.006, -0.002]), 0.0022, 0.0012),
    ...SIDES.map((s) => ellipsoid([s * 0.0235, 1.4415, 0.0675], [0.0072, 0.0058, 0.0042])), // clavicular notches' lips
  ];
  let st = union(parts, 0.005);
  st = subtract(st, sphere([0, 1.4505, 0.0715], 0.0085), 0.003); // jugular notch
  for (const s of SIDES) {
    st = subtract(st, ellipsoid([s * 0.0215, 1.4405, 0.0705], [0.0033, 0.0058, 0.0042]), 0.002); // clavicular notch
    for (const y of [1.432, 1.4, 1.37, 1.336, 1.302, 1.27]) {
      const t = (STERNUM.top[1] - y) / (STERNUM.top[1] - STERNUM.bottom[1]);
      const c = lerp(STERNUM.top, STERNUM.bottom, t);
      st = subtract(st, sphere([s * (y > 1.41 ? 0.0225 : 0.0122), y, c[2] - 0.0006], 0.0027), 0.0015); // costal notches
    }
  }
  return st;
}

export function ribKnobs(s: Side, head: V3, tuber: V3): Shape {
  const hd = madd(head, [[s, 0, 0], -0.002]);
  return union(
    [
      ellipsoid(hd, [0.0042, 0.0042, 0.0048]),
      roundCone(hd, tuber, 0.0034, 0.0042),
      ellipsoid(add(tuber, [s * 0.0008, 0, -0.0012]), [0.0045, 0.0042, 0.0048]),
    ],
    0.002,
  );
}
