const fs=require('fs');const [dir,leaf]=process.argv.slice(2);
const rd=f=>fs.readFileSync(dir+'/'+f,'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l=>l.split('\t'));
const par={},nm={};rd('isa_inclusion_relation_list.txt').forEach(r=>{(par[r[2]]||=[]).push(r[0]);nm[r[0]]=r[1];nm[r[2]]=r[3]});
const anc=(c,s=new Set())=>{if(s.has(c))return s;s.add(c);(par[c]||[]).forEach(p=>anc(p,s));return s};
const cats=[['skin',/^skin$/],['teeth',/^tooth$/],['bone',/^bone organ$/],['skeletal muscle',/^skeletal muscle$|^muscle organ$|^skeletal muscle organ$/],['cartilage',/cartilage organ|^cartilage$/],['ligament',/^ligament$/],['tendon',/^tendon$/],['artery',/^artery$/],['vein',/^vein$/],['lymphatic',/lymph/],['nerve',/^nerve$|^cranial nerve$/],['brain',/^brain$/],['spinal cord',/spinal cord/],['heart',/^heart$/],['eye',/^eye$|eyeball/],['lung',/^lung$|bronchial tree|bronchus/],['gi/liver/kidney/etc',/liver|stomach|intestine|kidney|pancreas|bladder|esophagus|gallbladder/]];
const L=fs.readFileSync(leaf,'utf8').split('\n').map(l=>l.split('\t'));const R={};
for(const r of L){const A=[...anc(r[1])].map(x=>nm[x]||'');let c='other';for(const [n,re] of cats){if(A.some(a=>re.test(a))){c=n;break}}
(R[c]||={f:0,t:0,ex:[]});R[c].f++;R[c].t+=+r[4];if(R[c].ex.length<3)R[c].ex.push(r[1]+' '+r[2]+' '+r[4])}
for(const c in R)console.log(c,R[c].f,R[c].t,'|',R[c].ex.join('; '));
console.log('aggregate-only files (best concept has >1 files):',L.filter(r=>+r[3]>1).length);
