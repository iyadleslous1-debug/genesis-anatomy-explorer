/** Piece B: limb, girdle and pelvic bone shapes (SDF). */
import { V3, add, mul, sub, norm, cross, lerp, madd } from './math';
import {
  Shape, ellipsoid, capsule, roundCone, union, subtract, sphere, frameY, roundBox, chain, cylinder, torus,
  triangle, frameAxes, intersect,
} from './sdf';
import { sweep, bend, sm, bell, pw, ell, poly } from './b_bones';
import {
  shoulderJ, elbowJ, wristJ, armDir, foreDir, latOf, CLAVICLE, SCAPULA, handFrame, handPt, PELVIS, hipJ,
  ankleJ, footFrame, footPt, Side,
} from '../anatomy/rig';

const FWD: V3 = [0, 0, 1];
const fwdOf = (L: V3, d: V3, s: Side): V3 => {
  const F0 = norm(cross(L, d)).map((x) => x * s) as V3;
  return F0[2] < 0 ? mul(F0, -1) : F0;
};

// ---------------------------------------------------------------- clavicle
export function clavicleShape(s: Side): Shape {
  const C = CLAVICLE(s);
  const ctrl: V3[] = [C[0], [s * 0.05, 1.45, 0.0645], [s * 0.09, 1.4545, 0.052], [s * 0.13, 1.4585, 0.026], C[3]];
  return sweep(ctrl, [0, 1, 0], s, (t, c, sn) => {
    const af = 0.0056 - 0.0021 * sm(0.62, 0.95, t) + 0.003 * sm(0.14, 0, t);
    const al = 0.0062 + 0.0032 * sm(0.55, 1, t) + 0.0028 * sm(0.2, 0, t);
    return ell(af, al, c, sn) + 0.0012 * bell(t, 0.3, 0.1) * pw(-c, 3);
  }, 0.016, 36);
}

// ---------------------------------------------------------------- scapula
export function scapulaShape(s: Side): Shape {
  const S = SCAPULA(s);
  const spineMid: V3 = [s * 0.128, 1.426, -0.083];
  const bn = norm(cross(sub(S.inferior, S.superior), sub(S.neck, S.superior)));
  const n: V3 = bn[2] > 0 ? bn : mul(bn, -1); // toward the ribs (anterior)
  const cen: V3 = [(S.superior[0] + S.inferior[0] + S.neck[0]) / 3, (S.superior[1] + S.inferior[1] + S.neck[1]) / 3, (S.superior[2] + S.inferior[2] + S.neck[2]) / 3];
  const blade = union(
    [
      triangle(S.superior, S.inferior, S.neck, 0.0019),
      chain([S.superior, lerp(S.superior, S.inferior, 0.5), S.inferior], [0.0026, 0.0032, 0.0042], 0.002), // medial border
      chain([S.inferior, lerp(S.inferior, S.neck, 0.5), S.neck], [0.0042, 0.0046, 0.0058], 0.002), // lateral border
      chain([S.superior, lerp(S.superior, S.coracoidBase, 0.6), S.coracoidBase], [0.0026, 0.0024, 0.0036]),
    ],
    0.003,
  );
  // dish the blade so the costal face is concave
  const dished = bend(blade, cen, n, 0.55, 0.009);
  let sc = union(
    [
      dished,
      chain([S.spineRoot, spineMid, S.acromion], [0.003, 0.0052, 0.0052], 0.003),
      triangle(S.spineRoot, spineMid, lerp(S.superior, S.neck, 0.5), 0.0021),
      triangle(spineMid, S.acromion, lerp(S.superior, S.neck, 0.8), 0.0021),
      ellipsoid(add(S.acromion, [-s * 0.002, 0.001, 0.006]), [0.015, 0.0036, 0.0125], frameAxes([1, 0.15 * s, 0], [0, 1, 0])),
      ellipsoid(S.glenoid, [0.0048, 0.0175, 0.0125]),
      sphere(S.neck, 0.0072),
      chain([S.coracoidBase, [s * 0.14, 1.432, 0.0], S.coracoidTip], [0.0048, 0.0042, 0.0034], 0.002),
      sphere(add(S.coracoidTip, [0, -0.001, 0.002]), 0.0036),
      sphere(S.inferior, 0.0042),
    ],
    0.004,
  );
  const gdir = norm([s, 0.0, 0.35]);
  sc = subtract(sc, sphere(madd(S.glenoid, [gdir, 0.0045 + 0.026 - 0.0018]), 0.026), 0.002); // glenoid fossa
  sc = subtract(sc, sphere(lerp(S.superior, S.coracoidBase, 0.7), 0.0034), 0.0015); // suprascapular notch
  return sc;
}

