import { V3, add, mul, sub, norm, lerp, cross, dot, spline, dist } from '../geo/math';
import {
  Shape, ellipsoid, capsule, roundCone, union, subtract, sphere, frameY, roundBox, chain, cylinder, torus,
  triangle, hollow, region, PlaneFn, splineTube, frameAxes, intersect, plane, offset,
} from '../geo/sdf';
import { meshShape } from '../geo/mesher';
import { tube, merge } from '../geo/tube';
import { G, P, Tissue } from './registry';
import {
  HEAD, VERTEBRAE, VInfo, SACRUM, STERNUM, sternumAt, shoulderJ, elbowJ, wristJ, armDir, foreDir, latOf,
  CLAVICLE, SCAPULA, handFrame, handPt, FINGERS, fingerJoints, metacarpalBase, thumbJoints, PELVIS, hipJ, kneeJ,
  ankleJ, footFrame, footPt, TOES, toeJoints, metatarsalBase, Side, SIDES, sideName, sid,
} from './rig';
import { autoCell, ORD, lc } from './util';
import { rough } from '../geo/b_bones';
import {
  craniumVault, cranium, frontalFn, occFn, tempFn, baseFn, sagFn, nf as n, maxilla, zygomatic, mandible, teeth, hyoid,
  vertebraShape, sternumShape, ribKnobs,
} from '../geo/b_axial';
import {
  clavicleShape, scapulaShape, humerusShape, radiusShape, ulnaShape, hipBoneShape, femurShape, patellaShape, tibiaShape,
  fibulaShape, carpalShape, tarsalShape, metaShape, phalanxShape,
} from '../geo/b_limbs';

export const brainSpace = () => offset(craniumVault(), -0.0078);
const GAP = 0.0007;
const CARPALS: { key: string; name: string; desc: string }[] = [
  { key: 'scaphoid', name: 'Scaphoid', desc: 'Boat-shaped proximal carpal bone on the thumb side; the most commonly fractured carpal bone.' },
  { key: 'lunate', name: 'Lunate', desc: 'Crescent-shaped proximal carpal bone articulating with the radius.' },
  { key: 'triquetrum', name: 'Triquetrum', desc: 'Pyramidal proximal carpal bone on the ulnar side.' },
  { key: 'pisiform', name: 'Pisiform', desc: 'Pea-shaped sesamoid carpal bone within the flexor carpi ulnaris tendon.' },
  { key: 'trapezium', name: 'Trapezium', desc: 'Distal carpal bone forming the saddle joint with the thumb metacarpal.' },
  { key: 'trapezoid', name: 'Trapezoid', desc: 'Small wedge-shaped distal carpal bone.' },
  { key: 'capitate', name: 'Capitate', desc: 'The largest carpal bone, at the centre of the wrist.' },
  { key: 'hamate', name: 'Hamate', desc: 'Wedge-shaped distal carpal bone with a hook-like process (hamulus).' },
];
const TARSALS = (s: Side): { key: string; name: string; shape: () => Shape; desc: string }[] => [
  { key: 'talus', name: 'Talus', desc: 'The ankle bone that transmits body weight from the tibia to the foot; it has no muscle attachments.' },
  { key: 'calcaneus', name: 'Calcaneus', desc: 'The heel bone: the largest tarsal bone, anchoring the calcaneal (Achilles) tendon, with a sustentaculum tali supporting the talus.' },
  { key: 'navicular', name: 'Navicular', desc: 'Boat-shaped tarsal bone on the medial side of the foot, between talus and cuneiforms.' },
  { key: 'cuboid', name: 'Cuboid', desc: 'Cube-shaped tarsal bone on the lateral side of the foot.' },
  { key: 'cuneiform.medial', name: 'Medial cuneiform', desc: 'Largest of the three wedge-shaped cuneiform bones, articulating with the first metatarsal.' },
  { key: 'cuneiform.intermediate', name: 'Intermediate cuneiform', desc: 'The smallest cuneiform bone, articulating with the second metatarsal.' },
  { key: 'cuneiform.lateral', name: 'Lateral cuneiform', desc: 'Wedge-shaped bone articulating with the third metatarsal and the cuboid.' },
].map((o) => ({ ...o, shape: () => tarsalShape(s, o.key) }));

