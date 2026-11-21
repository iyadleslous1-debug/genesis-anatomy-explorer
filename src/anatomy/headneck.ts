// P7: ear (outer/middle/inner), nasal cavity, paranasal sinuses, pharynx, soft palate and vocal folds.
import { V3, add, mul, sub, norm, cross } from '../geo/math';
import {
  Shape, ellipsoid, capsule, roundCone, union, subtract, sphere, frameEuler, frameAxes, triangle, displace, chain,
} from '../geo/sdf';
import { meshShape, Geo } from '../geo/mesher';
import { tube, merge } from '../geo/tube';
import { wallTube } from '../geo/d_tubes';
import { noise3 } from '../geo/noise';
import { G, P, SystemId, Tissue } from './registry';
import { SIDES, Side, sid, sideName } from './rig';
import { lc } from './util';

const X = (s: Side, p: V3): V3 => [p[0] * s, p[1], p[2]];

/** open arc of a circle in the plane (u, w) */
function arc(c: V3, u: V3, w: V3, R: number, a0: number, a1: number, n = 36): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(add(c, add(mul(u, R * Math.cos(a)), mul(w, R * Math.sin(a)))));
  }
  return out;
}

function part(id: string, name: string, parent: string, system: SystemId, tissue: Tissue, desc: string, build: () => Geo) {
  P({ id, name, parent, system, tissue, desc, build });
}
const mesh = (sh: () => Shape, cell: number) => () => meshShape(sh(), cell);