// ---------------------------------------------------------------- humerus
export function humerusShape(s: Side): Shape {
  const sh = shoulderJ(s), el = elbowJ(s), d = armDir(s), L = latOf(s, d), Fw = fwdOf(L, d, s);
  const fr = frameY(d);
  const hc = lerp(sh, SCAPULA(s).glenoid, 0.3);
  const ml = frameY(L, d);
  const shaft = sweep(
    [madd(sh, [d, 0.014]), madd(sh, [d, 0.07], [L, 0.0005]), madd(el, [d, -0.07], [L, -0.001], [Fw, -0.0008]), madd(el, [d, -0.03])],
    Fw, s,
    (t, c, sn) => {
      const af = 0.0114 - 0.0046 * sm(0.55, 1, t) + 0.003 * sm(0.12, 0, t);
      const al = 0.0114 + 0.0036 * sm(0.62, 1, t) + 0.0035 * sm(0.14, 0, t);
      let R = ell(af, al, c, sn);
      R += 0.0022 * bell(t, 0.42, 0.11) * pw(0.95 * sn + 0.3 * c, 4); // deltoid tuberosity
      R += 0.0026 * sm(0.62, 0.95, t) * pw(Math.abs(sn), 6); // supracondylar ridges
      return R;
    },
    0.03, 36,
  );
  let h = union(
    [
      sphere(hc, 0.0215),
      ellipsoid(madd(sh, [L, 0.0155], [d, 0.017], [Fw, -0.004]), [0.0105, 0.0155, 0.0125], fr),
      ellipsoid(madd(sh, [Fw, 0.0155], [d, 0.014], [L, 0.0025]), [0.0072, 0.012, 0.0075], fr),
      shaft,
      ellipsoid(madd(el, [d, -0.014], [Fw, -0.0015]), [0.0225, 0.0115, 0.0082], frameAxes(L, d)),
      cylinder(madd(el, [L, -0.0065], [d, -0.002]), 0.0105, 0.0095, ml, 0.002), // trochlea
      sphere(madd(el, [L, 0.0125], [Fw, 0.002], [d, -0.003]), 0.0085), // capitulum
      ellipsoid(madd(el, [L, -0.0255], [d, -0.012]), [0.0045, 0.0095, 0.0078], frameAxes(L, d)),
      ellipsoid(madd(el, [L, 0.0222], [d, -0.0125]), [0.0036, 0.0068, 0.0062], frameAxes(L, d)),
    ],
    0.008,
  );
  h = subtract(h, torus(madd(el, [L, -0.0065], [d, -0.002]), 0.0106, 0.0022, ml), 0.0015); // trochlear groove
  h = subtract(h, sphere(madd(el, [d, -0.016], [Fw, -0.0105]), 0.0066), 0.003); // olecranon fossa
  h = subtract(h, sphere(madd(el, [d, -0.018], [Fw, 0.0105]), 0.0044), 0.003); // coronoid fossa
  h = subtract(h, capsule(madd(sh, [Fw, 0.0212], [L, 0.0075], [d, 0.012]), madd(sh, [Fw, 0.0135], [L, 0.0068], [d, 0.075]), 0.0027), 0.003); // bicipital groove
  return h;
}