const SYS = 'skeletal' as const;

function bone(id: string, name: string, parent: string, shape: () => Shape, desc: string, opts: { div?: number; min?: number; max?: number; tissue?: Tissue } = {}) {
  P({
    id, name, parent, system: SYS, tissue: opts.tissue ?? 'bone', desc,
    build: () => {
      const s = rough(shape());
      return meshShape(s, autoCell(s, (opts.div ?? 70) * 0.72, (opts.min ?? 0.0007) * 1.3, opts.max ?? 0.003));
    },
  });
}

function discShape(a: VInfo, b: VInfo): Shape {
  const ca = add(a.c, mul(a.up, -a.bodyH / 2));
  const cb = add(b.c, mul(b.up, b.bodyH / 2));
  const c = lerp(ca, cb, 0.5);
  const up = norm(sub(ca, cb));
  const h = Math.max(0.0012, dist(ca, cb) / 2 + 0.0004);
  const R = (a.bodyR + b.bodyR) / 2;
  return cylinder(c, R * 1.08, h, frameAxes(a.lat, up), Math.min(0.0012, h * 0.6), R * 0.8);
}

function sacrumShape(): Shape {
  const pts = spline([SACRUM.top, [0, 0.985, -0.058], [0, 0.957, -0.074], SACRUM.bottom], 5);
  const w = [0.046, 0.038, 0.029, 0.02, 0.012];
  const parts: Shape[] = pts.map((p, i) => ellipsoid(p, [w[i], 0.012, 0.017 - i * 0.002]));
  for (const s of SIDES) {
    parts.push(ellipsoid([s * 0.036, 0.998, -0.052], [0.022, 0.02, 0.016]));
    parts.push(ellipsoid(PELVIS(s).si, [0.007, 0.022, 0.012]));
  }
  parts.push(chain(pts.map((p) => add(p, [0, 0, -0.016])), [0.003, 0.003, 0.0028, 0.0025, 0.002]));
  let sh = union(parts, 0.01);
  sh = subtract(sh, chain(pts.slice(0, 4).map((p) => add(p, [0, 0, -0.006])), [0.0055, 0.005, 0.004, 0.0035]), 0.002);
  for (let i = 0; i < 4; i++) {
    const p = lerp(pts[i], pts[i + 1], 0.5);
    for (const s of SIDES) sh = subtract(sh, capsule(add(p, [s * 0.014, 0, 0.03]), add(p, [s * 0.014, 0, -0.03]), 0.0028 - i * 0.0003));
  }
  return sh;
}

function coccyxShape(): Shape {
  const pts: V3[] = [[0, 0.926, -0.09], [0, 0.918, -0.089], [0, 0.911, -0.086], [0, 0.905, -0.081]];
  return union(pts.map((p, i) => ellipsoid(p, [0.009 - i * 0.0018, 0.0035, 0.004 - i * 0.0005])), 0.002);
}

const STERNAL_Y = [1.432, 1.4, 1.37, 1.336, 1.302, 1.27, 1.248];
const RIB_W = [0.056, 0.085, 0.104, 0.118, 0.128, 0.135, 0.139, 0.14, 0.138, 0.131, 0.117, 0.095];

