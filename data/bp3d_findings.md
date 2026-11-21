# BodyParts3D 4.0 (IS-A, 99% reduction) findings
License CC BY 4.0, Database Center for Life Science (DBCLS). Credit it in the app.

## Download
- URL: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip
- Size: 142,903,898 bytes (136 MiB); `unzip` OK. The server is slow (about 2-3 MB/min, took ~75 min).
- Also fetched from the same folder: isa_parts_list_e.txt (128 KB), isa_element_parts.txt (1.1 MB),
  isa_inclusion_relation_list.txt (203 KB), README_e.html.
- Unzipped to data/bp3d/obj/isa_BP3D_4.0_obj_99/ : 2234 files `FJxxxx.obj` (flat; no per-concept folders).
- Scripts (read-only on data; paths are args): scripts/bp3d/inspect.cjs (counts + bbox -> data/bp3d_inspect.json),
  leaf.cjs (file -> most specific concept -> data/bp3d_leaf.tsv), cat2.cjs (category totals), q.cjs (name query).
  They are .cjs because package.json has "type":"module".

## File layout / formats
- isa_parts_list_e.txt: TSV `concept id (FMAxxxx) | representation id (BPxxxx) | en name`, 2905 concepts.
- isa_element_parts.txt: TSV `FMA id | name | element file id (FJxxxx)`. Maps EVERY concept to ALL element files
  under it (parents list all descendant files). Use it for grouping.
- isa_inclusion_relation_list.txt: TSV `parent id | parent name | child id | child name` (IS-A edges).
- Duplication: NOT on disk. 2234 unique OBJ files; every file appears under many ancestor concepts, but the mesh
  is stored once (no union/parent meshes). Total over concepts would be heavily double-counted, so count by file.
  Use files directly; label each by the concept with the fewest files (data/bp3d_leaf.tsv, col2=FMA, col3=name).
  824 files belong to multi-file concepts (e.g. choroid = 2 files, fine: keep all files of a concept).
- OBJ: plain `v`/`f` (triangles), no groups needed. Not checked: normals (compute them), per-file exact duplicates.

## Totals
- 2234 files, 4,209,773 vertices, 6,681,030 triangles (median 960 tris/file; biggest = skin 203k, intercostals ~99k each).

## Coordinates -> app space
- Raw units: millimetres. Raw extents: x -334..333, y -247..45, z -78..1652 (hair top), skin top z=1641.
- Raw axes: +z = up, face looks toward -y (incisors at y~-180, molars -145), +x = subject's LEFT (left femur x>0,
  left teeth x>0), +y = posterior. Feet soles at z=-78 (skin; plantar veins -77); head top skin 1641 (+hair 1652).
  Height = 1.719 m (skin), arms hang at sides (arm span x +-334).
- Transform (proper rotation, det=+1): app.x = bp.x*0.001; app.y = (bp.z + 78)*0.001; app.z = -bp.y*0.001.
  Triangle winding is preserved (rotation, no mirror). Result: y up, feet at y=0, faces +z, +x = subject LEFT.
  Optionally centre x/z: body centre approx x=0, z (app) ~ +0.08 (raw y ~ -80).

## Categories (by IS-A ancestry; files / tris). Names are the BP3D "en" names
- skin: 1 file FMA7163, 203,382 tris (single closed mesh; hair of head/trunk exist as separate files; hair top 1652).
- bone organs: 203 files, 506k tris (FMA10037 tenth thoracic vertebra 2790; FMA16586 right hip bone 2374; hyoid FMA52749;
  all 24 ribs FMA7574 170k incl. cartilage? ; 45 vertebra files; 56 phalanx files; hand/foot bones individually present, e.g. talus FMA9708
  (2 files, 2736); metacarpals FMA9612; femora FMA24474/5 3102/3204). Skull bones individual (FMA52789 left parietal bone).
- teeth: 28 permanent teeth individually (e.g. FMA55704 left lower first molar 1762); gingiva FMA59763/4 (~1.9k each).
- skeletal muscles: 323 files, 2.09M tris (left/right individually, e.g. FMA22354/5 sartorius 3444, FMA43883/4 gracilis 3172,
  gluteus maximus L/R, tibialis ant., biceps femoris long/short head, deltoid parts, extra-ocular muscles).
  Heavy: intercostals (3 layers x2 sides ~88-99k each = 570k), iliotibial tracts 17k each, diaphragm FMA13295 68.5k.
- tendons: only 4 distinct files (calcaneal tendons L/R FMA258847/FMA264844 3882, levator palpebrae, intermediate tendon).
  Tendons are otherwise merged into muscle meshes.