export function defineHeadNeck() {
  // ================================================================== EAR (nervous)
  const gEar = G('hn.ear', 'Ear', 'nervous', 'nervous', 'Outer, middle and inner ear: sound collection, mechanical amplification and the cochlear and vestibular sense organs.');
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s), ln = lc(N);
    const g = G(`hn.ear.${S}`, `${N} ear`, gEar, 'nervous', `Internal anatomy of the ${ln} ear within the temporal bone.`);
    const V: V3 = [s * 0.0345, 1.627, 0.0055]; // vestibule
    const DRUM: V3 = [s * 0.0535, 1.6275, 0.0013];
    const dn = norm([s * 0.75, -0.45, 0.5]); // membrane normal (faces lateral, down, forward)

    part(`ear.canal.${S}`, `${N} external auditory canal`, g, 'nervous', 'ear',
      'S-shaped 2.5 cm tube from the concha to the tympanic membrane: outer third cartilaginous with ceruminous glands, inner two thirds bony.', () =>
      wallTube([X(s, [0.0685, 1.6335, -0.0015]), X(s, [0.0615, 1.6315, 0.0005]), DRUM], { r: 0.0037, ellipse: [1.15, 1], up: [0, 1, 0], radial: 14, seg: 0.0012, wall: 0.0007 }));
    part(`ear.tympanic.${S}`, `${N} tympanic membrane`, g, 'nervous', 'ear',
      'The eardrum: a thin, conical, translucent membrane (~9 mm) that vibrates with sound and drives the malleus handle at its umbo.', () =>
      meshShape(subtract(ellipsoid(DRUM, [0.00045, 0.0048, 0.0044], frameAxes(dn, [0, 1, 0])), ellipsoid(add(DRUM, mul(dn, 0.0034)), [0.0028, 0.0028, 0.0028], frameAxes(dn, [0, 1, 0])), 0.0005), 0.00025));
    part(`ear.malleus.${S}`, `${N} malleus`, g, 'nervous', 'bone',
      'The hammer: its handle is embedded in the tympanic membrane and its head articulates with the incus.', () => {
      const mk = (): Shape => union([
        roundCone(add(DRUM, [-s * 0.0005, -0.0028, 0.0]), [s * 0.0497, 1.6342, 0.0036], 0.0004, 0.00075),
        ellipsoid([s * 0.0488, 1.6366, 0.0044], [0.0018, 0.0021, 0.0019]),
        capsule([s * 0.0498, 1.6336, 0.0036], [s * 0.0516, 1.6335, 0.0042], 0.0004),
      ], 0.0006);
      return meshShape(mk(), 0.00022);
    });
    part(`ear.incus.${S}`, `${N} incus`, g, 'nervous', 'bone',
      'The anvil: body, short process and long process ending in the lenticular process that meets the stapes.', () =>
      meshShape(union([
        ellipsoid([s * 0.0466, 1.6368, 0.0042], [0.0016, 0.002, 0.0017]),
        roundCone([s * 0.0466, 1.6372, 0.0038], [s * 0.0452, 1.6378, 0.0003], 0.0008, 0.0003),
        roundCone([s * 0.0462, 1.6358, 0.0045], [s * 0.0447, 1.6316, 0.0044], 0.0006, 0.00035),
        sphere([s * 0.0445, 1.6307, 0.0044], 0.0006),
      ], 0.0005), 0.00022));
    part(`ear.stapes.${S}`, `${N} stapes`, g, 'nervous', 'bone',
      'The stirrup, the smallest bone in the body (~3 mm): head, two crura and a footplate set in the oval window.', () =>
      meshShape(union([
        sphere([s * 0.0442, 1.6296, 0.0044], 0.00055),
        capsule([s * 0.0441, 1.6296, 0.0044], [s * 0.0402, 1.6283, 0.0036], 0.00018),
        capsule([s * 0.0441, 1.6296, 0.0044], [s * 0.0402, 1.6283, 0.0058], 0.00018),
        ellipsoid([s * 0.0398, 1.6283, 0.0047], [0.0003, 0.0014, 0.0009]),
      ], 0.0002), 0.00014));
    part(`ear.vestibule.${S}`, `${N} vestibule`, g, 'nervous', 'ear',
      'Central chamber of the bony labyrinth housing the utricle and saccule (gravity and linear acceleration).', () =>
      meshShape(union([ellipsoid(V, [0.0026, 0.0029, 0.0042], frameEuler(0.2, 0, 0)), sphere(add(V, [0, 0.002, 0.0025]), 0.0022)], 0.0015), 0.00028));
    const sc = (key: string, nm: string, c: V3, u: V3, w: V3, R: number, desc: string) =>
      part(`ear.canal_${key}.${S}`, `${N} ${nm} semicircular canal`, g, 'nervous', 'ear', desc, () =>
        tube(arc(c, norm(u), norm(w), R, -1.25, 4.5, 44), { r: (t) => 0.0007 + 0.0005 * Math.exp(-t * 18), radial: 8, seg: 0.0005 }));
    sc('superior', 'superior', add(V, [0, 0.0048, -0.001]), [s, 0, 1], [0, 1, 0], 0.0052, 'Anterior canal sensing head nodding (pitch).');
    sc('posterior', 'posterior', add(V, [0, 0.0035, -0.0035]), [s, 0, -1], [0, 1, 0], 0.0048, 'Posterior canal sensing head tilt (roll); joins the superior canal in the crus commune.');
    sc('lateral', 'lateral', add(V, [s * 0.0025, 0.0004, -0.0036]), [s, 0, 0], [0, 0.45, 0.89], 0.0036, 'Horizontal canal sensing head turning (yaw).');
    part(`ear.cochlea.${S}`, `${N} cochlea`, g, 'nervous', 'ear',
      'Snail-shaped hearing organ: a 35 mm duct coiled 2.5 turns around the modiolus; the basilar membrane maps frequency from base (high) to apex (low).', () => {
      const B: V3 = [s * 0.0315, 1.6205, 0.0145];
      const ax = norm([s * 0.5, -0.3, 0.8]);
      const u = norm(cross(ax, [0, 1, 0]));
      const w = cross(ax, u);
      const pts: V3[] = [];
      const n = 110, turns = 2.5;
      for (let i = 0; i <= n; i++) {
        const f = i / n, th = f * turns * Math.PI * 2;
        const R = 0.0036 * (1 - 0.75 * f);
        pts.push(add(add(B, add(mul(u, R * Math.cos(th)), mul(w, R * Math.sin(th)))), mul(ax, 0.0052 * f)));
      }
      return tube(pts, { r: (t) => 0.0012 * (1 - 0.55 * t), radial: 10, raw: true });
    });
    part(`ear.eustachian.${S}`, `${N} auditory (Eustachian) tube`, g, 'nervous', 'ear',
      'Tube from the middle ear to the nasopharynx that equalises air pressure across the eardrum.', () =>
      tube([X(s, [0.0475, 1.6225, 0.0085]), X(s, [0.036, 1.617, 0.021]), X(s, [0.0225, 1.6125, 0.0285]), X(s, [0.0135, 1.61, 0.03])], { r: (t) => 0.0014 + 0.0012 * t, radial: 10, seg: 0.0015 }));
  }

  // ================================================================== NASAL (respiratory)
  const gNas = G('hn.nasal', 'Nasal cavity & sinuses', 'respiratory', 'respiratory', 'Warms, humidifies and filters inspired air; the paranasal sinuses lighten the skull and resonate the voice.');
  const R: SystemId = 'respiratory';
  part('nasal.septum', 'Nasal septum', gNas, R, 'mucosa',
    'Midline partition made of septal cartilage in front, the perpendicular plate of the ethmoid above and the vomer below.', () =>
    meshShape(displace(union([
      triangle([0, 1.648, 0.094], [0, 1.604, 0.104], [0, 1.6, 0.05], 0.0007),
      triangle([0, 1.648, 0.094], [0, 1.6, 0.05], [0, 1.634, 0.044], 0.0007),
      triangle([0, 1.6, 0.05], [0, 1.6, 0.047], [0, 1.628, 0.04], 0.0007),
    ], 0.001), (x, y, z) => 0.0003 * noise3(x * 300, y * 300, z * 300), 0.0003), 0.0009));
  part('nasal.floor', 'Nasal floor mucosa', gNas, R, 'mucosa', 'Mucosa over the hard palate forming the floor of the nasal cavity.', () =>
    meshShape(ellipsoid([0, 1.5975, 0.073], [0.019, 0.0012, 0.03]), 0.001));
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    const g = G(`hn.nasal.${S}`, `${N} nasal fossa`, gNas, R, `${N} nasal passage with its three conchae.`);
    part(`nasal.wall.${S}`, `${N} lateral nasal wall`, g, R, 'mucosa', 'Lateral wall mucosa, ridged where the conchae and meatuses (drainage openings of the sinuses) lie beneath.', () =>
      meshShape(displace(ellipsoid([s * 0.0195, 1.628, 0.067], [0.0016, 0.027, 0.026]), (x, y, z) => 0.0004 * noise3(x * 250, y * 250, z * 250), 0.0004), 0.001));
    const concha = (key: string, nm: string, wall: [number, number], edge: [number, number], z0: number, z1: number, desc: string) =>
      part(`nasal.concha_${key}.${S}`, `${N} ${nm} nasal concha`, g, R, 'mucosa', desc, () => {
        const w0 = X(s, [wall[0], wall[1], z0]), w1 = X(s, [wall[0], wall[1], z1]);
        const e0 = X(s, [edge[0], edge[1], z0 + 0.003]), e1 = X(s, [edge[0], edge[1], z1 - 0.002]);
        const m0 = X(s, [(wall[0] + edge[0]) / 2, edge[1] + 0.0035, z0 + 0.002]), m1 = X(s, [(wall[0] + edge[0]) / 2, edge[1] + 0.0035, z1 - 0.001]);
        return meshShape(union([
          triangle(w0, w1, m0, 0.0007), triangle(w1, m1, m0, 0.0007), triangle(m0, m1, e0, 0.0007), triangle(m1, e1, e0, 0.0007),
          capsule(e0, e1, 0.0019),
        ], 0.0012), 0.0008);
      });
    concha('inferior', 'inferior', [0.0185, 1.611], [0.0085, 1.599], 0.054, 0.09, 'Largest scroll of the lateral wall, an independent bone; swells to regulate airflow and humidify air.');
    concha('middle', 'middle', [0.0165, 1.634], [0.0082, 1.623], 0.05, 0.082, 'Ethmoid scroll hiding the openings of the frontal, maxillary and anterior ethmoid sinuses.');
    concha('superior', 'superior', [0.0145, 1.647], [0.0078, 1.64], 0.048, 0.067, 'Small ethmoid scroll carrying olfactory mucosa.');

    // paranasal sinuses (air-cavity shells)
    part(`sinus.maxillary.${S}`, `${N} maxillary sinus`, g, R, 'mucosa', 'Largest paranasal sinus (~15 mL), pyramid-shaped in the maxilla below the orbit; drains into the middle meatus.', () =>
      meshShape(displace(union([
        ellipsoid([s * 0.032, 1.612, 0.06], [0.0125, 0.0125, 0.0145], frameEuler(0, 0, s * 0.2)),
        sphere([s * 0.03, 1.6, 0.064], 0.0065),
        sphere([s * 0.039, 1.618, 0.05], 0.0055),
      ], 0.006), (x, y, z) => 0.0005 * noise3(x * 220, y * 220, z * 220), 0.0005), 0.001));
    part(`sinus.frontal.${S}`, `${N} frontal sinus`, g, R, 'mucosa', 'Scalloped air space within the frontal bone above the brow; drains through the frontonasal duct.', () =>
      meshShape(displace(union([
        ellipsoid([s * 0.0165, 1.6785, 0.0805], [0.0135, 0.0125, 0.0042], frameEuler(0.05, 0, s * 0.2)),
        ellipsoid([s * 0.0285, 1.672, 0.0775], [0.0085, 0.006, 0.0038]),
      ], 0.004), (x, y, z) => 0.0004 * noise3(x * 260, y * 260, z * 260), 0.0004), 0.001));
    part(`sinus.ethmoid.${S}`, `${N} ethmoid air cells`, g, R, 'mucosa', 'A honeycomb of 3-18 thin-walled air cells between the nose and orbit.', () => {
      const cs: Shape[] = [];
      for (let i = 0; i < 8; i++) {
        const f = i / 7;
        cs.push(ellipsoid([s * (0.0142 + 0.0022 * Math.sin(i * 2.1)), 1.652 + 0.006 * Math.cos(i * 1.7) - 0.004 * f, 0.074 - 0.03 * f + 0.002 * Math.sin(i * 3)], [0.0026, 0.0028, 0.0034]));
      }
      return meshShape(union(cs, 0.0008), 0.0009);
    });
  }
  part('sinus.sphenoid', 'Sphenoid sinus', gNas, R, 'mucosa', 'Midline air space in the body of the sphenoid, directly beneath the pituitary fossa and optic chiasm.', () =>
    meshShape(displace(union([
      ellipsoid([0.0045, 1.628, 0.04], [0.0058, 0.008, 0.0105]), ellipsoid([-0.0045, 1.628, 0.04], [0.0058, 0.008, 0.0105]),
    ], 0.003), (x, y, z) => 0.0004 * noise3(x * 260, y * 260, z * 260), 0.0004), 0.001));

  // ================================================================== PHARYNX (digestive)
  const gPh = G('hn.pharynx', 'Pharynx', 'digestive', 'digestive', 'The 12-14 cm muscular funnel shared by the airway and food passage: nasopharynx, oropharynx and laryngopharynx.');
  const D: SystemId = 'digestive';
  const phTube = (pts: V3[], r: number, e: number, fixedRad?: (t: number) => number) =>
    wallTube(pts, { r: fixedRad ? (t: number) => fixedRad(t) : r, ellipse: [e, 1], up: [0, 0, 1], radial: 20, seg: 0.0025, innerSeg: 0.004, wall: 0.0018 });
  part('pharynx.naso', 'Nasopharynx', gPh, D, 'mucosa', 'Upper pharynx behind the nasal choanae; receives the auditory tubes and houses the pharyngeal tonsil.', () =>
    phTube([[0, 1.629, 0.0225], [0, 1.617, 0.0215], [0, 1.603, 0.0195]], 0.0165, 0.7));
  part('pharynx.oro', 'Oropharynx', gPh, D, 'mucosa', 'Middle pharynx behind the oral cavity from the soft palate to the epiglottis; contains the palatine tonsils.', () =>
    phTube([[0, 1.603, 0.0195], [0, 1.585, 0.0205], [0, 1.563, 0.0195]], 0.0172, 0.55));
  part('pharynx.laryngo', 'Laryngopharynx', gPh, D, 'mucosa', 'Lower pharynx flanking the larynx (piriform recesses) down to the cricopharyngeus where it becomes the esophagus.', () =>
    phTube([[0, 1.563, 0.0195], [0, 1.548, 0.0178], [0, 1.534, 0.0135]], 0.0165, 0.42, (t) => 0.0172 - 0.0045 * t));
  part('pharynx.soft_palate', 'Soft palate & uvula', gPh, D, 'mucosa', 'Muscular flap behind the hard palate that seals the nasopharynx during swallowing; the uvula hangs from its free edge.', () =>
    meshShape(union([
      ...SIDES.flatMap((s) => [
        triangle([0, 1.5985, 0.05], [s * 0.017, 1.5985, 0.046], [s * 0.015, 1.589, 0.024], 0.0016),
        triangle([0, 1.5985, 0.05], [s * 0.015, 1.589, 0.024], [0, 1.585, 0.0225], 0.0016),
      ]),
      ellipsoid([0, 1.5785, 0.0215], [0.0022, 0.0085, 0.0022]),
    ], 0.0025), 0.0009));

  // ================================================================== LARYNX interior (respiratory, under resp.larynx)
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    part(`larynx.vocal_fold.${S}`, `${N} vocal fold`, 'resp.larynx', R, 'mucosa',
      'True vocal cord: mucosa over the vocalis muscle and vocal ligament, stretched from the thyroid angle to the arytenoid; vibrates 100-250 times per second to make voice.', () =>
      meshShape(union([
        capsule([s * 0.0012, 1.5198, 0.0405], [s * 0.0058, 1.5192, 0.0258], 0.0015),
        ellipsoid([s * 0.0075, 1.5205, 0.0335], [0.0045, 0.0012, 0.0085], frameEuler(0, s * 0.1, 0)),
      ], 0.0012), 0.0005));
    part(`larynx.vestibular_fold.${S}`, `${N} vestibular fold`, 'resp.larynx', R, 'mucosa',
      'False vocal cord lying above the true fold; closes the airway protectively during swallowing and straining.', () =>
      meshShape(union([
        capsule([s * 0.0035, 1.5285, 0.04], [s * 0.0078, 1.5285, 0.0275], 0.0018),
        ellipsoid([s * 0.0105, 1.5295, 0.0345], [0.005, 0.002, 0.0085]),
      ], 0.0015), 0.0005));
    part(`larynx.arytenoid.${S}`, `${N} arytenoid cartilage`, 'resp.larynx', R, 'cartilage',
      'Pyramidal cartilage on the cricoid lamina; its vocal process anchors the vocal fold and rotation abducts or adducts the cords.', () =>
      meshShape(union([
        roundCone([s * 0.0075, 1.5155, 0.0235], [s * 0.0048, 1.5265, 0.0238], 0.0034, 0.0015),
        capsule([s * 0.0075, 1.5185, 0.0245], [s * 0.0058, 1.5192, 0.0268], 0.0012),
      ], 0.002), 0.0006));
  }
  void chain; void merge; void sub;
}