// ---------------------------------------------------------------- radius / ulna
export function radiusShape(s: Side): Shape {
  const el = elbowJ(s), wr = wristJ(s), d = foreDir(s), L = latOf(s, d), Fw = fwdOf(L, d, s);
  const top = madd(el, [L, 0.013], [d, 0.012]);
  const bot = madd(wr, [L, 0.008], [d, -0.006]);
  const mid = madd(lerp(top, bot, 0.5), [L, 0.005]);
  const shaft = sweep([madd(top, [d, 0.026]), mid, madd(bot, [d, -0.026])], Fw, s, (t, c, sn) => {
    const af = 0.0062 + 0.0006 * sm(0.6, 1, t);
    const al = 0.0062 + 0.0045 * sm(0.55, 1, t);
    return ell(af, al, c, sn) + 0.0022 * pw(-sn, 5) * sm(0.05, 0.4, t); // interosseous crest (medial)
  }, 0.02, 36);
  let r = union(
    [
      cylinder(top, 0.0105, 0.0042, frameY(d), 0.0025),
      roundCone(madd(top, [d, 0.004]), madd(top, [d, 0.028]), 0.0057, 0.0062),
      ellipsoid(madd(top, [d, 0.036], [L, -0.0042], [Fw, -0.003]), [0.0048, 0.0072, 0.0052], frameY(d)), // radial tuberosity
      shaft,
      ellipsoid(madd(bot, [d, -0.005]), [0.0135, 0.0078, 0.0095], frameAxes(L, d)),
      sphere(madd(bot, [d, -0.009], [Fw, -0.0085]), 0.0029), // dorsal tubercle
      roundCone(madd(bot, [L, 0.0095]), madd(bot, [L, 0.0125], [d, 0.007]), 0.0042, 0.0022), // styloid
    ],
    0.005,
  );
  r = subtract(r, sphere(madd(top, [d, -0.0173]), 0.012), 0.002); // radial head dish
  r = subtract(r, sphere(madd(bot, [d, 0.0105]), 0.0095), 0.002); // carpal articular surface
  return r;
}

export function ulnaShape(s: Side): Shape {
  const el = elbowJ(s), wr = wristJ(s), d = foreDir(s), L = latOf(s, d), Fw = fwdOf(L, d, s);
  const olec = madd(el, [L, -0.008], [d, -0.012], [Fw, -0.012]);
  const notch = madd(el, [L, -0.007], [d, 0.002]);
  const bot = madd(wr, [L, -0.013], [d, -0.005]);
  const shaft = sweep(
    [madd(notch, [d, 0.022]), madd(lerp(notch, bot, 0.5), [L, -0.002]), madd(bot, [d, -0.012])],
    Fw, s,
    (t, c, sn) => poly([[Math.PI / 6, 0.0052 - 0.0014 * t], [(5 * Math.PI) / 6, 0.0052 - 0.0014 * t], [(3 * Math.PI) / 2, 0.0054 - 0.0016 * t]], 5, c, sn),
    0.02, 36,
  );
  let u = union(
    [
      roundCone(olec, madd(notch, [d, 0.012]), 0.0108, 0.0092),
      ellipsoid(madd(olec, [d, -0.003], [Fw, 0.003]), [0.0075, 0.007, 0.0075], frameY(d)),
      roundCone(madd(notch, [d, 0.004], [Fw, 0.004]), madd(notch, [d, 0.014], [Fw, 0.0095]), 0.0068, 0.0036), // coronoid process
      shaft,
      sphere(madd(bot, [d, -0.004]), 0.0062),
      roundCone(madd(bot, [d, -0.002], [L, -0.002]), madd(bot, [d, 0.008], [L, -0.0045]), 0.003, 0.0017), // styloid
    ],
    0.005,
  );
  u = subtract(u, sphere(madd(el, [L, -0.007], [d, 0.002], [Fw, 0.006]), 0.0108), 0.002); // trochlear notch
  u = subtract(u, sphere(madd(notch, [L, 0.0125], [d, 0.012], [Fw, 0.0015]), 0.0045), 0.002); // radial notch
  return u;
}