/** Returns [bonePath, cartilagePath | null] */
export function ribPaths(s: Side, i: number): [V3[], V3[] | null] {
  const v = VERTEBRAE[6 + i];
  const W = RIB_W[i - 1];
  const yP = v.c[1] + 0.004;
  const zT = v.c[2];
  const zb = zT - 0.046;
  const trueRib = i <= 7;
  const floating = i >= 11;
  const yEnd = trueRib ? STERNAL_Y[i - 1] : floating ? yP - 0.055 : [1.208, 1.17, 1.135][i - 8];
  const zf = trueRib ? sternumAt(yEnd)[2] + 0.004 : i <= 10 ? 0.1 - (i - 8) * 0.012 : 0.05;
  const zc = (zf + zb) / 2, Dz = (zf - zb) / 2;
  const phiCart = trueRib ? 0.1 * Math.PI : floating ? (i === 11 ? 0.5 : 0.62) * Math.PI : [0.2, 0.25, 0.3][i - 8] * Math.PI;
  const phiBone = trueRib ? (0.33 - i * 0.008) * Math.PI : floating ? phiCart : (0.38 + (i - 8) * 0.02) * Math.PI;
  const phi0 = 0.86 * Math.PI;
  const yAt = (phi: number) => yP - (yP - yEnd) * Math.pow((phi0 - phi) / (phi0 - phiCart), 1.35);
  const ell = (phi: number): V3 => [s * W * Math.sin(phi), yAt(phi), zc + Dz * Math.cos(phi)];
  const head: V3 = [s * 0.016, yP + 0.002, zT - v.bodyR * 0.5];
  const tuber: V3 = [s * 0.033, yP + 0.001, zT - v.bodyR - 0.013];
  const bone: V3[] = [head, tuber];
  const steps = 9;
  for (let k = 0; k <= steps; k++) bone.push(ell(phi0 + (phiBone - phi0) * (k / steps)));
  if (floating) return [bone, null];
  const cart: V3[] = [];
  for (let k = 0; k <= 5; k++) cart.push(ell(phiBone + (phiCart - phiBone) * (k / 5)));
  if (trueRib) cart.push([s * (i === 1 ? 0.024 : 0.017), yEnd, sternumAt(yEnd)[2] - 0.003]);
  else {
    const prevY = STERNAL_Y[6] - 0.02 - (i - 8) * 0.012;
    cart.push([s * (0.04 + (i - 8) * 0.012), prevY, 0.096 - (i - 8) * 0.006]);
  }
  return [bone, cart];
}

function ribGeo(s: Side, i: number) {
  const [b] = ribPaths(s, i);
  const big = i === 1 ? 0.8 : 1;
  const shaft = tube(b, {
    r: (t) => (0.0058 + 0.0012 * Math.sin(Math.PI * Math.min(1, t * 1.4)) - (t < 0.06 ? 0.001 : 0)) * big,
    ellipse: [1, 0.5],
    up: [0, 1, 0],
    radial: 12,
    seg: 0.004,
  });
  const k = ribKnobs(s, b[0], b[1]);
  return merge([shaft, meshShape(k, 0.0011)]);
}

