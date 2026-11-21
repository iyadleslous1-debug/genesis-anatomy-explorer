// C1a: classify BodyParts3D files -> data/bp3d_classified.json. Read-only on data/bp3d; deterministic.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const D = (p) => path.join(ROOT, 'data', p);

// ---------- load
const leaf = fs.readFileSync(D('bp3d_leaf.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const anc = {};
fs.readFileSync(D('bp3d/isa_element_parts.txt'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).forEach((l) => {
  const [, n, f] = l.split('\t'); (anc[f] = anc[f] || new Set()).add(n.toLowerCase());
});
const fileSet = new Set(leaf.map((r) => r[0]));
const objDir = D('bp3d/obj/isa_BP3D_4.0_obj_99');
const onDisk = fs.existsSync(objDir) ? fs.readdirSync(objDir).filter((f) => f.endsWith('.obj')).map((f) => f.slice(0, -4)) : [];
const missingFromLeaf = onDisk.filter((f) => !fileSet.has(f));

const SYSROOT = { integumentary: 'integumentary', muscular: 'muscular', skeletal: 'skeletal', cardiovascular: 'cardiovascular', nervous: 'nervous', respiratory: 'respiratory', digestive: 'digestive', urinary: 'urinary', reproductive: 'reproductive', endocrine: 'endocrine', lymphatic: 'lymphatic' };
const SYSNAME = { integumentary: 'Skin & Fat', muscular: 'Muscles', skeletal: 'Skeleton', cardiovascular: 'Cardiovascular', nervous: 'Nervous', respiratory: 'Respiratory', digestive: 'Digestive', urinary: 'Urinary', reproductive: 'Reproductive', endocrine: 'Endocrine', lymphatic: 'Lymphatic' };

// ---------- helpers
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const twinBase = new Set(leaf.map((r) => r[0]).filter((f) => f.endsWith('M')).map((f) => f.slice(0, -1)));

// ---------- rules
// muscle drivers: [regex on name, bone, sign, gain]  (vocabulary and sign as MUSCLE_DRIVERS in muscles.ts)
const DRV = [
  [/biceps brachii|brachialis|brachioradialis|pronator teres|supinator/, 'forearm', 1, 1.1],
  [/triceps|anconeus/, 'forearm', -1, 1],
  [/deltoid|pectoralis major|coracobrachialis|supraspinatus|pectoralis minor/, 'upperarm', 1, 0.8],
  [/latissimus|teres major|infraspinatus|teres minor|subscapularis/, 'upperarm', -1, 0.8],
  [/flexor carpi|palmaris|abductor digiti minimi of hand|flexor digiti minimi brevis of hand|opponens digiti minimi of hand|flexor pollicis brevis|abductor pollicis brevis|opponens pollicis|pronator quadratus/, 'hand', 1, 1.2],
  [/extensor carpi|abductor pollicis longus/, 'hand', -1, 1.2],
  [/flexor digitorum (superficialis|profundus)|lumbrical of hand|interosse\w* of hand|dorsal interosse|palmar interosse/, 'f2_1', 1, 1],
  [/extensor digitorum$|extensor digitorum \(|extensor digiti minimi|extensor indicis/, 'f2_1', -1, 1],
  [/flexor pollicis longus|adductor pollicis/, 'f1_1', 1, 1],
  [/extensor pollicis/, 'f1_1', -1, 1],
  [/iliopsoas|iliacus|psoas major|rectus femoris|sartorius|tensor fasciae latae|pectineus|adductor (longus|brevis|minimus)|gracilis/, 'thigh', 1, 0.9],
  [/gluteus|adductor magnus|piriformis|gemellus|obturator|quadratus femoris/, 'thigh', -1, 0.9],
  [/biceps femoris|semitendinosus|semimembranosus|popliteus|gastrocnemius|plantaris/, 'shin', 1, 0.9],
  [/vastus/, 'shin', -1, 0.9],
  [/soleus|tibialis posterior|flexor digitorum longus|flexor hallucis|fibularis (longus|brevis)|flexor digitorum brevis|flexor accessorius|abductor hallucis|abductor digiti minimi of foot/, 'foot', 1, 1.2],
  [/tibialis anterior|extensor hallucis|extensor digitorum longus|fibularis tertius|extensor digitorum brevis/, 'foot', -1, 1.2],
  [/sternocleidomastoid|scalenus|sternohyoid|omohyoid|sternothyroid|longus (colli|capitis)|rectus capitis anterior|rectus capitis lateralis|thyrohyoid/, 'neck', 1, 1],
  [/splenius|levator scapulae|trapezius|semispinalis (capitis|cervicis)|longissimus (capitis|cervicis)|rectus capitis posterior|obliquus capitis|iliocostalis cervicis|rhomboid/, 'neck', -1, 1],
  [/masseter|temporalis|medial pterygoid|lateral pterygoid/, 'jaw', -1, 1],
  [/digastric|mylohyoid|geniohyoid|platysma/, 'jaw', 1, 1],
  [/lumbrical of foot|plantar interosse|digiti minimi (brevis|opponens)?.*foot|opponens digiti minimi of foot|flexor digiti minimi brevis of foot|adductor hallucis/, 'foot', 1, 1],
  [/serratus anterior|subclavius/, 'upperarm', 1, 0.6],
  [/stylohyoid/, 'neck', 1, 1],
  [/set of dorsal interossei|set of lumbricals|set of palmar interossei/, 'f2_1', 1, 1],
  [/levatores costarum|intertransvers|interspinal/, 'spine_T12', -1, 0.6],
  [/rectus abdominis|oblique|transversus abdominis|pyramidalis/, 'spine_T12', 1, 1],
  [/iliocostalis (lumborum|thoracis)|longissimus thoracis|spinalis|quadratus lumborum|multifidus|rotator|interspinalis|intertransversarius|semispinalis thoracis|serratus posterior/, 'spine_T12', -1, 1],
];
function driverFor(n) {
  const s = n.replace(/\b(left|right) /g, '');
  for (const [re, b, sg, g] of DRV) if (re.test(s)) return { bone: b, sign: sg, gain: g };
  return null;
}

const V = (re, s) => re.test(s);

// returns {system,tissue,grp:[label...], anim?, skip?, rigid?:string(bone w/o side or full), dec?}
function classify(f, n, A, ap, tris, side) {
  const r = (system, tissue, grp, o) => Object.assign({ system, tissue, grp }, o || {});
  const S = side || '';
  const has = (x) => A.has(x);
  // ---- skin
  if (f === 'FJ1' || n === 'skin' || A.has('skin') && tris > 150000) return r('integumentary', 'skin', ['Skin'], { dec: 1 });
  if (/hair|nail|areola|nipple|eyebrow|eyelash/.test(n) && !/ligament/.test(n)) return r('integumentary', 'skin', ['Hair & nails'], { skip: true, dec: 1 });
  // ---- teeth / gingiva
  if (/gingiva/.test(n)) return r('digestive', 'mucosa', ['Mouth'], { rigid: 'head', dec: 1 });
  if (has('tooth') || /\bmolar|incisor|canine tooth|premolar/.test(n)) return r('skeletal', 'tooth', ['Teeth', /lower/.test(n) ? 'Lower teeth' : 'Upper teeth'], { rigid: /lower/.test(n) ? 'jaw' : 'head', dec: 1 });
  const isVes = /artery|vein|branch|trunk|sinus of|aorta|vena cava/.test(n);
  if (/^(third|fourth|left lateral|right lateral|lateral) ventricle|ventricle of brain/.test(n)) return r('nervous', 'brain', ['Brain', 'Ventricles'], { skip: true, rigid: 'head' });
  if (/interosseous membrane|conus elasticus|retinaculum|plantar ligament|raphe/.test(n) && !/pharyngeal/.test(n)) { const t = /raphe/.test(n) ? 'tendon' : 'ligament'; return r(/conus/.test(n) ? 'respiratory' : /raphe/.test(n) ? 'muscular' : 'skeletal', t, [t === 'tendon' ? 'Tendons' : 'Ligaments'], { rigid: ligRigid(n, S), dec: 1 }); }
  if (/corona ciliaris|common tendinous ring|trochlea of/.test(n)) return r('nervous', 'eye', ['Eye'], { rigid: 'head', dec: 1 });
  if (/^decussation|region of dura mater|dura mater/.test(n)) return r('nervous', 'brain', ['Brain', 'Meninges'], { rigid: 'head', dec: 0.6 });
  if (/conduit space/.test(n)) return r('cardiovascular', 'artery', ['Arteries', 'Other'], { skip: true });
  if (/^ileocecal junction/.test(n)) return r('digestive', 'colon', ['Large intestine'], { rigid: 'spine_L3', dec: 1 });
  if (/deferent duct/.test(n)) return r('reproductive', 'gland', ['Reproductive'], { rigid: 'pelvis', dec: 1 });
  if (/cystic duct/.test(n)) return r('digestive', 'gallbladder', ['Liver & biliary'], { rigid: 'spine_T12', dec: 1 });
  if (/^(left |right )?(superficial |deep )?(plantar|palmar) (arterial )?arch|palmar arterial arch/.test(n) && !/venous/.test(n)) return r('cardiovascular', 'artery', ['Arteries', vesselRegion(n, ap, false)], { dec: 0.55 });
  if (/venous (arch|network)|palmar venous|dorsal venous/.test(n)) return r('cardiovascular', 'vein', ['Veins', vesselRegion(n, ap, true)], { dec: 0.55 });
  // ---- heart
  if (/valve|cusp|leaflet|chordae/.test(n)) return r('cardiovascular', 'valve', ['Heart'], { skip: true, rigid: 'spine_T7' });
  if (/papillary/.test(n)) return r('cardiovascular', 'myocardium', ['Heart'], { skip: true, rigid: 'spine_T7' });
  if (/cavity of|lumen of|blood/.test(n) && /atri|ventric|heart/.test(n)) return r('cardiovascular', 'myocardium', ['Heart'], { skip: true, rigid: 'spine_T7' });
  if (!isVes && /wall of (right |left )?ventricle|^ventricular|interventricular septum|myocardium of (left |right )?ventricle/.test(n)) return r('cardiovascular', 'myocardium', ['Heart'], { anim: 'ventricle', rigid: 'spine_T7', dec: 0.6 });
  if (!isVes && /wall of (right |left )?atrium|auricle of (left|right) atrium|interatrial|^atrial/.test(n)) return r('cardiovascular', 'atrium', ['Heart'], { anim: 'atrium', rigid: 'spine_T7', dec: 0.8 });
  if (has('heart') && !isVes && !has('artery') && !has('vein')) return r('cardiovascular', 'myocardium', ['Heart'], { rigid: 'spine_T7', dec: 0.8 });
  // ---- bones / cartilage / ligaments
  if (/intervertebral disk|intervertebral disc/.test(n)) return r('skeletal', 'disc', ['Intervertebral discs'], { rigid: vertBone(n, true), dec: 0.8 });
  if (has('laryngeal cartilage') || /(thyroid|cricoid|arytenoid|epiglottis|corniculate|cuneiform) cartilage|^epiglottic|^cricoid|^thyroid cartilage/.test(n)) return r('respiratory', 'cartilage', ['Larynx'], { rigid: 'neck', dec: 1 });
  if (has('costal cartilage')) return r('skeletal', 'cartilage', ['Costal cartilages', S === 'L' ? 'Left costal cartilages' : S === 'R' ? 'Right costal cartilages' : 'Costal cartilages'], { rigid: ribBone(n, S) || 'sternum', dec: 0.8 });
  if (has('cartilage organ') || /cartilage/.test(n)) return r('skeletal', 'cartilage', ['Other cartilage'], { rigid: 'head', dec: 1 });
  if (!/artery|vein|nerve|muscle|ligament|ganglion/.test(n) && (has('bone organ') || /\bbone\b|vertebra|\brib\b|sternum|sacrum|coccyx|hyoid|patella|femur|humerus|tibia|fibula|scapula|clavicle|mandible|\bulna\b|radius|skull|phalanx|metacarpal|metatarsal|talus|calcaneus|xiphoid|manubrium/.test(n) && !has('muscle organ'))) {
    const b = boneRigid(n, S);
    return r('skeletal', 'bone', ['Bones', boneRegion(n, ap)], { rigid: b, dec: 0.7 });
  }
  if (has('ligament organ component') || /ligament/.test(n) && !has('muscle organ')) {
    const eye = /eye|ocular|orbit|retina|sclera|zonule|check|suspensory/.test(n);
    return r(eye ? 'nervous' : 'skeletal', 'ligament', [eye ? 'Eye' : 'Ligaments'], { rigid: eye ? 'eye.' + (S || 'L') : /larynx|laryn|vocal|cricothyroid|epiglot/.test(n) ? 'neck' : ligRigid(n, S), dec: 1 });
  }
  // ---- tendons
  if (/tendon|tendinous arch/.test(n) && !/tendinous ring/.test(n)) return r('muscular', 'tendon', ['Tendons'], { dec: 1, driver: /calcaneal/.test(n) ? { bone: 'foot', sign: 1, gain: 1.2 } : undefined });
  // ---- diaphragm
  if (n === 'diaphragm' || /^diaphragm/.test(n)) return r('respiratory', 'diaphragm', ['Diaphragm'], { anim: 'diaphragm', rigid: 'spine_T12', dec: 0.5 });
  // ---- muscles
  if (/papillary|taenia/.test(n) === false && (has('muscle organ') || has('zone of muscle organ') || has('head of muscle organ') || /muscle|set of.*(interosse|lumbric|levator|intertransvers|interspinal)|trapezius/.test(n))) {
    if (/intestin|colon|sphincter of|ureter|bladder|detrusor/.test(n) && !/anal|urethral/.test(n)) { /* smooth muscle (unlikely) falls through */ }
    const region = muscleRegion(n, ap);
    const d = driverFor(n);
    const intercost = /intercostal/.test(n);
    return r('muscular', 'muscle', ['Muscles', region, S === 'L' ? 'Left' : S === 'R' ? 'Right' : ''], { driver: d || undefined, dec: intercost ? 0.3 : 0.45, rigid: undefined });
  }
  if (/taenia/.test(n)) return r('digestive', 'colon', ['Colon'], { rigid: 'spine_L3' });
  // ---- vessels
  if (has('artery') || has('vein') || has('arterial tree organ') || has('venous tree organ') || has('arterial trunk') || has('venous trunk') || /\b(artery|arteries|vein|veins|aorta|vena cava|sinus)\b/.test(n)) {
    const isV = has('vein') || (/\bvein|vena cava|venous|sinus/.test(n) && !has('artery'));
    const cor = has('coronary artery') || has('cardiac vein') || /coronary|cardiac vein|great cardiac|middle cardiac|small cardiac|oblique vein of left atrium/.test(n);
    const tissue = cor ? 'coronary' : isV ? 'vein' : 'artery';
    const o = { dec: 0.55 };
    if (cor) { o.anim = 'heartAux'; o.rigid = 'spine_T7'; }
    else if (/ascending aorta|arch of aorta|aortic arch|pulmonary trunk|superior vena cava|^inferior vena cava|aortic root|brachiocephalic trunk|brachiocephalic vein/.test(n) || /^(right |left )?(common )?pulmonary (artery|vein)$/.test(n)) { o.anim = 'heartAux'; }
    if (/cerebral|basilar|ophthalmic|choroidal|cerebellar|vertebral artery|communicating|dural|sigmoid sinus|transverse sinus|sagittal sinus|cavernous|petrosal|straight sinus|diploic|ethmoidal|labyrinthine/.test(n) && !cor) o.rigid = 'head';
    return r('cardiovascular', tissue, [isV ? 'Veins' : 'Arteries', vesselRegion(n, ap, isV)], o);
  }
  // ---- cardiac fallback
  if (has('heart') || /atrium|ventricle|cardiac/.test(n)) return r('cardiovascular', 'myocardium', ['Heart'], { rigid: 'spine_T7' });
  // ---- brain / nervous
  if (/lateral ventricle|third ventricle|fourth ventricle|ventricle of brain|cerebral aqueduct|cavity of|lumen of|central canal|subarachnoid|chamber of|vitreous|aqueous|posterior chamber|anterior chamber/.test(n) && !/heart/.test(ap))
    return r(/chamber|vitreous|aqueous/.test(n) ? 'nervous' : 'nervous', /chamber|vitreous|aqueous/.test(n) ? 'eye' : /central canal/.test(n) ? 'cord' : 'brain', [/chamber|vitreous|aqueous/.test(n) ? 'Eye' : 'Brain'], { skip: true, rigid: /chamber|vitreous|aqueous/.test(n) ? 'eye.' + (S || 'L') : 'head' });
  if (/cerebellum|cerebellar|vermis/.test(n) && !/artery|vein/.test(n)) return r('nervous', 'cerebellum', ['Brain', 'Cerebellum'], { rigid: 'head', dec: 0.6 });
  if (/midbrain|pons|medulla oblongata|hindbrain|brainstem|brain stem|mesencephalon|metencephalon|myelencephalon|cerebral peduncle|tegmentum|tectum/.test(n)) return r('nervous', 'brainstem', ['Brain', 'Brainstem'], { rigid: 'head', dec: 0.8 });
  if (has('gyrus of neuraxis') || has('segment of brain') || has('segment of neuraxis') || has('white matter of neuraxis') || has('nucleus of brain') || has('cell part cluster of neuraxis') || has('brain') || has('central nervous system') || /gyrus|lobe of (cerebr|brain)|occipital lobe|thalamus|hypothalam|fornix|corpus callosum|caudate nucleus|putamen|globus|amygdala|hippocamp|cerebral|white matter|grey matter|gray matter|insula|choroid plexus|septum pellucidum|pineal|epithalam|lentiform|capsule|commissure|cingulate|colliculus|ventricle/.test(n) && !/artery|vein/.test(n))
    return r('nervous', 'brain', ['Brain', brainRegion(n, S)], { rigid: 'head', dec: 0.6 });
  if (/spinal cord/.test(n)) return r('nervous', 'cord', ['Spinal cord'], { rigid: 'spine_T7' });
  if (has('nerve') || /nerve|ganglion|optic chiasm|chiasma|optic tract|trigeminal|olfactory (bulb|tract)|nerve root/.test(n)) return r('nervous', 'nerve', ['Nerves', S === 'L' ? 'Left' : S === 'R' ? 'Right' : ''], { rigid: 'head', dec: 0.7 });
  if (/pituitary|hypophysis/.test(n)) return r('endocrine', 'gland', ['Endocrine'], { rigid: 'head', dec: 1 });
  // ---- eye / ear
  if (/iris/.test(n)) return r('nervous', 'iris', ['Eye'], { rigid: 'eye.' + (S || 'L'), dec: 1 });
  if (/\blens\b/.test(n) && !/artery|vein/.test(n)) return r('nervous', 'lens', ['Eye'], { rigid: 'eye.' + (S || 'L'), dec: 1 });
  if (/eye|eyeball|sclera|cornea|retina|choroid|ciliary|pupil|conjunctiva|uvea|orbital|optic|vitre/.test(n) || has('eyeball') || has('ocular globe')) return r('nervous', 'eye', ['Eye'], { rigid: 'eye.' + (S || 'L'), dec: 1 });
  if (/eyelid|palpebra|lacrimal|tarsal plate|tarsus of|orbital fat|orbicular/.test(n)) return r('nervous', 'eye', ['Eye'], { rigid: 'head', dec: 1 });
  if (/ear|cochlea|tympanic|auditory|malleus|incus|stapes|ossicle|semicircular|vestib|labyrinth|eustachian|pinna|auricle of ear|helix/.test(n) || has('ear')) return r('nervous', 'ear', ['Ear'], { rigid: 'head', dec: 1 });
  // ---- respiratory
  if (has('segment of bronchial tree') || has('segment of tracheobronchial tree') || /bronch|trachea/.test(n)) return r('respiratory', 'airway', ['Airway', /trachea$|^trachea/.test(n) ? 'Trachea' : 'Bronchial tree'], { anim: 'bronchi', rigid: 'spine_T7', dec: 0.7 });
  if (/larynx|laryn|glottis|vocal|vestibular fold|ventricular fold|laryngeal/.test(n)) return r('respiratory', 'airway', ['Larynx'], { rigid: 'neck', dec: 1 });
  if (/lung|pleura|alveol/.test(n)) return r('respiratory', 'lung', ['Lung'], { rigid: 'spine_T7' });
  if (/nasal|nose|nostril|naris|sinus|choana|turbinate|concha|septum of nose|paranasal/.test(n)) return r('respiratory', 'mucosa', ['Nose'], { rigid: 'head', dec: 1 });
  if (/pharyn|nasopharynx|oropharynx|laryngopharynx/.test(n)) return r('digestive', 'mucosa', ['Pharynx'], { rigid: 'neck', dec: 1 });
  // ---- digestive
  if (/liver|hepatic|caudate lobe|quadrate lobe|segment of liver|hepatovenous/.test(n) || has('liver') || has('hepatovenous subsector')) {
    const biliary = /bile|biliary|cystic|hepatic duct|ampulla|gallbladder|sphincter of oddi/.test(n) || has('biliary tree');
    if (/gallbladder/.test(n)) return r('digestive', 'gallbladder', ['Liver & biliary'], { rigid: 'spine_T12', dec: 1 });
    if (biliary) return r('digestive', 'gallbladder', ['Liver & biliary'], { rigid: 'spine_T12', dec: 1 });
    return r('digestive', 'liver', ['Liver & biliary'], { skip: true, rigid: 'spine_T12' });
  }
  if (/gallbladder|bile duct|biliary/.test(n)) return r('digestive', 'gallbladder', ['Liver & biliary'], { rigid: 'spine_T12', dec: 1 });
  if (/stomach|gastric|pylor|fundus of stomach|cardia|rugal/.test(n) || has('stomach')) return r('digestive', 'stomach', ['Stomach'], { rigid: 'spine_T12', dec: 1 });
  if (/duoden|jejun|ileum|ileal|small intestine/.test(n) || has('small intestine')) return r('digestive', 'intestine', ['Small intestine', /duoden/.test(n) ? 'Duodenum' : /jejun/.test(n) ? 'Jejunum' : 'Ileum'], { rigid: /duoden/.test(n) ? 'spine_T12' : 'spine_L3', dec: 0.8 });
  if (/colon|cecum|caecum|appendix|rectum|anal canal|large intestine|sigmoid|anus/.test(n) || has('large intestine')) return r('digestive', 'colon', ['Large intestine'], { rigid: /rectum|anal|anus|sigmoid/.test(n) ? 'pelvis' : 'spine_L3', dec: 0.8 });
  if (/esophag|oesophag/.test(n) || has('esophagus')) return r('digestive', 'esophagus', ['Esophagus'], { rigid: 'spine_T7', dec: 1 });
  if (/pancrea/.test(n) || has('parenchyma of pancreas')) return r('digestive', 'pancreas', ['Pancreas'], { rigid: 'spine_T12', dec: 1 });
  if (/tongue|lingual|glossal/.test(n) || has('tongue')) return r('digestive', 'tongue', ['Mouth'], { rigid: 'jaw', dec: 1 });
  if (/salivary|parotid|submandibular gland|sublingual gland|gland of mouth/.test(n)) return r('digestive', 'salivary', ['Mouth'], { rigid: 'head', dec: 1 });
  if (/palate|lip|cheek|oral|mouth|uvula|tonsil|vestibule of mouth|buccal/.test(n)) return r(/tonsil/.test(n) ? 'lymphatic' : 'digestive', /tonsil/.test(n) ? 'node' : 'mucosa', [/tonsil/.test(n) ? 'Lymphoid' : 'Mouth'], { rigid: 'head', dec: 1 });
  if (/mesenter|omentum|peritone|intestin|bowel/.test(n)) return r('digestive', 'intestine', ['Small intestine', 'Other'], { rigid: 'spine_L3' });
  // ---- urinary / reproductive / endocrine / lymphatic
  if (/kidney|renal|nephr/.test(n)) return r('urinary', has('renal medulla') || /medulla|pyramid/.test(n) ? 'medulla' : /pelvis|calyx|calix/.test(n) ? 'pelvis' : 'kidney', ['Kidneys'], { rigid: 'spine_T12', dec: 1 });
  if (/ureter/.test(n)) return r('urinary', 'pelvis', ['Urinary tract'], { rigid: 'spine_L3', dec: 1 });
  if (/bladder|urethra/.test(n)) return r('urinary', 'bladder', ['Urinary tract'], { rigid: 'pelvis', dec: 1 });
  if (/prostate/.test(n)) return r('reproductive', 'prostate', ['Reproductive'], { rigid: 'pelvis', dec: 1 });
  if (/testis|testes|epididym|vas deferens|ductus deferens|seminal|penis|scrot|spermatic|ejaculatory|bulbourethral|corpus (cavernosum|spongiosum)|glans/.test(n)) return r('reproductive', 'gland', ['Reproductive'], { rigid: 'pelvis', dec: 1 });
  if (/thyroid gland|thyroid$|^(left|right) lobe of thyroid|isthmus of thyroid/.test(n)) return r('endocrine', 'thyroid', ['Endocrine'], { rigid: 'neck', dec: 1 });
  if (/parathyroid/.test(n)) return r('endocrine', 'gland', ['Endocrine'], { rigid: 'neck', dec: 1 });
  if (/adrenal|suprarenal/.test(n)) return r('endocrine', 'adrenal', ['Endocrine'], { rigid: 'spine_T12', dec: 1 });
  if (/spleen/.test(n)) return r('lymphatic', 'lymph', ['Lymphoid'], { rigid: 'spine_T12', dec: 1 });
  if (/thymus/.test(n)) return r('lymphatic', 'lymph', ['Lymphoid'], { rigid: 'spine_T7', dec: 1 });
  if (/lymph|thoracic duct/.test(n)) return r('lymphatic', 'lymph', ['Lymphoid'], { dec: 1 });
  return null;
}

function ligRigid(n, S) { const sd = S || 'L'; if (/forearm|wrist/.test(n)) return 'forearm.' + sd; if (/plantar|foot/.test(n)) return 'foot.' + sd; if (/leg/.test(n)) return 'shin.' + sd; if (/conus|larynx/.test(n)) return 'neck'; return 'head'; }
function vertBone(n, disc) {
  const m = n.match(/\b(cervical|thoracic|lumbar|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)/);
  let k = null;
  let t = n.match(/(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) (cervical|thoracic|lumbar)/);
  if (t) k = [t[2], num[t[1]]];
  else { t = n.match(/\b(c|t|l)(\d{1,2})\b/); if (t) k = [{ c: 'cervical', t: 'thoracic', l: 'lumbar' }[t[1]], +t[2]]; }
  if (/atlas/.test(n)) k = ['cervical', 1]; if (/axis\b/.test(n)) k = ['cervical', 2]; if (/vertebra prominens/.test(n)) k = ['cervical', 7];
  if (!k) { if (/sacr|coccy/.test(n)) return 'pelvis'; if (m && /cervical|thoracic|lumbar/.test(m[1])) k = [m[1], 4]; else return 'spine_T12'; }
  const [reg, i] = k;
  if (reg === 'cervical') return 'neck';
  if (reg === 'thoracic') return i === 1 ? 'spine_T1' : i <= 7 ? 'spine_T7' : 'spine_T12';
  return i <= 3 ? 'spine_L3' : 'pelvis';
}
function ribBone(n, S) {
  const t = n.match(/(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) (?:rib|costal)/) || n.match(/(?:rib|costal cartilage)\s*(\d+)/);
  if (!t) return null;
  const i = num[t[1]] || +t[1];
  return `rib${i}.${S || 'L'}`;
}
function boneRigid(n, S) {
  const s = S || '';
  const sd = s || 'L';
  if (/vertebra|sacrum|coccyx|sacral/.test(n)) return vertBone(n);
  if (/\brib\b/.test(n)) return ribBone(n, s) || 'spine_T7';
  if (/sternum|manubrium|xiphoid/.test(n)) return 'sternum';
  if (/mandible/.test(n)) return 'jaw';
  if (/hyoid|ossicle|malleus|incus|stapes/.test(n)) return /hyoid/.test(n) ? 'neck' : 'head';
  if (/clavicle/.test(n)) return 'clavicle.' + sd;
  if (/scapula/.test(n)) return 'scapula.' + sd;
  if (/humerus/.test(n)) return 'upperarm.' + sd;
  if (/\bulna\b|radius/.test(n)) return 'forearm.' + sd;
  if (/phalanx.*(finger|hand)|finger.*phalanx|thumb|digit of hand|phalanx of (left|right)? ?(thumb|index|middle|ring|little)/.test(n)) {
    const fi = /thumb|pollex/.test(n) ? 1 : /index/.test(n) ? 2 : /middle/.test(n) ? 3 : /ring/.test(n) ? 4 : /little|fifth/.test(n) ? 5 : 3;
    const k = /distal/.test(n) ? 3 : /middle phalanx/.test(n) ? 2 : /proximal/.test(n) ? 1 : 1;
    return `f${fi}_${Math.min(fi === 1 ? 3 : 3, k)}.${sd}`.replace(/^f1_3/, 'f1_2');
  }
  if (/carpal|metacarpal|scaphoid|lunate|triquet|pisiform|trapezi|capitate|hamate/.test(n)) return 'hand.' + sd;
  if (/hip bone|ilium|ischium|pubis|pelvic/.test(n)) return 'pelvis';
  if (/femur|patella/.test(n)) return 'thigh.' + sd;
  if (/tibia|fibula/.test(n)) return 'shin.' + sd;
  if (/phalanx/.test(n)) return 'toes.' + sd;
  if (/tarsal|talus|calcaneus|navicular|cuboid|cuneiform|metatarsal|sesamoid/.test(n)) return 'foot.' + sd;
  return 'head';
}
function boneRegion(n, ap) {
  if (/vertebra|sacrum|coccyx|atlas|axis\b/.test(n)) return 'Vertebral column';
  if (/\brib\b|sternum|manubrium|xiphoid/.test(n)) return 'Thorax';
  if (/carpal|metacarpal|triquet|scaphoid|lunate|pisiform|trapezi|capitate|hamate|phalanx.*(finger|hand)|thumb|finger/.test(n) || /bone of hand|phalanx of hand|bone of finger/.test(ap)) return 'Hand';
  if (/tarsal|metatarsal|talus|calcaneus|navicular|cuboid|cuneiform|phalanx.*toe|toe|sesamoid|bone of foot/.test(n) || /bone of foot|phalanx of toe|bone of toe/.test(ap)) return 'Foot';
  if (/clavicle|scapula|humerus|\bulna\b|radius/.test(n)) return 'Upper limb';
  if (/hip bone|ilium|ischium|pubis|femur|patella|tibia|fibula/.test(n)) return 'Pelvis & lower limb';
  return 'Skull & face';
}
function muscleRegion(n, ap) {
  if (/extra-ocular|rectus$|oblique$|levator palpebrae|orbicularis|auricul|nasalis|procerus|corrugator|zygomatic|risorius|buccinator|mentalis|depressor|levator (labii|anguli)|occipitofrontalis|frontalis|epicranial|masseter|temporalis|pterygoid|tensor tympani|stapedius/.test(n) || /muscle of head|facial muscle|muscle of mastication|extra-ocular/.test(ap) && !/neck/.test(ap)) { if (/oblique|rectus/.test(n) && /abdominis|capitis|femoris/.test(n)) return 'Trunk'; return /ocular|rectus|oblique|levator palpebrae/.test(n) && !/abdominis|capitis|femoris/.test(n) ? 'Eye' : 'Head & face'; }
  if (/arytenoid|vocalis|cricothyroid|aryepiglott|pharyngeal|palat|stylopharyng|salpingopharyng|uvular/.test(n)) return 'Larynx & pharynx';
  if (/glossus|tongue|lingual/.test(n)) return 'Head & face';
  if (/muscle of upper limb|upper limb/.test(ap)) return 'Upper limb';
  if (/muscle of lower limb|lower limb/.test(ap)) return 'Lower limb';
  if (/muscle of neck|neck/.test(ap)) return 'Neck';
  if (/perineal|coccyg|levator ani|puborect|pubococc|iliococc|sphincter ani|ischiocavernosus|bulbospongiosus/.test(n)) return 'Pelvic floor';
  return 'Trunk';
}
function vesselRegion(n, ap, isV) {
  const t = [
    [/pulmonary/, 'Pulmonary'], [/coronary|cardiac|great cardiac/, 'Coronary'],
    [/cerebral|basilar|cerebellar|communicating|ophthalmic|choroidal|sinus|diploic|dural|labyrinth|jugular|facial|temporal|occipital|maxillary|lingual|thyroid|carotid|vertebral|ethmoid|angular|supraorbital|supratrochlear|meningeal|palatine|pharyngeal|auricular|retromandibular/, 'Head & neck'],
    [/subclavian|axillary|brachial|radial|ulnar|cephalic|basilic|palmar|digital.*hand|interosseous|thoracodorsal|scapular|circumflex humeral|median cubital|cubital/, 'Upper limb'],
    [/femoral|popliteal|tibial|fibular|peroneal|plantar|saphenous|dorsalis pedis|genicular|perforat|gluteal|obturator|digital.*foot|dorsal venous arch/, 'Lower limb'],
    [/hepatic|portal|splenic|gastric|mesenteric|celiac|colic|ileocolic|jejunal|ileal|pancreat|gastroepiploic|cystic|gastroduodenal/, 'Abdominal viscera'],
    [/renal|suprarenal|gonadal|testicular|lumbar|iliac|rectal|vesical|prostat|pudendal|sacral|epigastric|iliolumbar|circumflex iliac|umbilical/, 'Abdomen & pelvis'],
    [/aort|vena cava|brachiocephalic|intercostal|azygos|thoracic|pericardiac|mammary|phrenic|bronchial|esophageal|mediastinal/, 'Trunk & great vessels'],
  ];
  if (/brachiocephalic|aort|vena cava|azygos/.test(n)) return 'Trunk & great vessels';
  for (const [re, g] of t) if (re.test(n)) return g;
  for (const [re, g] of t) if (re.test(ap)) return g;
  return 'Other';
}
function brainRegion(n, S) {
  if (/thalam|hypothal|fornix|caudate|putamen|globus|lentiform|septum|amygdal|hippocamp|epithal|pineal|basal|nucleus/.test(n)) return 'Deep structures';
  if (/white matter|capsule|callosum|commissure/.test(n)) return 'White matter';
  if (/choroid plexus/.test(n)) return 'Choroid plexus';
  return 'Cortex';
}

// ---------- main
const files = {};
const sideOf = (n, f, mn, mx) => {
  const m = n.match(/\b(left|right)\b/);
  if (m) return m[1] === 'left' ? 'L' : 'R';
  const base = f.endsWith('M') ? f.slice(0, -1) : f;
  if (twinBase.has(base) || f.endsWith('M')) { const cx = (mn[0] + mx[0]) / 2; if (Math.abs(cx) > 3) return cx > 0 ? 'L' : 'R'; }
  return '';
};
const unclassified = [];
const rows = [];
for (const r of leaf) {
  const f = r[0], name = r[2], n = name.toLowerCase();
  const tris = +r[4]; const mn = r[5].split(',').map(Number), mx = r[6].split(',').map(Number);
  const A = anc[f] || new Set(); const ap = [...A].join('|');
  const S = sideOf(n, f, mn, mx);
  const nn = n.replace(/\b(left|right)\b ?/, '');
  let c = classify(f, S ? n : n, A, ap, tris, S);
  if (!c) { unclassified.push([f, name]); c = { system: 'skeletal', tissue: 'bone', grp: ['Unclassified'], uncl: true, dec: 0.7 }; }
  rows.push({ f, name, n, S, tris, mn, mx, c });
}

// display names + ids
function displayName(name, S, n) {
  let s = name.toLowerCase();
  // "long head of left biceps brachii" -> "left biceps brachii (long head)"
  let m = s.match(/^(.+?) (head|part) of (left|right) (.+)$/);
  if (m) s = `${m[3]} ${m[4]} (${m[1]} ${m[2]})`;
  else if ((m = s.match(/^(.+?) (head|part) of (.+)$/)) && S && /muscle|biceps|triceps|pectoralis|deltoid|trapezius|gastrocnemius|femoris|flexor|adductor|pronator|cricothyroid|longus colli/.test(s)) s = `${S === 'L' ? 'left' : 'right'} ${m[3]} (${m[1]} ${m[2]})`;
  s = s.replace(/^(left|right) (.*) muscle$/, '$1 $2');
  if (S && !/\b(left|right)\b/.test(s)) s = (S === 'L' ? 'left ' : 'right ') + s;
  return cap(s);
}
const usedIds = {};
for (const x of rows) {
  const dn = displayName(x.name, x.S, x.n);
  let base = slug(dn.replace(/\b(left|right)\b/gi, '').replace(/\(([^)]*)\)/, '$1'));
  let id = 'bp.' + base + (x.S ? '.' + x.S : '');
  if (usedIds[id]) { let k = 2; while (usedIds[id + '_' + k]) k++; id = id + '_' + k; }
  // numbered duplicates read nicely
  let name = dn;
  const dupN = id.match(/_(\d+)$/);
  if (dupN) name = dn + ' (' + dupN[1] + ')';
  usedIds[id] = 1;
  x.id = id; x.dn = name;
}
// numbered first occurrence for duplicates: rename first of any dup group to "(1)"
const byBase = {};
rows.forEach((x) => { const b = x.id.replace(/_\d+$/, ''); (byBase[b] = byBase[b] || []).push(x); });
Object.values(byBase).forEach((a) => { if (a.length > 1) a[0].dn = a[0].dn + ' (1)'; });

// groups
const groups = {}; // id -> {id,name,parent,system}
const ensureGroup = (system, path) => {
  let parent = SYSROOT[system];
  let idp = 'bp.g.' + system;
  for (const label of path) {
    if (!label) continue;
    idp += '_' + slug(label);
    if (!groups[idp]) groups[idp] = { id: idp, name: label, parent, system };
    parent = idp;
  }
  return parent;
};
for (const x of rows) {
  const c = x.c;
  let path = c.grp.slice();
  // sided muscles/nerves: ensure side level named "Left X"
  if (c.tissue === 'muscle') {
    const reg = path[1];
    path = ['Muscles', reg];
    if (x.S) path.push(x.S === 'L' ? 'Left' : 'Right');
  }
  if (c.tissue === 'bone' && x.S && path.length === 2) path.push(x.S === 'L' ? 'Left' : 'Right');
  if ((c.tissue === 'artery' || c.tissue === 'vein') && x.S && path.length === 2) path.push(x.S === 'L' ? 'Left' : 'Right');
  if (c.tissue === 'brain' && x.S && path.length === 2) path.push(x.S === 'L' ? 'Left' : 'Right');
  x.parent = ensureGroup(c.system, path);
}
// split groups with > 25 children
function childCount() { const cc = {}; rows.forEach((x) => { cc[x.parent] = (cc[x.parent] || 0) + 1; }); Object.values(groups).forEach((g) => { cc[g.parent] = (cc[g.parent] || 0) + 1; }); return cc; }
for (let pass = 0; pass < 3; pass++) {
  const cc = childCount();
  for (const gid of Object.keys(cc)) {
    if (cc[gid] <= 25 || SYSROOT[gid]) continue;
    const g = groups[gid]; if (!g) continue;
    const kids = rows.filter((x) => x.parent === gid).sort((a, b) => a.dn.localeCompare(b.dn));
    if (kids.length <= 25) continue;
    const nsub = Math.ceil(kids.length / 20);
    const per = Math.ceil(kids.length / nsub);
    for (let i = 0; i < nsub; i++) {
      const part = kids.slice(i * per, (i + 1) * per);
      const sid = gid + '_p' + (i + 1);
      const f0 = part[0].dn.replace(/^(Left|Right) /, '').slice(0, 14), f1 = part[part.length - 1].dn.replace(/^(Left|Right) /, '').slice(0, 14);
      groups[sid] = { id: sid, name: `${g.name} (${f0} - ${f1})`, parent: gid, system: g.system };
      part.forEach((x) => { x.parent = sid; });
    }
  }
}

// output
const out = { files: {}, groups: [] };
for (const x of rows) {
  const c = x.c;
  const e = { id: x.id, name: x.dn, system: c.system, tissue: c.tissue, parent: x.parent };
  if (c.anim) e.anim = c.anim;
  if (c.driver) e.driver = c.driver;
  if (c.rigid) e.rigidBone = c.rigid;
  let dec = c.dec == null ? 0.6 : c.dec;
  if (c.tissue !== 'skin' && x.tris < 1500) dec = 1;
  e.decimate = dec;
  if (c.skip) e.skip = true;
  out.files[x.f] = e;
}
// unreferenced files on disk
missingFromLeaf.forEach((f) => { out.files[f] = { id: 'bp.unknown_' + f.toLowerCase(), name: 'Unknown ' + f, system: 'skeletal', tissue: 'bone', parent: ensureGroup('skeletal', ['Unclassified']), decimate: 1, skip: true }; });
const usedGroups = new Set(Object.values(out.files).map((e) => e.parent));
// keep ancestors
Object.keys(groups).forEach((id) => { });
const keep = new Set();
for (const gid of usedGroups) { let g = groups[gid]; while (g) { keep.add(g.id); g = groups[g.parent]; } }
// system roots are existing ids; emit only new groups
out.groups = Object.values(groups).filter((g) => keep.has(g.id)).sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(D('bp3d_classified.json'), JSON.stringify(out, null, 1));

// ---------- summary
const cnt = (k) => { const m = {}; Object.values(out.files).forEach((e) => { m[e[k]] = (m[e[k]] || 0) + 1; }); return m; };
console.log('files', Object.keys(out.files).length, 'groups', out.groups.length, 'unclassified', unclassified.length, 'not-in-leaf', missingFromLeaf.length);
console.log('system', JSON.stringify(cnt('system')));
console.log('tissue', JSON.stringify(cnt('tissue')));
const sk = Object.entries(out.files).filter(([, e]) => e.skip);
console.log('skipped', sk.length, sk.slice(0, 80).map(([f, e]) => e.name).join('; '));
console.log('with driver', Object.values(out.files).filter((e) => e.driver).length, 'muscles w/o driver:', Object.values(out.files).filter((e) => e.tissue === 'muscle' && !e.driver).map((e) => e.name).slice(0, 60).join('; '));
const kc = childCount(); const big = Object.entries(kc).filter(([, v]) => v > 25);
console.log('groups >25 children', big.length, big.slice(0, 10).join(','));
console.log('anim', JSON.stringify(cnt('anim')));
if (unclassified.length) console.log('UNCLASSIFIED:', unclassified.map((u) => u[0] + ':' + u[1]).join('; ').slice(0, 3000));
if (process.argv[2] === 'sample') { const ks = Object.keys(out.files); for (let i = 0; i < 60; i++) { const k = ks[Math.floor(Math.random() * ks.length)]; const e = out.files[k]; console.log(k, '|', leaf.find((r) => r[0] === k)[2], '=>', e.name, e.system, e.tissue, e.parent, e.rigidBone || '', e.driver ? e.driver.bone + e.driver.sign : '', e.skip ? 'SKIP' : ''); } }
