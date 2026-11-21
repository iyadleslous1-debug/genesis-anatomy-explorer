import { defineAll } from '../src/anatomy';
import { skinShape } from '../src/anatomy/skin';
const { parts } = defineAll();
const S = skinShape();
for (const p of parts) {
  if (p.system === 'integumentary' || p.id.startsWith('eye.') || p.id.includes('extraocular')) continue;
  const g = p.build();
  let worst = -1, wp = [0, 0, 0], cnt = 0;
  for (let i = 0; i < g.pos.length / 3; i++) {
    const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
    const d = S.d(x, y, z);
    if (d > -0.0009) { cnt++; if (d > worst) { worst = d; wp = [x, y, z]; } }
  }
  if (cnt > 2) console.log(p.id.padEnd(32), (worst * 1000).toFixed(1) + 'mm', cnt, wp.map((v) => v.toFixed(3)).join(','));
}