// ---------------------------------------------------------------- pelvis
export function hipBoneShape(s: Side): Shape {
  const p = PELVIS(s);
  const acet = hipJ(s);
  const acetC = add(acet, [-s * 0.012, 0.004, 0]);
  const top: V3 = add(acet, [-s * 0.012, 0.03, -0.01]);
  const wcen: V3 = [(p.crest[0] + p.asis[0] + p.psis[0]) / 3, (p.crest[1] + p.asis[1] + p.psis[1]) / 3, (p.crest[2] + p.asis[2] + p.psis[2]) / 3];
  const wing = union(
    [
      triangle(p.psis, p.crest, top, 0.0033),
      triangle(p.crest, p.asis, top, 0.0033),
      triangle(p.asis, p.aiis, top, 0.0032),
      triangle(p.psis, p.si, add(acet, [-s * 0.012, 0.025, -0.02]), 0.0036),
      chain([p.psis, p.crestBack, p.crest, [s * 0.1345, 1.04, 0.012], [s * 0.134, 1.035, 0.036], p.asis], [0.0052, 0.0064, 0.0062, 0.0058, 0.0056, 0.0058], 0.003),
      sphere([s * 0.139, 1.043, 0.0], 0.0048),
      sphere(p.aiis, 0.0052),
    ],
    0.005,
  );
  const wn: V3 = [-s, 0.12, 0.25]; // toward the pelvic cavity: iliac fossa becomes concave
  const wingB = bend(wing, wcen, wn, 1.3, 0.011);
  const A: V3 = add(acet, [-s * 0.01, -0.005, 0.02]);
  const Mid: V3 = [s * 0.025, 0.855, 0.04];
  const A2: V3 = add(acet, [-s * 0.01, -0.012, -0.018]);
  let h = union(
    [
      wingB,
      ellipsoid(acetC, [0.024, 0.03, 0.03]),
      roundCone(A, p.symphysis, 0.0083, 0.0072), // superior pubic ramus
      roundCone(p.symphysis, Mid, 0.0074, 0.0052),
      roundCone(Mid, p.ischialTub, 0.0052, 0.0092), // inferior ramus
      roundCone(A2, p.ischialTub, 0.0105, 0.0092), // ischium
      ellipsoid(p.ischialTub, [0.0105, 0.0085, 0.0115]),
      sphere(p.ischialSpine, 0.0042),
      triangle(p.si, p.ischialSpine, add(acet, [-s * 0.012, 0.0, -0.022]), 0.0034),
      chain([add(acet, [-s * 0.01, 0.0, -0.022]), p.ischialSpine, p.si], [0.0068, 0.0042, 0.0058], 0.004),
      ellipsoid(p.symphysis, [0.0042, 0.0125, 0.0075]),
      sphere(p.pubicTubercle, 0.0045),
      roundCone(p.pubicTubercle, add(p.symphysis, [-s * 0.0015, 0.003, 0.0005]), 0.0033, 0.0033), // pubic crest
    ],
    0.007,
  );
  h = subtract(h, sphere(acet, 0.0245), 0.002); // acetabulum
  h = subtract(h, sphere(add(acet, [-s * 0.0012, -0.019, 0.004]), 0.0075), 0.002); // acetabular notch
  // obturator foramen (clean oval hole)
  const cen: V3 = [(A[0] + p.symphysis[0] + Mid[0] + p.ischialTub[0] + A2[0]) / 5, (A[1] + p.symphysis[1] + Mid[1] + p.ischialTub[1] + A2[1]) / 5, (A[2] + p.symphysis[2] + Mid[2] + p.ischialTub[2] + A2[2]) / 5];
  const u = norm(sub(p.ischialTub, p.symphysis));
  const v0 = sub(A, Mid);
  const vv = norm(sub(v0, mul(u, u[0] * v0[0] + u[1] * v0[1] + u[2] * v0[2])));
  const w = norm(cross(u, vv));
  h = subtract(h, ellipsoid(cen, [0.0165, 0.0105, 0.04], [u, vv, w]), 0.002);
  // greater sciatic notch
  h = subtract(h, ellipsoid([s * 0.064, 0.948, -0.074], [0.026, 0.0155, 0.011]), 0.004);
  return h;
}