// ====================================================================== DEFINE
export function defineSkeleton() {
  G('skeletal', 'Skeletal System', undefined, SYS, 'The 206-bone framework supporting the body, protecting organs, producing blood cells and storing minerals.');
  G('skel.axial', 'Axial skeleton', 'skeletal', SYS, 'Skull, vertebral column and thoracic cage — the central axis of the body.');
  G('skel.appendicular', 'Appendicular skeleton', 'skeletal', SYS, 'Bones of the limbs and the girdles that attach them to the axial skeleton.');

  // ---- skull
  G('skel.skull', 'Skull', 'skel.axial', SYS, 'Twenty-two bones forming the cranium, which encloses the brain, and the facial skeleton.');
  G('skel.cranium', 'Neurocranium', 'skel.skull', SYS, 'The bony vault and base enclosing and protecting the brain.');
  G('skel.face', 'Facial skeleton', 'skel.skull', SYS, 'Bones forming the face, orbits, nasal cavity and jaws.');
  bone('bone.frontal', 'Frontal bone', 'skel.cranium', () => region(cranium(), [frontalFn], GAP), 'Forms the forehead, the roofs of the orbits and the anterior cranial fossa.', { div: 90 });
  bone('bone.occipital', 'Occipital bone', 'skel.cranium', () => region(cranium(), [occFn, n(frontalFn)], GAP), 'Forms the back and base of the skull; contains the foramen magnum through which the spinal cord passes.', { div: 90 });
  for (const s of SIDES) {
    bone(`bone.parietal.${sid(s)}`, `${sideName(s)} parietal bone`, 'skel.cranium', () => region(cranium(), [n(frontalFn), n(occFn), n(tempFn(s)), n(baseFn), sagFn(s)], GAP), 'Paired bone forming the sides and roof of the cranium, joined at the sagittal suture.', { div: 90 });
    bone(`bone.temporal.${sid(s)}`, `${sideName(s)} temporal bone`, 'skel.cranium', () => region(cranium(), [tempFn(s), n(frontalFn), n(occFn)], GAP), 'Houses the middle and inner ear; its squamous part forms the side of the skull.', { div: 80 });
    bone(`bone.zygomatic.${sid(s)}`, `${sideName(s)} zygomatic bone`, 'skel.face', () => zygomatic(s), 'The cheekbone; forms the prominence of the cheek and part of the orbit.', { div: 60 });
  }
  bone('bone.sphenoid', 'Sphenoid & ethmoid (cranial base)', 'skel.cranium', () => region(cranium(), [baseFn, n(frontalFn), n(occFn), n(tempFn(1)), n(tempFn(-1))], GAP), 'Butterfly-shaped bones at the centre of the cranial base housing the pituitary fossa (sella turcica) and forming the orbits\' posterior walls.', { div: 80 });
  bone('bone.maxilla', 'Maxilla', 'skel.face', maxilla, 'The upper jaw: holds the upper teeth and forms the floor of the orbits and the walls of the nasal cavity.', { div: 80 });
  bone('bone.nasal', 'Nasal bones', 'skel.face', () => union([capsule([0.0, 1.662, 0.09], [0.006, 1.638, 0.101], 0.0032), capsule([0.0, 1.662, 0.09], [-0.006, 1.638, 0.101], 0.0032)], 0.003), 'Two small oblong bones forming the bridge of the nose.', { div: 50 });
  bone('bone.mandible', 'Mandible', 'skel.face', mandible, 'The lower jaw — the only movable bone of the skull, holding the lower teeth.', { div: 90 });
  bone('teeth.upper', 'Upper teeth (maxillary dentition)', 'skel.face', () => teeth(true), '16 permanent teeth: incisors, canines, premolars and molars of the upper arch, covered by enamel — the hardest tissue in the body.', { div: 80, tissue: 'tooth' });
  bone('teeth.lower', 'Lower teeth (mandibular dentition)', 'skel.face', () => teeth(false), '16 permanent teeth of the lower arch.', { div: 80, tissue: 'tooth' });
  bone('bone.hyoid', 'Hyoid bone', 'skel.axial', hyoid, 'U-shaped bone in the neck that anchors the tongue; it does not articulate with any other bone.', { div: 50 });

  // ---- spine
  G('skel.spine', 'Vertebral column', 'skel.axial', SYS, 'Thirty-three vertebrae protecting the spinal cord and supporting the head and trunk.');
  G('skel.cervical', 'Cervical vertebrae', 'skel.spine', SYS, 'C1–C7: the seven vertebrae of the neck.');
  G('skel.thoracic', 'Thoracic vertebrae', 'skel.spine', SYS, 'T1–T12: articulate with the ribs.');
  G('skel.lumbar', 'Lumbar vertebrae', 'skel.spine', SYS, 'L1–L5: the largest vertebrae, bearing the weight of the upper body.');
  G('skel.discs', 'Intervertebral discs', 'skel.spine', SYS, 'Fibrocartilaginous cushions between vertebral bodies.');
  const regionGroup = { C: 'skel.cervical', T: 'skel.thoracic', L: 'skel.lumbar' } as const;
  const regionName = { C: 'cervical', T: 'thoracic', L: 'lumbar' } as const;
  for (const v of VERTEBRAE) {
    let name = `${v.name} vertebra`;
    let desc = `The ${ORD[v.n - 1]} ${regionName[v.region]} vertebra.`;
    if (v.name === 'C1') { name = 'Atlas (C1)'; desc = 'The atlas: a ring-shaped first cervical vertebra without a body that supports the skull and allows nodding.'; }
    if (v.name === 'C2') { name = 'Axis (C2)'; desc = 'The axis: its odontoid process (dens) forms a pivot about which the atlas and head rotate.'; }
    if (v.name === 'C7') { name = 'C7 vertebra (prominens)'; desc = 'Vertebra prominens: its long spinous process is the first palpable bump at the base of the neck.'; }
    if (v.region === 'T') desc += ' Bears costal facets for the ribs; its spinous process slopes steeply downward.';
    if (v.region === 'L') desc += ' Has a massive kidney-shaped body and a hatchet-shaped spinous process.';
    bone(`bone.vert.${v.name}`, name, regionGroup[v.region], () => vertebraShape(v), desc, { div: 55, min: 0.001, max: 0.0017 });
  }
  for (const reg of ['C', 'T', 'L'] as const) {
    P({
      id: `disc.${reg}`, name: `Intervertebral discs (${regionName[reg]})`, parent: 'skel.discs', system: SYS, tissue: 'disc',
      desc: 'Each disc has a gel-like nucleus pulposus surrounded by a tough annulus fibrosus, absorbing shock between vertebral bodies.',
      build: () => {
        const list: Shape[] = [];
        for (let i = 1; i < VERTEBRAE.length; i++) {
          const a = VERTEBRAE[i - 1], b = VERTEBRAE[i];
          if (a.name === 'C1') continue;
          if (b.region !== reg) continue;
          list.push(discShape(a, b));
        }
        if (reg === 'L') {
          const l5 = VERTEBRAE[VERTEBRAE.length - 1];
          list.push(cylinder(add(l5.c, mul(l5.up, -l5.bodyH / 2 - 0.005)), l5.bodyR * 1.08, 0.0045, frameAxes(l5.lat, l5.up), 0.0015, l5.bodyR * 0.8));
        }
        return meshShape(union(list), 0.0013);
      },
    });
  }
  bone('bone.sacrum', 'Sacrum', 'skel.spine', sacrumShape, 'Five fused vertebrae forming a triangular bone that joins the pelvis at the sacroiliac joints.', { div: 80 });
  bone('bone.coccyx', 'Coccyx', 'skel.spine', coccyxShape, 'The tailbone: three to five small fused vertebrae.', { div: 50 });

  // ---- thorax
  G('skel.thorax', 'Thoracic cage', 'skel.axial', SYS, 'Ribs, costal cartilages and sternum protecting the heart and lungs.');
  bone('bone.sternum', 'Sternum', 'skel.thorax', sternumShape, 'The breastbone: manubrium, body and xiphoid process, anchoring the ribs anteriorly.', { div: 80 });
  for (const s of SIDES) {
    const gid = G(`skel.ribs.${sid(s)}`, `${sideName(s)} ribs`, 'skel.thorax', SYS, 'Twelve curved bones; 1–7 are true ribs, 8–10 false ribs, 11–12 floating ribs.');
    for (let i = 1; i <= 12; i++) {
      const kind = i <= 7 ? 'true rib' : i <= 10 ? 'false rib' : 'floating rib';
      P({
        id: `bone.rib.${i}.${sid(s)}`, name: `${sideName(s)} rib ${i}`, parent: gid, system: SYS, tissue: 'bone',
        desc: `The ${ORD[i - 1]} ${lc(sideName(s))} rib — a ${kind}${i <= 7 ? ' attached directly to the sternum by its own costal cartilage' : i <= 10 ? ' joined to the sternum indirectly via the cartilage above' : ' with no anterior attachment'}.`,
        build: () => ribGeo(s, i),
      });
    }
    P({
      id: `cart.costal.${sid(s)}`, name: `${sideName(s)} costal cartilages`, parent: 'skel.thorax', system: SYS, tissue: 'cartilage',
      desc: 'Bars of hyaline cartilage connecting the ribs to the sternum, giving the thoracic cage the elasticity needed for breathing.',
      build: () => {
        const geos = [];
        for (let i = 1; i <= 10; i++) {
          const [, c] = ribPaths(s, i);
          if (c) geos.push(tube(c, { r: 0.0045, ellipse: [1, 0.6], up: [0, 1, 0], radial: 10, seg: 0.004 }));
        }
        return merge(geos);
      },
    });
  }

  // ---- limbs
  G('skel.pelvis', 'Pelvic girdle', 'skel.appendicular', SYS, 'The paired hip bones forming, with the sacrum, the bony pelvis.');
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s), ln = lc(N);
    const up = G(`skel.upper.${S}`, `${N} upper limb`, 'skel.appendicular', SYS, `Bones of the ${ln} shoulder girdle, arm, forearm and hand.`);
    bone(`bone.clavicle.${S}`, `${N} clavicle`, up, () => clavicleShape(s), 'The collarbone: an S-shaped strut between sternum and scapula; the most frequently fractured bone.', { div: 80 });
    bone(`bone.scapula.${S}`, `${N} scapula`, up, () => scapulaShape(s), 'The shoulder blade: a flat triangular bone with a spine, acromion, coracoid process and the glenoid cavity.', { div: 80, max: 0.002 });
    bone(`bone.humerus.${S}`, `${N} humerus`, up, () => humerusShape(s), 'The long bone of the arm, from the shoulder joint to the elbow.', { div: 110 });
    bone(`bone.radius.${S}`, `${N} radius`, up, () => radiusShape(s), 'Lateral forearm bone on the thumb side; rotates around the ulna in pronation and supination.', { div: 110 });
    bone(`bone.ulna.${S}`, `${N} ulna`, up, () => ulnaShape(s), 'Medial forearm bone; its olecranon forms the point of the elbow.', { div: 110 });
    const hand = G(`skel.hand.${S}`, `Bones of ${ln} hand`, up, SYS, '27 bones: 8 carpals, 5 metacarpals and 14 phalanges.');
    const carp = G(`skel.carpals.${S}`, `${N} carpal bones`, hand, SYS, 'Eight short bones of the wrist arranged in two rows.');
    for (const c of CARPALS) bone(`bone.${c.key}.${S}`, `${N} ${lc(c.name)}`, carp, () => carpalShape(s, c.key), c.desc, { div: 36, min: 0.0006, max: 0.0009 });
    const meta = G(`skel.metacarpals.${S}`, `${N} metacarpals`, hand, SYS, 'Five long bones of the palm.');
    const phal = G(`skel.phalanges.hand.${S}`, `Phalanges of ${ln} hand`, hand, SYS, '14 finger bones: proximal, middle and distal phalanges (the thumb has no middle phalanx).');
    const tj = thumbJoints(s);
    bone(`bone.mc1.${S}`, `${N} first metacarpal (thumb)`, meta, () => metaShape(tj[0], tj[1], 0.0048, 1.1), 'Short, stout metacarpal of the thumb forming the highly mobile saddle-shaped carpometacarpal joint.', { div: 50, min: 0.0005, max: 0.0009 });
    FINGERS.forEach((f, i) => {
      const j = fingerJoints(s, i);
      bone(`bone.mc${i + 2}.${S}`, `${N} ${ORD[i + 1]} metacarpal`, meta, () => metaShape(metacarpalBase(s, i), j[0], 0.0042, f.r), `Metacarpal of the ${lc(f.name)} finger.`, { div: 60, min: 0.0005, max: 0.0009 });
      const names = ['Proximal', 'Middle', 'Distal'];
      for (let k = 0; k < 3; k++) {
        bone(`bone.phalanx.${f.key}.${k}.${S}`, `${names[k]} phalanx of ${ln} ${lc(f.name)} finger`, phal, () => phalanxShape(j[k], j[k + 1], f.r, k === 2), `${names[k]} phalanx of the ${lc(f.name)} finger.`, { div: 30, min: 0.0008, max: 0.0011 });
      }
    });
    bone(`bone.phalanx.thumb.0.${S}`, `Proximal phalanx of ${ln} thumb`, phal, () => phalanxShape(tj[1], tj[2], 1.15, false), 'Proximal phalanx of the thumb.', { div: 30, min: 0.0008, max: 0.0011 });
    bone(`bone.phalanx.thumb.2.${S}`, `Distal phalanx of ${ln} thumb`, phal, () => phalanxShape(tj[2], tj[3], 1.15, true), 'Distal phalanx of the thumb.', { div: 30, min: 0.0008, max: 0.0011 });

    bone(`bone.hip.${S}`, `${N} hip bone (os coxae)`, 'skel.pelvis', () => hipBoneShape(s), 'Formed by the fused ilium, ischium and pubis, meeting at the acetabulum — the socket of the hip joint.', { div: 80, max: 0.0022 });

    const low = G(`skel.lower.${S}`, `${N} lower limb`, 'skel.appendicular', SYS, `Bones of the ${ln} thigh, leg and foot.`);
    bone(`bone.femur.${S}`, `${N} femur`, low, () => femurShape(s), 'The thigh bone — the longest and strongest bone in the body.', { div: 110 });
    bone(`bone.patella.${S}`, `${N} patella`, low, () => patellaShape(s), 'The kneecap: the largest sesamoid bone, embedded in the quadriceps tendon.', { div: 50 });
    bone(`bone.tibia.${S}`, `${N} tibia`, low, () => tibiaShape(s), 'The shin bone: the weight-bearing medial bone of the leg.', { div: 105 });
    bone(`bone.fibula.${S}`, `${N} fibula`, low, () => fibulaShape(s), 'Slender lateral leg bone; its distal end forms the lateral malleolus of the ankle.', { div: 105 });
    const foot = G(`skel.foot.${S}`, `Bones of ${ln} foot`, low, SYS, '26 bones: 7 tarsals, 5 metatarsals and 14 phalanges.');
    const tars = G(`skel.tarsals.${S}`, `${N} tarsal bones`, foot, SYS, 'Seven bones of the ankle and hindfoot.');
    for (const t of TARSALS(s)) bone(`bone.${t.key}.${S}`, `${N} ${lc(t.name)}`, tars, t.shape, t.desc, { div: 50, min: 0.0006, max: 0.001 });
    const mt = G(`skel.metatarsals.${S}`, `${N} metatarsals`, foot, SYS, 'Five long bones of the forefoot.');
    const tp = G(`skel.phalanges.foot.${S}`, `Phalanges of ${ln} foot`, foot, SYS, '14 toe bones.');
    TOES.forEach((t, i) => {
      const j = toeJoints(s, i);
      bone(`bone.mt${i + 1}.${S}`, `${N} ${ORD[i]} metatarsal`, mt, () => metaShape(metatarsalBase(s, i), j[0], i === 0 ? 0.0068 : 0.0052, i === 0 ? 1.35 : 1), `Metatarsal of the ${lc(t.name)}.`, { div: 60, min: 0.0005, max: 0.001 });
      const names = t.len.length === 2 ? ['Proximal', 'Distal'] : ['Proximal', 'Middle', 'Distal'];
      for (let k = 0; k < t.len.length; k++) {
        bone(`bone.toe.${t.key}.${k}.${S}`, `${names[k]} phalanx of ${ln} ${lc(t.name)}`, tp, () => phalanxShape(j[k], j[k + 1], t.r * 0.95, k === t.len.length - 1), `${names[k]} phalanx of the ${lc(t.name)}.`, { div: 30, min: 0.0008, max: 0.0011 });
      }
    });

    // ---- joints: knee ligaments & menisci
    const knee = G(`skel.knee.${S}`, `${N} knee joint`, low, SYS, 'The largest synovial joint, stabilised by cruciate and collateral ligaments and cushioned by menisci.');
    P({
      id: `cart.menisci.${S}`, name: `Menisci of ${ln} knee`, parent: knee, system: SYS, tissue: 'cartilage',
      desc: 'Two C-shaped fibrocartilage pads (medial and lateral) deepening the tibial plateau and absorbing load.',
      build: () => meshShape(union([
        subtract(torus([s * 0.078, 0.4885, -0.006], 0.0135, 0.0028), roundBox([s * 0.092, 0.4885, -0.006], [0.006, 0.006, 0.004])),
        subtract(torus([s * 0.113, 0.4885, -0.006], 0.0118, 0.0027), roundBox([s * 0.1, 0.4885, -0.006], [0.006, 0.006, 0.003])),
      ]), 0.0006),
    });
    const lig = (id: string, nm: string, a: V3, b: V3, r: number, d: string) =>
      P({ id: `lig.${id}.${S}`, name: `${nm} (${ln})`, parent: knee, system: SYS, tissue: 'ligament', desc: d, build: () => tube([a, b], { r, ellipse: [1, 0.6], radial: 10, seg: 0.003 }) });
    lig('acl', 'Anterior cruciate ligament', [s * 0.097, 0.489, 0.006], [s * 0.107, 0.508, -0.016], 0.0034, 'Prevents forward sliding of the tibia; frequently torn in pivoting sports.');
    lig('pcl', 'Posterior cruciate ligament', [s * 0.095, 0.486, -0.022], [s * 0.086, 0.51, -0.002], 0.0037, 'The strongest knee ligament; prevents backward displacement of the tibia.');
    lig('mcl', 'Medial collateral ligament', [s * 0.066, 0.53, -0.006], [s * 0.07, 0.44, -0.002], 0.0032, 'Broad flat band resisting valgus (inward) stress on the knee.');
    lig('lcl', 'Lateral collateral ligament', [s * 0.121, 0.526, -0.012], [s * 0.127, 0.47, -0.02], 0.0024, 'Cord-like ligament from the femur to the fibular head resisting varus stress.');
    const pv = PELVIS(s);
    P({ id: `lig.inguinal.${S}`, name: `${N} inguinal ligament`, parent: 'skel.pelvis', system: SYS, tissue: 'ligament', desc: 'Band from the anterior superior iliac spine to the pubic tubercle forming the floor of the inguinal canal.', build: () => tube([pv.asis, [s * 0.075, 0.935, 0.075], pv.pubicTubercle], { r: 0.0018, radial: 8 }) });
    P({ id: `lig.sacrotuberous.${S}`, name: `${N} sacrotuberous ligament`, parent: 'skel.pelvis', system: SYS, tissue: 'ligament', desc: 'Strong ligament from the sacrum to the ischial tuberosity stabilising the sacroiliac joint.', build: () => tube([[s * 0.03, 0.96, -0.085], [s * 0.045, 0.91, -0.065], pv.ischialTub], { r: (t) => 0.004 - 0.0015 * t, ellipse: [1, 0.5], radial: 10 }) });
  }
  P({ id: 'cart.symphysis', name: 'Pubic symphysis', parent: 'skel.pelvis', system: SYS, tissue: 'cartilage', desc: 'Fibrocartilaginous joint uniting the two pubic bones in the midline.', build: () => meshShape(ellipsoid([0, 0.876, 0.062], [0.0035, 0.011, 0.0065]), 0.0006) });
}
