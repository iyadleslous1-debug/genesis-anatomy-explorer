const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[2]));
const C=d.concept;const pats=process.argv.slice(3);
const el={};fs.readFileSync(process.argv[2].replace('bp3d_inspect.json','bp3d/isa_element_parts.txt'),'utf8').split(/\r?\n/).slice(1).filter(Boolean).forEach(l=>{const r=l.split('\t');(el[r[0]]||=[]).push(r[2])});
for(const p of pats){const re=new RegExp(p,'i');let m=Object.entries(C).filter(([k,v])=>re.test(v.name||''));
 const tot=m.reduce((a,[k,v])=>a+v.tr,0);const nz=m.filter(([k,v])=>v.tr>0);
 console.log(`## ${p}: ${m.length} concepts, ${nz.length} with mesh, ${tot} tris`);
 nz.slice(0,+process.env.N||4).forEach(([k,v])=>{const b=d.info[el[k][0]];console.log(' ',k,v.name,'files',v.files,'tr',v.tr,'kids',v.nkids, b?`z${b.mn[2].toFixed(0)}..${b.mx[2].toFixed(0)} y${b.mn[1].toFixed(0)}..${b.mx[1].toFixed(0)} x${b.mn[0].toFixed(0)}..${b.mx[0].toFixed(0)}`:'')});}
