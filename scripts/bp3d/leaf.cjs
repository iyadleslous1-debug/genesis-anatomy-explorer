const fs=require('fs');const [js,parts,out]=process.argv.slice(2);const d=JSON.parse(fs.readFileSync(js));
const rows=fs.readFileSync(parts,'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l=>l.split('\t'));
const cnt={};rows.forEach(r=>cnt[r[0]]=(cnt[r[0]]||0)+1);
const best={};rows.forEach(r=>{const f=r[2];if(!best[f]||cnt[r[0]]<cnt[best[f][0]])best[f]=[r[0],r[1]]});
const o=[];for(const f in d.info){const i=d.info[f],b=best[f]||['?','?'];o.push([f,b[0],b[1],cnt[b[0]]||0,i.tr,i.mn.map(Math.round).join(','),i.mx.map(Math.round).join(',')].join('\t'))}
fs.writeFileSync(out,o.join('\n'));
const multi=rows.reduce((m,r)=>(m[r[2]]=(m[r[2]]||0)+1,m),{});console.log('files in >1 concept',Object.values(multi).filter(x=>x>1).length,'of',Object.keys(multi).length, 'files on disk not in map',Object.keys(d.info).filter(f=>!multi[f]).length);
