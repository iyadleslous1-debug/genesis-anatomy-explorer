import { defineAll } from '../../src/anatomy';
import { writeFileSync, mkdirSync } from 'fs';
const { groups, parts } = defineAll();
const strip = (id: string) => id.replace(/\.(L|R)$/, '');
const by: Record<string, Map<string, string>> = {};
for (const n of [...groups.map((g) => ({ ...g, kind: 'group' })), ...parts.map((p) => ({ ...p, kind: p.tissue }))]) {
  const k = strip(n.id);
  (by[n.system] ??= new Map()).set(k, `${k}\t${n.name.replace(/^(Left|Right) /, '')}\t${n.kind}`);
}
mkdirSync('src/content/ids', { recursive: true });
for (const [sys, m] of Object.entries(by)) writeFileSync(`src/content/ids/${sys}.tsv`, [...m.values()].join('\n') + '\n');
console.log(Object.entries(by).map(([s, m]) => `${s}:${m.size}`).join(' '));
