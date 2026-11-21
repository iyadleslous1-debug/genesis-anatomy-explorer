import { defineAll } from '../src/anatomy';
const { groups, parts } = defineAll();
const only = process.argv[2];
let tris = 0, total = 0;
const slow: [string, number, number][] = [];
const ids = new Set<string>();
for (const g of groups) { if (ids.has(g.id)) console.log('DUP group', g.id); ids.add(g.id); }
for (const p of parts) { if (ids.has(p.id)) console.log('DUP id', p.id); ids.add(p.id); }
const gset = new Set(groups.map((g) => g.id));
for (const p of parts) if (!gset.has(p.parent)) console.log('MISSING parent', p.id, p.parent);
for (const g of groups) if (g.parent && !gset.has(g.parent)) console.log('MISSING gparent', g.id, g.parent);
for (const p of parts) {
  if (only && !p.id.includes(only)) continue;
  const t0 = performance.now();
  try {
    const g = p.build();
    const dt = performance.now() - t0;
    total += dt;
    const nt = g.idx.length / 3;
    tris += nt;
    let bad = 0;
    for (let i = 0; i < g.pos.length; i++) if (!isFinite(g.pos[i])) bad++;
    if (nt === 0 || bad) console.log('WARN', p.id, 'tris', nt, 'nan', bad);
    slow.push([p.id, dt, nt]);
  } catch (e) {
    console.log('ERR', p.id, (e as Error).message);
  }
}
slow.sort((a, b) => b[1] - a[1]);
console.log('parts', parts.length, 'groups', groups.length, 'tris', tris, 'ms', total.toFixed(0));
console.log(slow.slice(0, 25).map(([id, t, n]) => `${id} ${t.toFixed(0)}ms ${n}`).join('\n'));
