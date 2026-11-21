import { defineAll } from '../../src/anatomy';
import { liver } from '../../src/anatomy/organs';
const { parts } = defineAll();
const bySys: Record<string, [number, number, number]> = {};
for (const p of parts) {
  const t0 = performance.now();
  const g = p.build();
  const k = p.system + ':' + p.tissue;
  bySys[k] ??= [0, 0, 0];
  bySys[k][0] += g.idx.length / 3; bySys[k][1]++; bySys[k][2] += performance.now() - t0;
}
for (const [k, [t, n, ms]] of Object.entries(bySys).sort((a, b) => b[1][0] - a[1][0])) console.log(k.padEnd(32), String(Math.round(t)).padStart(8), n, Math.round(ms));
const L = liver();
let qn = 0;
for (let x = -0.03; x < 0.0; x += 0.004) for (let y = 1.07; y < 1.14; y += 0.004) for (let z = 0.0; z < 0.1; z += 0.004) if (L.d(x, y, z) < 0) { if (z > 0.03 && y < 1.125) qn++; }
console.log('liver quad samples', qn, 'lo', L.lo, 'hi', L.hi);
