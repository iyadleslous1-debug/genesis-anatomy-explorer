// P5: facial features built from many small, anatomically placed forms (left half, mirrored by the caller).
import { V3, add } from './math';
import { Shape, ellipsoid, capsule, roundCone, union, subtract, intersect, plane, sphere, frameEuler } from './sdf';

const EYE: V3 = [0.0315, 1.651, 0.081];

/** Add eyes, nose, mouth, cheeks, chin, brow to a bare cranium/jaw shape. */
export function faceForms(base: Shape): Shape {
  const eye = EYE;
  // ---- soft-tissue volumes under the skin
  const volumes = union(
    [
      ellipsoid([0.05, 1.641, 0.053], [0.02, 0.0115, 0.022], frameEuler(0, 0.45, 0.1)), // zygomatic body
      ellipsoid([0.032, 1.614, 0.07], [0.017, 0.014, 0.012]), // malar fat pad
      ellipsoid([0.0, 1.5915, 0.083], [0.025, 0.016, 0.014]), // maxilla / upper lip support
      ellipsoid([0.0, 1.553, 0.083], [0.018, 0.014, 0.0125]), // mentalis / chin pad
      ellipsoid([0.0, 1.5775, 0.0895], [0.023, 0.0145, 0.0115]), // orbicularis oris
      ellipsoid([0.054, 1.579, 0.016], [0.0055, 0.016, 0.013], frameEuler(0, 0, -0.15)), // masseter
    ],
    0.012,
  );
  let head = union([base, volumes], 0.014);

  // ---- orbit: carve a socket, then rebuild globe + lids and the brow overhang
  head = subtract(head, ellipsoid([eye[0], eye[1] + 0.0015, eye[2] + 0.0275], [0.0215, 0.0185, 0.0235]), 0.008);
  const dome = ellipsoid(eye, [0.0134, 0.0132, 0.0131]);
  const lidU = capsule([0.0165, 1.6598, 0.0895], [0.0485, 1.6612, 0.0755], 0.0047);
  const lidL = capsule([0.0185, 1.6425, 0.0905], [0.0465, 1.6447, 0.0765], 0.0036);
  const brow = union(
    [
      capsule([0.006, 1.6715, 0.0905], [0.052, 1.6715, 0.0745], 0.0092),
      sphere([0.0, 1.6685, 0.0915], 0.0085), // glabella
      capsule([0.052, 1.668, 0.0745], [0.0615, 1.659, 0.056], 0.0055), // frontal process of zygomatic
      capsule([0.0585, 1.6375, 0.06], [0.0655, 1.64, 0.044], 0.0042), // zygomatic arch
      capsule([0.0495, 1.664, 0.0815], [0.0545, 1.646, 0.0795], 0.0072), // lateral orbital rim
      capsule([0.0625, 1.6285, 0.05], [0.0662, 1.6235, 0.0075], 0.0066), // arch over the bone
    ],
    0.008,
  );
  head = union([head, dome, lidU, lidL, brow], 0.0055);
  const opening = intersect(
    ellipsoid(add(eye, [0.0004, 0.0002, 0.012]), [0.0152, 0.0051, 0.02], frameEuler(0, 0, 0.11)),
    plane([0, 0, -1], add(eye, [0, 0, 0.0015])),
  );
  head = subtract(head, opening, 0.0007);
  // medial canthus / lacrimal fold
  head = union([head, sphere([0.0175, 1.6488, 0.0875], 0.0034)], 0.002);

  // ---- nose: bridge, side walls, tip, alae, columella
  const nose = union(
    [
      roundCone([0, 1.6645, 0.0925], [0, 1.623, 0.1085], 0.0052, 0.0072), // dorsum
      roundCone([0.0, 1.6, 0.0935], [0, 1.6645, 0.0905], 0.0005, 0.0035), // bridge root blend
      ellipsoid([0.0095, 1.6285, 0.0945], [0.0072, 0.0165, 0.0115], frameEuler(0, 0, -0.12)), // lateral wall
      roundCone([0, 1.623, 0.1085], [0, 1.611, 0.1155], 0.0072, 0.0078), // supratip to tip
      sphere([0, 1.6095, 0.1155], 0.0078), // lobule
      ellipsoid([0.0128, 1.6045, 0.1025], [0.0056, 0.0078, 0.0078], frameEuler(0, -0.3, 0.12)), // ala
      ellipsoid([0.0085, 1.6055, 0.1075], [0.0048, 0.0062, 0.006]), // lateral crus
      capsule([0.0, 1.611, 0.1135], [0, 1.5995, 0.1055], 0.0048), // columella
    ],
    0.0045,
  );
  head = union([head, nose], 0.0055);
  // nostrils from below
  head = subtract(head, ellipsoid([0.0078, 1.5972, 0.1075], [0.0034, 0.0062, 0.0065], frameEuler(0.35, 0, -0.2)), 0.0012);

  // ---- mouth: orbicularis ring, vermilion (thin upper, fuller lower), commissures
  const lips = union(
    [
      capsule([0, 1.589, 0.1005], [0.012, 1.5885, 0.0975], 0.0058),
      capsule([0.012, 1.5885, 0.0975], [0.0235, 1.5825, 0.0895], 0.0036),
      capsule([0, 1.5705, 0.1005], [0.012, 1.5712, 0.0965], 0.0082),
      capsule([0.012, 1.5712, 0.0965], [0.0215, 1.5765, 0.0895], 0.0048),
      ellipsoid([0, 1.5698, 0.0985], [0.0105, 0.0064, 0.0078]),
      sphere([0.0245, 1.5815, 0.0865], 0.0036), // modiolus
    ],
    0.0028,
  );
  head = union([head, lips], 0.0032);
  head = subtract(head, capsule([0, 1.5806, 0.1135], [0.0225, 1.5815, 0.0925], 0.0008), 0.0012);
  return head;
}