// ---------------------------------------------------------------- femur
export function femurShape(s: Side): Shape {
  const hj = hipJ(s);
  const neckEnd: V3 = [s * 0.121, 0.897, -0.003];
  const shaft = sweep(
    [[s * 0.123, 0.88, -0.004], [s * 0.119, 0.77, 0.005], [s * 0.109, 0.65, 0.007], [s * 0.101, 0.57, 0.0], [s * 0.098, 0.535, -0.006]],
    FWD, s,
    (t, c, sn) => {
      const af = 0.0128 + 0.0012 * Math.sin(Math.PI * t) + 0.004 * sm(0.78, 1, t);
      const al = 0.0122 + 0.0035 * sm(0.3, 0, t) + 0.0135 * sm(0.62, 1, t);
      return ell(af, al, c, sn) + 0.0026 * bell(t, 0.5, 0.26) * pw(-c, 5); // linea aspera
    },
    0.04, 48,
  );
  const neck = sweep([hj, lerp(hj, neckEnd, 0.5), neckEnd], FWD, s, (t, c, sn) => ell(0.0098 + 0.0027 * t, 0.0135 + 0.003 * t, c, sn), 0.03, 12);
  let f = union(
    [
      sphere(hj, 0.0235),
      neck,
      ellipsoid([s * 0.128, 0.905, -0.008], [0.0105, 0.022, 0.0165]), // greater trochanter
      roundCone([s * 0.108, 0.862, -0.012], [s * 0.106, 0.847, -0.019], 0.0075, 0.0055), // lesser trochanter
      capsule([s * 0.126, 0.9, -0.021], [s * 0.108, 0.862, -0.014], 0.0042), // intertrochanteric crest
      shaft,
      ellipsoid([s * 0.077, 0.508, -0.012], [0.0145, 0.021, 0.026]), // medial condyle
      ellipsoid([s * 0.116, 0.508, -0.012], [0.0145, 0.02, 0.025]), // lateral condyle
      ellipsoid([s * 0.096, 0.522, 0.014], [0.0225, 0.019, 0.0105]), // patellar surface
      sphere([s * 0.066, 0.53, -0.008], 0.0052), // adductor tubercle
      sphere([s * 0.128, 0.526, -0.01], 0.0055), // lateral epicondyle
    ],
    0.008,
  );
  f = subtract(f, sphere([s * 0.1195, 0.896, -0.017], 0.0048), 0.003); // trochanteric fossa
  f = subtract(f, capsule([s * 0.096, 0.494, -0.034], [s * 0.096, 0.5, 0.004], 0.0066), 0.004); // intercondylar notch
  f = subtract(f, capsule([s * 0.096, 0.55, 0.034], [s * 0.096, 0.5, 0.034], 0.0072), 0.004); // patellar groove
  f = subtract(f, sphere(add(hj, [-s * 0.008, -0.004, 0.0]), 0.0035), 0.002); // fovea
  return f;
}

export function patellaShape(s: Side): Shape {
  const c: V3 = [s * 0.097, 0.516, 0.04];
  const fr = frameAxes([1, 0, 0], [0, 1, -0.15]);
  let p = union([ellipsoid(add(c, [0, 0.004, 0]), [0.0215, 0.0175, 0.0092], fr), roundCone(add(c, [0, 0.006, 0]), add(c, [0, -0.022, -0.002]), 0.0125, 0.0028)], 0.006);
  p = subtract(p, capsule(add(c, [0, 0.03, -0.014]), add(c, [0, -0.03, -0.011]), 0.0048), 0.003); // posterior ridge facets
  return p;
}

