// P7: lymphatic system - thoracic duct, right lymphatic duct, node clusters with fine vessels, tonsils.
import { V3, add, mul } from '../geo/math';
import { ellipsoid, union, subtract, displace, sphere, frameEuler, Shape } from '../geo/sdf';
import { meshShape } from '../geo/mesher';
import { tube, merge } from '../geo/tube';
import { noise3 } from '../geo/noise';
import { scatterNodes, nodeVessels, NodeRun } from '../geo/g_lymph';
import { G, P } from './registry';
import { SIDES, Side, sid, sideName, VERTEBRAE, armPt, forePt, handPt } from './rig';
import { conform } from './skin';
import { lc } from './util';

const SYS = 'lymphatic' as const;
const vv = (n: string) => VERTEBRAE.find((v) => v.name === n)!;
/** point on the front of a vertebral body, offset laterally by dx and forward by df */
const vf = (n: string, dx = 0, df = 0.003): V3 => {
  const v = vv(n);
  return add(add(v.c, mul(v.fwd, v.bodyR + df)), [dx, 0, 0]);
};
const X = (s: Side, p: V3): V3 => [p[0] * s, p[1], p[2]];
const sup = (depth: number) => (p: V3, r: number) => conform(p, depth + r);
const tb = (pts: V3[], r: number, seg = 0.005) => tube(pts, { r, radial: 6, seg, flow0: 0 });

