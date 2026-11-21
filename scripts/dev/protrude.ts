import { defineAll } from '../../src/anatomy';
import { skinShape } from '../../src/anatomy/skin';
const { parts } = defineAll();
const S = skinShape();
const res: [string, number, number, string][] = [];
const only = process.argv[2];
for (const p of parts) {
  if (p.system === 'integumentary') continue;
  if (only && !p.id.includes(only)) continue;
  const g = p.build();
  let worst = -1, cnt = 0, wp = [0, 0, 0];
  const n = g.pos.length / 3;
  for (let i = 0; i < n; i += 3) {
    const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
    const d = S.d(x, y, z);
    if (d > -0.0015) { cnt++; if (d > worst) { worst = d; wp = [x, y, z]; } }
  }
  if (cnt) res.push([p.id, worst, cnt / (n / 3), wp.map((v) => v.toFixed(3)).join(',')]);
}
res.sort((a, b) => b[1] - a[1]);
for (const r of res) console.log(r[0].padEnd(34), (r[1] * 1000).toFixed(1).padStart(6) + 'mm', (r[2] * 100).toFixed(1).padStart(5) + '%', r[3]);
