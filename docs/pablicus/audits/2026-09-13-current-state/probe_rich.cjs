const fs=require('fs'),crypto=require('crypto'),path=require('path');
const target=path.resolve('pablicus/rich-message.js');
const api=require(target);
const types=['text','image','video','audio','document','heading','list','table','quote','code','form','task','agent_result','service_preview','carousel','action','poll','event','checklist'];
const cases=types.map(type=>({type,...api.validate({v:1,blocks:[{id:'audit-1',type,...(type==='text'?{text:'Audit'}:{})}]})}));
const result={source:'pablicus/rich-message.js',sha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),scope:'Real pure validator; does not test rendering, transport or server persistence',cases,messageDocV2:api.validate({v:2,blocks:[{id:'audit-v2',type:'text',text:'Audit'}]})};
fs.writeFileSync('docs/pablicus/audits/2026-09-13-current-state/RICH_BLOCK_SUPPORT.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({accepted:cases.filter(x=>x.ok).map(x=>x.type),rejected:cases.filter(x=>!x.ok).map(x=>x.type),v2:result.messageDocV2.ok}));
