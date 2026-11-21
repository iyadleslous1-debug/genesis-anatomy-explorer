// usage: node inspect.js <bp3d dir> <objs dir> <out json>
const fs = require('fs'), path = require('path');
const [dir, objs, out] = process.argv.slice(2);
const rd = f => fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split('\t'));
const names = {}; rd('isa_parts_list_e.txt').forEach(r => names[r[0]] = r[2]);
const elem = {}; const el2c = {};
rd('isa_element_parts.txt').forEach(r => { (elem[r[0]] ||= []).push(r[2]); (el2c[r[2]] ||= []).push(r[0]); });
const kids = {}, parents = {};
rd('isa_inclusion_relation_list.txt').forEach(r => { (kids[r[0]] ||= []).push(r[2]); (parents[r[2]] ||= []).push(r[0]); });
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.obj$/i.test(e.name)) files.push(p); } })(objs);
const info = {}; let V = 0, T = 0; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const f of files) {
  const id = path.basename(f, '.obj'); const t = fs.readFileSync(f, 'utf8'); let v = 0, tr = 0;
  const b = { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] };
  for (const l of t.split('\n')) {
    if (l.charCodeAt(0) === 118 && l[1] === ' ') { v++; const p = l.trim().split(/\s+/); for (let i = 0; i < 3; i++) { const x = +p[i + 1]; if (x < b.mn[i]) b.mn[i] = x; if (x > b.mx[i]) b.mx[i] = x; } }
    else if (l[0] === 'f' && l[1] === ' ') { const n = l.trim().split(/\s+/).length - 1; tr += n - 2; }
  }
  info[id] = { v, tr, mn: b.mn, mx: b.mx }; V += v; T += tr;
  for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.mn[i]); mx[i] = Math.max(mx[i], b.mx[i]); }
}
// concept -> tris (own elements)
const concept = {};
for (const c in elem) { let tr = 0, n = 0; for (const e of elem[c]) if (info[e]) { tr += info[e].tr; n++; } concept[c] = { name: names[c], files: elem[c].length, found: n, tr, nkids: (kids[c] || []).length }; }
fs.writeFileSync(out, JSON.stringify({ nfiles: files.length, V, T, mn, mx, concept, info }));
console.log({ nfiles: files.length, V, T, mn, mx, concepts: Object.keys(concept).length });