// ---------------------------------------------------------------- tibia / fibula
export function tibiaShape(s: Side): Shape {
  const shaft = sweep(
    [[s * 0.094, 0.455, 0.002], [s * 0.092, 0.34, 0.005], [s * 0.087, 0.22, 0.004], [s * 0.084, 0.128, 0.0]],
    FWD, s,
    (t, c, sn) => {
      const h = 0.0092 - 0.0009 * Math.sin(Math.PI * Math.min(1, t * 1.2)) + 0.003 * sm(0.72, 1, t) + 0.004 * sm(0.14, 0, t);
      return poly([[Math.PI / 3, h], [-Math.PI / 3, h * 1.02], [Math.PI, h * 0.95]], 7 - 3.5 * sm(0.7, 1, t), c, sn);
    },
    0.04, 44,
  );
  let t = union(
    [
      ellipsoid([s * 0.0775, 0.4765, -0.004], [0.0185, 0.0132, 0.0272]), // medial condyle
      ellipsoid([s * 0.1135, 0.4765, -0.004], [0.017, 0.0132, 0.0252]), // lateral condyle
      roundCone([s * 0.095, 0.468, -0.004], [s * 0.093, 0.43, 0.003], 0.024, 0.0135),
      roundCone([s * 0.0925, 0.489, -0.004], [s * 0.0925, 0.4935, -0.004], 0.0032, 0.0022), // medial intercondylar tubercle
      roundCone([s * 0.0995, 0.489, -0.004], [s * 0.0995, 0.4935, -0.004], 0.0032, 0.0022), // lateral intercondylar tubercle
      ellipsoid([s * 0.097, 0.441, 0.026], [0.0098, 0.0165, 0.0085]), // tibial tuberosity
      sphere([s * 0.123, 0.452, 0.006], 0.0052), // Gerdy tubercle
      shaft,
      ellipsoid([s * 0.083, 0.099, -0.003], [0.0205, 0.0165, 0.0195]), // distal end
      roundCone([s * 0.074, 0.104, -0.004], [s * 0.067, 0.07, -0.004], 0.0095, 0.0066), // medial malleolus
    ],
    0.008,
  );
  t = subtract(t, sphere([s * 0.0775, 0.5085, -0.004], 0.0205), 0.002);
  t = subtract(t, sphere([s * 0.1135, 0.5075, -0.004], 0.0205), 0.002);
  t = subtract(t, sphere([s * 0.083, 0.0645, -0.004], 0.011), 0.002); // plafond
  return t;
}

export function fibulaShape(s: Side): Shape {
  const shaft = sweep(
    [[s * 0.1245, 0.452, -0.022], [s * 0.1205, 0.3, -0.02], [s * 0.1135, 0.15, -0.021], [s * 0.1125, 0.1, -0.024]],
    FWD, s,
    (t, c, sn) => {
      const th = Math.atan2(sn, c);
      return ell(0.0055 + 0.0008 * sm(0.5, 1, t), 0.0048 + 0.0028 * sm(0.55, 1, t), c, sn) * (1 + 0.2 * Math.cos(3 * th + 0.4));
    },
    0.02, 36,
  );
  return union(
    [
      ellipsoid([s * 0.1255, 0.467, -0.021], [0.0095, 0.0078, 0.0095]),
      roundCone([s * 0.1265, 0.47, -0.02], [s * 0.1275, 0.483, -0.019], 0.0042, 0.0022), // styloid
      shaft,
      ellipsoid([s * 0.1125, 0.076, -0.0235], [0.0052, 0.0185, 0.0115]), // lateral malleolus
      roundCone([s * 0.1125, 0.062, -0.0225], [s * 0.1125, 0.056, -0.023], 0.0042, 0.0028),
    ],
    0.006,
  );
}