export function defineLymphatic() {
  G('lymphatic', 'Lymphatic System', undefined, SYS, 'Returns ~3 L/day of interstitial fluid to the blood, absorbs dietary fat via lacteals, and houses lymphocytes in nodes and tonsils.');
  const gDuct = G('lym.ducts', 'Lymphatic ducts & trunks', 'lymphatic', SYS, 'Collecting trunks draining into the venous angles.');
  const gNode = G('lym.nodes', 'Lymph nodes', 'lymphatic', SYS, 'Bean-shaped filters where lymph meets lymphocytes; several hundred cluster along the great veins.');
  const gTons = G('lym.tonsils', 'Tonsils', 'lymphatic', SYS, "Waldeyer's ring of lymphoid tissue guarding the entrance to the pharynx.");

  // ------------------------------------------------------------ ducts
  const jj = (s: Side): V3 => X(s, [0.05, 1.45, 0.02]);
  const TD: V3[] = [
    vf('L1', 0.0, 0.0025), vf('T12', -0.002, 0.0028), vf('T10', -0.004, 0.003), vf('T8', -0.004, 0.0035), vf('T6', -0.003, 0.0035),
    vf('T4', 0.002, 0.0035), [0.008, 1.405, -0.027], [0.013, 1.43, -0.016], [0.02, 1.462, -0.002], [0.034, 1.482, 0.012], [0.046, 1.472, 0.02], jj(1),
  ];
  P({
    id: 'lym.thoracic_duct', name: 'Thoracic duct', parent: gDuct, system: SYS, tissue: 'lymph',
    desc: 'The main lymphatic channel (~40 cm): rises from the cisterna chyli at L1 through the aortic hiatus, crosses to the left at T5, arches over the pleura at C7 and empties into the left venous angle.',
    build: () => tube(TD, { r: (t) => 0.0019 + 0.0003 * t, radial: 9, seg: 0.004, flow0: 0 }),
  });
  P({
    id: 'lym.cisterna_chyli', name: 'Cisterna chyli', parent: gDuct, system: SYS, tissue: 'lymph',
    desc: 'Dilated sac at L1-L2 receiving the intestinal and lumbar trunks; the origin of the thoracic duct.',
    build: () => tube([vf('L2', 0, 0.0025), vf('L1', 0, 0.0025), vf('T12', -0.001, 0.0027)], { r: (t) => 0.0006 + 0.0036 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)), radial: 12, seg: 0.002, flow0: 0 }),
  });
  P({
    id: 'lym.right_duct', name: 'Right lymphatic duct', parent: gDuct, system: SYS, tissue: 'lymph',
    desc: 'A ~1 cm trunk formed by the right jugular, subclavian and bronchomediastinal trunks; drains the right head, neck, arm and thorax into the right venous angle.',
    build: () => tube([X(-1, [0.04, 1.468, 0.022]), X(-1, [0.044, 1.462, 0.021]), jj(-1)], { r: 0.0017, radial: 8, seg: 0.002, flow0: 0 }),
  });
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    P({
      id: `lym.jugular_trunk.${S}`, name: `${N} jugular trunk`, parent: gDuct, system: SYS, tissue: 'lymph',
      desc: 'Collects lymph from the deep cervical nodes along the internal jugular vein.',
      build: () => tb([X(s, [0.034, 1.51, 0.03]), X(s, [0.04, 1.48, 0.03]), jj(s)], 0.0012, 0.003),
    });
    P({
      id: `lym.subclavian_trunk.${S}`, name: `${N} subclavian trunk`, parent: gDuct, system: SYS, tissue: 'lymph',
      desc: 'Carries lymph from the axillary apical nodes of the upper limb to the venous angle.',
      build: () => tb([X(s, [0.125, 1.43, 0.026]), X(s, [0.09, 1.443, 0.026]), jj(s)], 0.0012, 0.003),
    });
    P({
      id: `lym.bronchomed_trunk.${S}`, name: `${N} bronchomediastinal trunk`, parent: gDuct, system: SYS, tissue: 'lymph',
      desc: 'Drains the hilar and mediastinal nodes of the thorax up to the venous angle.',
      build: () => tb([X(s, [0.012, 1.4, 0.006]), X(s, [0.018, 1.43, 0.014]), X(s, [0.034, 1.447, 0.02]), jj(s)], 0.0011, 0.003),
    });
  }
  P({
    id: 'lym.lumbar_trunks', name: 'Lumbar & intestinal trunks', parent: gDuct, system: SYS, tissue: 'lymph',
    desc: 'Lumbar trunks from the legs and pelvis and the intestinal trunk from the gut (carrying milky chyle) converge on the cisterna chyli.',
    build: () => merge([
      tb([vf('L4', 0.014, 0.004), vf('L3', 0.012, 0.0045), vf('L2', 0.006, 0.004)], 0.0012, 0.004),
      tb([vf('L4', -0.014, 0.004), vf('L3', -0.012, 0.0045), vf('L2', -0.006, 0.004)], 0.0012, 0.004),
      tb([[0.0, 1.07, 0.03], [0.001, 1.09, 0.012], [0.001, 1.11, -0.004], vf('L1', 0.0015, 0.004)], 0.0013, 0.004),
    ]),
  });
  // collecting vessels of the limbs (follow the great veins)
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    P({
      id: `lym.vessel.arm.${S}`, name: `${N} arm lymphatics`, parent: gDuct, system: SYS, tissue: 'lymph',
      desc: 'Superficial and deep collecting vessels of the arm following the basilic and brachial veins up to the axillary nodes.',
      build: () => merge([
        tb([handPt(s, 0.05, -0.012, 0.012), forePt(s, 0.7, -0.022, 0.014), forePt(s, 0.3, -0.026, 0.016), armPt(s, 0.9, -0.028, 0.014), armPt(s, 0.5, -0.028, 0.014), armPt(s, 0.15, -0.026, 0.016), X(s, [0.15, 1.39, 0.012])].map((p) => conform(p, 0.007)), 0.0004, 0.007),
        tb([forePt(s, 0.85, -0.01, 0.008), forePt(s, 0.4, -0.016, 0.008), armPt(s, 0.92, -0.016, 0.01), armPt(s, 0.4, -0.02, 0.01), armPt(s, 0.1, -0.02, 0.014), X(s, [0.152, 1.388, 0.008])], 0.0004, 0.007),
      ]),
    });
    P({
      id: `lym.vessel.leg.${S}`, name: `${N} leg lymphatics`, parent: gDuct, system: SYS, tissue: 'lymph',
      desc: 'Collecting vessels along the great saphenous and femoral veins converging on the inguinal nodes.',
      build: () => {
        const sap = ([[0.07, 0.12, 0.015], [0.073, 0.3, 0.014], [0.075, 0.46, 0.0], [0.075, 0.6, 0.02], [0.077, 0.75, 0.045], [0.078, 0.87, 0.06], [0.07, 0.915, 0.07]] as V3[]).map((p) => conform(X(s, p), 0.006));
        return merge([
          tb(sap, 0.00045, 0.008),
          tb(([[0.09, 0.46, -0.036], [0.086, 0.55, -0.03], [0.08, 0.6, -0.002], [0.077, 0.72, 0.03], [0.07, 0.85, 0.052], [0.066, 0.905, 0.058]] as V3[]).map((p) => X(s, p)), 0.0004, 0.008),
        ]);
      },
    });
  }

  // ------------------------------------------------------------ node clusters
  let seed = 11;
  const cluster = (id: string, name: string, desc: string, runs: NodeRun[], vesselR = 0.00035) => {
    const sd = seed++;
    const cache: { c?: ReturnType<typeof scatterNodes> } = {};
    const get = () => (cache.c ??= scatterNodes(runs, sd));
    P({ id: `lym.node.${id}`, name: `${name} nodes`, parent: gNode, system: SYS, tissue: 'node', desc, build: () => get().nodes });
    P({ id: `lym.vess.${id}`, name: `${name} lymphatics`, parent: gNode, system: SYS, tissue: 'lymph', desc: `Afferent and efferent lymph vessels of the ${lc(name)} nodes.`, build: () => nodeVessels(get(), sd + 500, vesselR) });
  };
  const run = (path: V3[], count: number, spread: number, size: [number, number], fix?: (p: V3, r: number) => V3): NodeRun => ({ path, count, spread, size, fix });

  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    cluster(`cervical_deep.${S}`, `${N} deep cervical`, 'Chain along the internal jugular vein within the carotid sheath, including the jugulodigastric node, receiving the whole head and neck.', [
      run([X(s, [0.05, 1.455, 0.014]), X(s, [0.037, 1.5, 0.026]), X(s, [0.039, 1.56, 0.012]), X(s, [0.044, 1.598, -0.012])], 9, 0.0025, [0.0025, 0.0065]),
    ]);
    cluster(`cervical_superficial.${S}`, `${N} superficial cervical`, 'Nodes along the external jugular vein and the posterior triangle (spinal accessory chain).', [
      run([X(s, [0.056, 1.455, 0.02]), X(s, [0.058, 1.52, 0.022]), X(s, [0.058, 1.58, 0.006]), X(s, [0.06, 1.62, -0.004])], 5, 0.002, [0.002, 0.004], sup(0.007)),
      run([X(s, [0.04, 1.45, -0.032]), X(s, [0.047, 1.52, -0.036]), X(s, [0.05, 1.59, -0.04])], 6, 0.002, [0.002, 0.0045], sup(0.01)),
    ]);
    cluster(`submandibular.${S}`, `${N} submandibular`, 'Nodes beside the submandibular gland draining the face, lips, tongue and gums.', [
      run([X(s, [0.034, 1.548, 0.032]), X(s, [0.028, 1.545, 0.046]), X(s, [0.018, 1.543, 0.058])], 4, 0.0015, [0.003, 0.006], sup(0.009)),
    ]);
    cluster(`auricular.${S}`, `${N} pre- and post-auricular, occipital`, 'Small nodes around the ear and base of the skull draining the scalp.', [
      run([X(s, [0.07, 1.635, 0.016]), X(s, [0.073, 1.645, 0.02])], 2, 0.001, [0.0015, 0.0025], sup(0.006)),
      run([X(s, [0.058, 1.608, -0.04]), X(s, [0.04, 1.62, -0.07])], 3, 0.0015, [0.0015, 0.003], sup(0.007)),
    ]);
    cluster(`supraclavicular.${S}`, `${N} supraclavicular`, "Nodes above the clavicle at the venous angle (Virchow's node on the left signals abdominal malignancy).", [
      run([X(s, [0.045, 1.445, 0.014]), X(s, [0.07, 1.44, 0.02]), X(s, [0.09, 1.436, 0.018])], 4, 0.0015, [0.0025, 0.0055], sup(0.008)),
    ]);
    cluster(`axillary.${S}`, `${N} axillary`, 'About 20-30 nodes in the axillary fat in apical, central, pectoral, subscapular and lateral groups draining the arm, breast and chest wall.', [
      run([X(s, [0.15, 1.402, 0.01]), X(s, [0.145, 1.39, 0.004])], 3, 0.003, [0.004, 0.008], sup(0.016)),
      run([X(s, [0.15, 1.375, 0.0]), X(s, [0.143, 1.36, 0.002])], 4, 0.004, [0.004, 0.009], sup(0.016)),
      run([X(s, [0.13, 1.37, 0.042]), X(s, [0.118, 1.34, 0.056])], 4, 0.003, [0.003, 0.007], sup(0.012)),
      run([X(s, [0.135, 1.38, -0.04]), X(s, [0.14, 1.345, -0.046])], 4, 0.003, [0.003, 0.007], sup(0.012)),
      run([X(s, [0.165, 1.385, 0.012]), X(s, [0.168, 1.36, 0.008])], 3, 0.0025, [0.003, 0.006], sup(0.014)),
    ]);
    cluster(`epitrochlear.${S}`, `${N} epitrochlear`, 'One or two nodes above the medial epicondyle draining the hand and forearm.', [
      run([armPt(s, 0.93, -0.034, 0.002), armPt(s, 0.98, -0.032, 0.004)], 2, 0.0008, [0.0025, 0.0035], sup(0.007)),
    ]);
    cluster(`hilar.${S}`, `${N} hilar (bronchopulmonary)`, 'Nodes at the root of the lung, often darkly pigmented by inhaled carbon.', [
      run([X(s, [0.036, 1.335, -0.016]), X(s, [0.05, 1.318, -0.022]), X(s, [0.04, 1.298, -0.02])], 6, 0.004, [0.003, 0.0075]),
    ]);
    cluster(`paratracheal.${S}`, `${N} paratracheal`, 'Nodes along the sides of the trachea, draining the lungs towards the bronchomediastinal trunks.', [
      run([X(s, [0.015, 1.375, 0.002]), X(s, [0.017, 1.41, 0.012]), X(s, [0.016, 1.44, 0.018])], 4, 0.002, [0.003, 0.006]),
    ]);
    cluster(`iliac.${S}`, `${N} common & external iliac`, 'Chain along the iliac vessels draining the pelvis, perineum and (via inguinal nodes) the leg.', [
      run([X(s, [0.012, 1.05, 0.0]), X(s, [0.035, 1.018, 0.0]), X(s, [0.062, 0.975, 0.024]), X(s, [0.084, 0.95, 0.044])], 8, 0.004, [0.0035, 0.0085]),
      run([X(s, [0.056, 0.975, -0.022]), X(s, [0.05, 0.945, -0.045])], 3, 0.003, [0.003, 0.006]),
    ]);
    cluster(`inguinal.${S}`, `${N} inguinal`, 'Superficial nodes in the femoral triangle below the inguinal ligament plus deep nodes beside the femoral vein; they drain the leg, perineum and lower abdominal wall.', [
      run([X(s, [0.04, 0.935, 0.08]), X(s, [0.07, 0.925, 0.076]), X(s, [0.104, 0.912, 0.062])], 5, 0.0025, [0.003, 0.0085], sup(0.007)),
      run([X(s, [0.07, 0.905, 0.07]), X(s, [0.075, 0.855, 0.062])], 4, 0.002, [0.003, 0.0065], sup(0.008)),
      run([X(s, [0.066, 0.915, 0.058]), X(s, [0.066, 0.89, 0.054])], 3, 0.0015, [0.003, 0.0055]),
    ]);
    cluster(`popliteal.${S}`, `${N} popliteal`, 'A few nodes deep in the popliteal fossa behind the knee draining the foot and calf.', [
      run([X(s, [0.092, 0.512, -0.036]), X(s, [0.092, 0.476, -0.034])], 2, 0.001, [0.0025, 0.0035], sup(0.014)),
    ]);
  }
  cluster('mediastinal', 'Mediastinal (subcarinal & aortopulmonary)', 'Nodes beneath the tracheal bifurcation and in the aortopulmonary window.', [
    run([[0.0, 1.355, -0.006], [0.006, 1.34, -0.01]], 4, 0.003, [0.004, 0.009]),
    run([[0.02, 1.4, 0.004], [0.026, 1.388, 0.0]], 3, 0.002, [0.003, 0.006]),
    run([[-0.002, 1.3, -0.036], [0.0, 1.24, -0.034]], 3, 0.002, [0.003, 0.006]),
  ]);
  cluster('paraaortic', 'Para-aortic (lumbar)', 'Chain of nodes on both sides of the aorta and inferior vena cava from the diaphragm to the aortic bifurcation, draining the kidneys, gonads and pelvis.', [
    run([vf('L1', -0.004, 0.007), vf('L3', -0.003, 0.007), vf('L4', 0.0, 0.006)], 6, 0.0025, [0.004, 0.01]),
    run([vf('L1', 0.03, 0.002), vf('L3', 0.032, 0.0), vf('L4', 0.028, 0.0)], 4, 0.003, [0.004, 0.009]),
    run([vf('L1', -0.036, 0.002), vf('L3', -0.038, 0.0), vf('L4', -0.03, 0.0)], 4, 0.003, [0.004, 0.009]),
  ]);
  cluster('mesenteric', 'Mesenteric', 'Several hundred nodes in the mesentery draining the small bowel; lacteals carry fat-laden chyle to them.', [
    run([[-0.03, 1.07, 0.03], [-0.01, 1.04, 0.036], [0.02, 1.03, 0.036], [0.045, 1.05, 0.03]], 12, 0.012, [0.003, 0.0075]),
    run([[0.05, 1.12, 0.03], [0.02, 1.1, 0.04], [-0.02, 1.1, 0.04]], 6, 0.008, [0.003, 0.0065]),
    run([[0.0, 1.06, 0.01], [0.0, 1.09, 0.0]], 3, 0.004, [0.004, 0.008]),
  ]);
  cluster('colic', 'Colic & celiac', 'Nodes along the colon and around the celiac artery.', [
    run([[-0.085, 1.08, 0.03], [-0.07, 1.12, 0.03], [-0.04, 1.17, 0.045]], 4, 0.006, [0.003, 0.006]),
    run([[0.06, 1.08, 0.02], [0.075, 1.12, 0.018], [0.06, 1.17, 0.03]], 4, 0.006, [0.003, 0.006]),
    run([[0.0, 1.14, 0.004], [0.004, 1.16, 0.0]], 3, 0.003, [0.004, 0.007]),
  ]);

  // ------------------------------------------------------------ tonsils
  const lobulate = (sh: Shape, f: number, amp: number) => displace(sh, (x, y, z) => amp * (0.5 + 0.5 * noise3(x * f, y * f, z * f)), amp);
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    P({
      id: `lym.tonsil.palatine.${S}`, name: `${N} palatine tonsil`, parent: gTons, system: SYS, tissue: 'node',
      desc: 'Almond-sized lymphoid mass between the palatoglossal and palatopharyngeal arches, pitted with tonsillar crypts.',
      build: () => {
        const c: V3 = [s * 0.0165, 1.572, 0.021];
        let t = ellipsoid(c, [0.0055, 0.0115, 0.0085], frameEuler(0.1, 0, s * 0.08));
        for (let i = 0; i < 9; i++) { const a = i * 2.4; t = subtract(t, sphere(add(c, [-s * 0.0042, 0.009 * Math.sin(a * 1.3), 0.007 * Math.cos(a)]), 0.0011), 0.0008); }
        return meshShape(lobulate(t, 500, 0.0005), 0.0008);
      },
    });
  }
  P({
    id: 'lym.tonsil.pharyngeal', name: 'Pharyngeal tonsil (adenoid)', parent: gTons, system: SYS, tissue: 'node',
    desc: 'Midline lymphoid pad on the roof of the nasopharynx with radial mucosal folds; enlarged adenoids can block the auditory tubes.',
    build: () => {
      let t = ellipsoid([0, 1.6215, 0.0215], [0.0095, 0.0045, 0.0085], frameEuler(-0.3, 0, 0));
      for (let i = -2; i <= 2; i++) t = subtract(t, ellipsoid([i * 0.0032, 1.6195, 0.0225], [0.0005, 0.004, 0.009], frameEuler(-0.3, 0, 0)), 0.0008);
      return meshShape(t, 0.0008);
    },
  });
  P({
    id: 'lym.tonsil.lingual', name: 'Lingual tonsil', parent: gTons, system: SYS, tissue: 'node',
    desc: 'Nodular lymphoid tissue on the posterior third of the tongue.',
    build: () => {
      const base = ellipsoid([0, 1.568, 0.0185], [0.0155, 0.007, 0.004], frameEuler(0.2, 0, 0));
      const nodules = union(Array.from({ length: 14 }, (_, i) => {
        const a = (i / 13 - 0.5) * 2.2;
        return sphere([0.013 * Math.sin(a) * 1.1, 1.568 + 0.005 * Math.cos(i * 1.7), 0.0215 + 0.001 * Math.cos(a)], 0.0019);
      }), 0.0015);
      return meshShape(union([base, nodules], 0.001), 0.0008);
    },
  });
}