- ligaments: 21 files (mostly eye: check/suspensory ligaments, larynx). Joint ligaments of limbs are essentially absent.
- cartilage/disks: 51 files, 79k tris (cricoid FMA9615, nasal cartilages, 23 intervertebral disks ~1.5-3.7k each; costal
  cartilage not verified separately).
- arteries: 562 files, 750k tris (named branches down to cerebral/coronary; aorta parts FMA3789 abdominal 2270, FMA87217
  descending thoracic 2290, arch 670, ascending 396, pulmonary trunk 1302; carotids, vertebral FMA3958/4066 800 each).
- veins: 342 files, 786k tris (SVC 598, IVC 1410/1670, portal FMA50735 3582, hepatic tributaries, plantar digital).
- coronary vessels: 72 files, ~35k tris (FMA3860 diagonal branches etc., FMA4677; cardiac veins ~10 files).
- heart: no single "heart" mesh. Parts: wall of right atrium 17.8k, wall of left atrium 7.5k, wall of ventricle FMA13884
  37k (one file, both ventricles merged), cavities of R/L atria and ventricles separate (1-2k each), papillary muscles, 11 valve
  files (mitral anterior leaflet 7.6k, tricuspid leaflet 8.2k, aortic/pulmonary cusps 0.3-1.4k). Chambers: cavities separate; walls
  of the 2 ventricles merged.
- brain: 68 files, 339k tris: 32 gyri (L/R individually, e.g. angular gyrus 3.6k, cingulate), occipital lobe L/R (4.4k),
  white matter of each hemisphere 25.5k, cerebellum FMA67944 (2 files, 47.7k), thalamus L/R, hypothalamus, lateral ventricles
  18k each, 3rd/4th, fornix, midbrain/hindbrain segments (~6k), choroid plexus. No separate frontal/parietal/temporal lobe meshes
  (only gyri subset; the cortex is not complete).
- spinal cord: no mesh of the cord itself (only "central canal of spinal cord" 728 tris).
- nerves: 28-43 files, ~35-62k tris, only cranial-nerve branches (optic, oculomotor, trochlear, ethmoidal, frontal).
  NO sciatic/median/ulnar/brachial plexus/vagus trunks.
- eyes: 16-19 files, 175-259k tris (sclera L/R 39.5k each, cornea 4.6k, iris 3.3k, lens 1.6k, choroid, anterior chamber).
- lungs: NO lung parenchyma / lobes. Only 101 bronchial-tree files (66k tris, segmental bronchi) + trachea 5k + larynx parts.
- liver: no whole-liver mesh; only caudate lobe FMA13365 (5k) + hepatovenous segments (e.g. FMA15745, 8.5k) + biliary tree.
- GI/urinary etc.: 77 files, ~199k tris: stomach FMA7148 1.8k, duodenum, ascending/transverse/descending colon, rectum, esophagus 578,
  pancreas 4.9k, kidneys L/R 2.3k/3.0k, bladder 226 (tiny), 63 intestine-related files.
- lymphatic: only spleen 1.3k, thymus lobes ~1k each. NO lymph nodes or lymphatic vessels. NO fat / adipose.
- other: testes, prostate (442), tongue (524), diaphragm 68.5k.
- Rough category sum mismatch vs 6.68M is expected (~1.66M tris in "other": mostly parent-name-unclassified small organs, muscles
  under names my regex missed, hair, orbit structures).

## Which meshes to use
- Use each element file once (files are leaf geometry). Group via isa_element_parts.txt by smallest-file-count concept
  (leaf.tsv). Do not draw concepts' unions: parents only reference the same files.
- Left/right: names starting "left "/"right "; unpaired structures have none.

## Missing / weak
- Lungs (parenchyma), full liver, heart outer surface as one organ, spinal cord, spinal/peripheral nerves, lymph nodes, fat,
  most ligaments/tendons, fascia, cortex lobes. Supplement with procedural meshes or another source if needed.
- 99% reduction: meshes are faceted/low-poly (median 960 tris); smooth normals and some subdivision may be wanted.

## Web asset estimate (whole set 6.68M tris / 4.21M verts)
- Quantized indexed (uint16 pos x3 = 6 B/vert, uint16 idx = 6 B/tri): ~25 MB + ~40 MB = ~65 MB raw, roughly 40-45 MB gzip,
  roughly 15-25 MB with meshopt/draco. Without muscle intercostal layers, veins/arteries tail: ~3.5M tris, ~35 MB raw.
- Raw OBJ text is 143 MB zipped (about 600+ MB unzipped).