// ---------------------------------------------------------------- hand
const unit = (v: V3) => norm(v);
export function carpalShape(s: Side, key: string): Shape {
  const { D, L } = handFrame(s);
  const Hf = frameAxes(L, D);
  const P = (h: number, l: number, n: number) => handPt(s, h, l, n);
  const rb = (h: number, l: number, n: number, hx: number, hy: number, hz: number, r: number) => roundBox(P(h, l, n), [hx, hy, hz], Hf, r);
  switch (key) {
    case 'scaphoid': {
      let b = union([roundCone(P(0.0055, 0.0045, 0.0005), P(0.0118, 0.0105, 0.0035), 0.0044, 0.0049), sphere(P(0.0125, 0.0118, 0.0068), 0.0029)], 0.003);
      b = subtract(b, sphere(P(0.0133, 0.0038, 0.0005), 0.0042), 0.0015);
      return b;
    }
    case 'lunate':
      return subtract(ellipsoid(P(0.007, 0, 0), [0.0058, 0.0052, 0.0058], Hf), sphere(P(0.0145, 0, 0), 0.0066), 0.0012);
    case 'triquetrum':
      return union([rb(0.0095, -0.0105, -0.001, 0.0034, 0.0028, 0.0034, 0.0016), sphere(P(0.0075, -0.009, -0.0015), 0.0034)], 0.0015);
    case 'pisiform':
      return ellipsoid(P(0.0105, -0.0145, 0.0062), [0.0034, 0.0038, 0.0034], Hf);
    case 'trapezium': {
      let b = union([rb(0.021, 0.0165, 0.0015, 0.0034, 0.0028, 0.0034, 0.0016), sphere(P(0.0225, 0.014, 0.0055), 0.0028)], 0.0015);
      b = subtract(b, ellipsoid(P(0.0245, 0.0215, 0.0025), [0.0032, 0.0034, 0.0028], Hf), 0.0012); // saddle
      return b;
    }
    case 'trapezoid':
      return rb(0.0215, 0.0075, 0, 0.0026, 0.0027, 0.0031, 0.0014);
    case 'capitate':
      return union([sphere(P(0.0155, -0.001, 0), 0.0047), rb(0.0215, -0.001, 0, 0.0034, 0.0036, 0.0034, 0.0016)], 0.002);
    default: // hamate
      return union([rb(0.0205, -0.0118, 0, 0.0037, 0.0042, 0.0037, 0.0014), roundCone(P(0.0205, -0.0112, 0.004), P(0.0225, -0.0096, 0.0092), 0.0029, 0.002)], 0.002);
  }
}

/** metacarpal / metatarsal: flared base, waisted shaft, rounded head */
export function metaShape(a: V3, b: V3, r: number, scale: number): Shape {
  const d = norm(sub(b, a));
  const side = unit(cross(d, Math.abs(d[2]) > 0.7 ? [0, 1, 0] : [0, 0, 1]));
  const R = r * scale;
  const m = lerp(a, b, 0.5);
  return union(
    [
      roundCone(add(a, mul(d, 0.0025)), m, R * 1.05, R * 0.62),
      roundCone(m, add(b, mul(d, -0.004)), R * 0.62, R * 0.82),
      ellipsoid(add(a, mul(d, 0.004)), [R * 1.15, R * 0.85, R * 1.0], frameY(d, side)),
      sphere(add(b, mul(d, -0.0036)), R * 0.98),
      sphere(add(add(b, mul(d, -0.0042)), mul(side, R * 0.45)), R * 0.7),
      sphere(add(add(b, mul(d, -0.0042)), mul(side, -R * 0.45)), R * 0.7),
    ],
    0.003,
  );
}

export function phalanxShape(a: V3, b: V3, scale: number, distal: boolean): Shape {
  const d = norm(sub(b, a));
  const side = unit(cross(d, Math.abs(d[2]) > 0.7 ? [0, 1, 0] : [0, 0, 1]));
  const r = 0.0039 * scale;
  const pa = add(a, mul(d, 0.0022));
  const pb = add(b, mul(d, distal ? -0.002 : -0.0026));
  const m = lerp(pa, pb, 0.5);
  if (distal) {
    return union(
      [
        roundCone(pa, m, r * 1.05, r * 0.7),
        roundCone(m, pb, r * 0.7, r * 0.45),
        ellipsoid(pb, [r * 0.95, r * 0.55, r * 0.55], frameY(d, side)),
        ellipsoid(add(pa, mul(d, 0.001)), [r * 1.1, r * 0.9, r * 0.95], frameY(d, side)),
      ],
      0.002,
    );
  }
  let p = union(
    [
      roundCone(pa, m, r * 1.02, r * 0.66),
      roundCone(m, pb, r * 0.66, r * 0.78),
      ellipsoid(add(pa, mul(d, 0.0012)), [r * 1.18, r * 0.95, r * 0.95], frameY(d, side)),
      sphere(add(add(pb, mul(d, -0.0014)), mul(side, r * 0.4)), r * 0.62),
      sphere(add(add(pb, mul(d, -0.0014)), mul(side, -r * 0.4)), r * 0.62),
    ],
    0.002,
  );
  p = subtract(p, sphere(add(a, mul(d, -r * 0.7)), r * 0.85), 0.0012);
  return p;
}