type Spec = [string, number, number, number, number, number, number, number?];
/** Relief specs for the face (projected onto the skin: 'f' from the front, 'l' from the side). */
export const FACE_SPECS: Spec[] = [
  ['f', 0.054, 1.654, 0.054, 1.654, 0.02, 2.4, 1.3], // orbital rim / cheekbone, soft
  ['l', 0.012, 1.598, 0.012, 1.598, 0.022, 1.6], // chin angle
  ['f', 0.026, 1.661, 0.026, 1.661, 0.016, 0.8],
  ['f', 0.012, 1.676, 0.05, 1.679, 0.0085, 1.0], // brow, soft
  ['f', 0.02, 1.6618, 0.046, 1.6635, 0.0017, -0.8], // upper lid crease
  ['f', 0.02, 1.6455, 0.044, 1.6465, 0.004, -0.12], // lower lid line (soft, no crease)
  ['f', 0.025, 1.635, 0.045, 1.636, 0.011, -0.25], // tear trough (broad, shallow)
  ['f', 0.05, 1.655, 0.058, 1.664, 0.0014, -0.3], ['f', 0.05, 1.649, 0.059, 1.648, 0.0014, -0.15], // crow's feet
  ['l', 0.045, 1.666, 0.035, 1.656, 0.014, -1.6], // temple hollow
  ['f', 0.049, 1.588, 0.048, 1.572, 0.013, -1.6], // buccal hollow
  ['f', 0.0, 1.664, 0.0, 1.648, 0.0045, -0.8], // nasion
  ['f', 0.0125, 1.6105, 0.0112, 1.6, 0.002, -1.0], // alar crease
  ['f', 0.0125, 1.642, 0.0145, 1.616, 0.0028, -0.7], // nasal sidewall groove
  ['f', 0.026, 1.6035, 0.0225, 1.5885, 0.0045, -1.2], // nasolabial fold
  ['f', 0.0048, 1.5985, 0.0055, 1.5905, 0.0018, 0.9], // philtrum column
  ['f', 0.0, 1.5985, 0.0, 1.5905, 0.0022, -0.6], // philtrum groove
  ['f', 0.005, 1.5895, 0.012, 1.5888, 0.0026, 0.8], // cupid's bow peaks
  ['f', 0.0, 1.5895, 0.0, 1.5895, 0.0018, -0.6], // bow notch
  ['f', 0.0, 1.5955, 0.022, 1.5885, 0.0016, -0.5], // upper vermilion border
  ['f', 0.0, 1.5622, 0.017, 1.5668, 0.002, -0.7], // lower vermilion border
  ['f', 0.0, 1.5872, 0.0, 1.5872, 0.0025, 0.5], // tubercle
  ['f', 0.0, 1.5805, 0.0238, 1.5815, 0.0013, -1.6], // mouth line
  ['f', 0.0252, 1.582, 0.0252, 1.582, 0.0032, -0.9], // mouth corner
  ['f', 0.0, 1.5585, 0.014, 1.559, 0.0046, -1.7], // mentolabial sulcus
  ['f', 0.0, 1.549, 0.0, 1.549, 0.014, 1.5], ['f', 0.05, 1.585, 0.05, 1.575, 0.014, 1.2],
  ['f', 0.036, 1.558, 0.02, 1.541, 0.008, 0.8], // mandible border
  ['f', 0.0, 1.545, 0.0, 1.545, 0.0035, -0.5], // chin cleft hint
];