// ---------------------------------------------------------------- foot
export function tarsalShape(s: Side, key: string): Shape {
  const { L } = footFrame(s);
  const Ff = frameAxes(L, [0, 1, 0]);
  const FP = (f: number, l: number, y: number) => footPt(s, f, l, y);
  const ml = frameY(L, [0, 1, 0]);
  const cham = (c: V3, h: V3, r: number) => intersect(roundBox(c, h, Ff, r), ellipsoid(c, [h[0] * 1.5, h[1] * 1.5, h[2] * 1.5], Ff), 0.001);
  switch (key) {
    case 'talus': {
      let t = union(
        [
          ellipsoid(FP(0.003, 0, 0.0615), [0.0165, 0.0105, 0.02], Ff),
          cylinder(FP(0.003, 0, 0.0625), 0.0138, 0.0128, ml, 0.003),
          roundCone(FP(0.016, -0.004, 0.058), FP(0.034, -0.009, 0.05), 0.0095, 0.0088),
          sphere(FP(0.04, -0.0095, 0.0475), 0.0098),
          sphere(FP(0.003, 0.0125, 0.055), 0.0048),
          sphere(FP(-0.012, 0.0, 0.052), 0.0042),
        ],
        0.005,
      );
      t = subtract(t, torus(FP(0.003, 0, 0.0625), 0.0138, 0.0018, ml), 0.0015); // trochlear groove
      return t;
    }
    case 'calcaneus': {
      let c = union(
        [
          roundCone(FP(-0.046, 0.0005, 0.0225), FP(0.022, 0.001, 0.0295), 0.0155, 0.0098),
          ellipsoid(FP(-0.052, 0.0, 0.0165), [0.0135, 0.0185, 0.0125], Ff), // tuberosity
          ellipsoid(FP(-0.005, -0.0118, 0.0385), [0.011, 0.0042, 0.0058], Ff), // sustentaculum tali
          ellipsoid(FP(-0.004, 0.0, 0.0425), [0.0115, 0.0042, 0.0076], Ff), // posterior talar facet
          roundCone(FP(0.02, 0.0, 0.026), FP(0.039, 0.003, 0.0275), 0.0085, 0.0075), // anterior process
          sphere(FP(0.0, 0.0125, 0.0285), 0.0034), // peroneal trochlea
        ],
        0.006,
      );
      c = subtract(c, sphere(FP(-0.003, 0.0, 0.0365), 0.0058), 0.003); // sulcus calcanei
      const c0 = c; // flatten the plantar surface: nothing below y = 0.0068
      return { lo: [c0.lo[0], 0.0066, c0.lo[2]], hi: c0.hi, d: (x, y, z) => Math.max(c0.d(x, y, z), 0.0068 - y) };
    }
    case 'navicular': {
      const c = FP(0.047, -0.012, 0.046);
      let n = union([ellipsoid(c, [0.0125, 0.0098, 0.0055], Ff), sphere(FP(0.0475, -0.0215, 0.0405), 0.0044)], 0.003);
      n = subtract(n, sphere(FP(0.0395, -0.0095, 0.0475), 0.0098), 0.0015);
      return n;
    }
    case 'cuboid': {
      let c = cham(FP(0.053, 0.019, 0.027), [0.0072, 0.0066, 0.0092], 0.0022);
      c = union([c, sphere(FP(0.043, 0.0215, 0.0185), 0.0045)], 0.002);
      return subtract(c, capsule(FP(0.054, 0.0, 0.0155), FP(0.05, 0.03, 0.016), 0.0028), 0.002);
    }
    case 'cuneiform.medial': return cham(FP(0.064, -0.02, 0.036), [0.0048, 0.0088, 0.0068], 0.002);
    case 'cuneiform.intermediate': return cham(FP(0.061, -0.0075, 0.042), [0.004, 0.0066, 0.0055], 0.002);
    default: return cham(FP(0.062, 0.0045, 0.039), [0.0043, 0.007, 0.006], 0.002);
  }
}
export { ankleJ };
