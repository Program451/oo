import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const origin='http://127.0.0.1:5176';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('local API rejects foreign writes, validates values, and persists Unicode records',async()=>{
 let occupied=false;try{await fetch(origin,{signal:AbortSignal.timeout(1000)});occupied=true;}catch{}
 assert.equal(occupied,false,'Port 5176 is already in use; refusing to interfere');
 const dir=path.resolve('outputs',`local-api-test-${Date.now()}`);await mkdir(dir,{recursive:true});
 let child;
 async function start(){
  child=spawn(process.execPath,['scripts/local-server.mjs'],{env:{...process.env,ASYL_LOCAL_DATA:dir,ASYL_LOCAL_PORT:'5176'},stdio:'pipe',windowsHide:true});
  let diagnostic='';child.stderr.on('data',chunk=>diagnostic+=chunk.toString());
  for(let i=0;i<50;i++){try{const r=await fetch(origin,{signal:AbortSignal.timeout(300)});if(r.ok)return;}catch{}await sleep(100);}
  throw new Error('Server failed to start: '+diagnostic);
 }
 async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
 const headers={'Content-Type':'application/json',Origin:origin};
 const meal={date:'2026-11-04',dish:'Қазақша көже — проверка',meal:'Обед',preparedKg:10,servedKg:8,plateKg:1,portions:40,note:'Только автоматическая проверка'};
 try{
  await start();
  const broken=await fetch(origin+'/api/data',{method:'POST',headers,body:'{'});assert.equal(broken.status,400);
  const disabled=await fetch(origin+'/api/feedback').then(r=>r.json());assert.equal(disabled.configured,false);assert.equal('token' in disabled,false);
  let r=await fetch(origin+'/api/data',{method:'POST',headers:{...headers,Origin:'https://foreign.example'},body:JSON.stringify({kind:'meal',data:meal})});assert.equal(r.status,403);
  r=await fetch(origin+'/api/data',{method:'POST',headers,body:JSON.stringify({kind:'meal',data:{...meal,servedKg:11}})});assert.equal(r.status,400);
  r=await fetch(origin+'/api/data',{method:'POST',headers,body:JSON.stringify({kind:'meal',data:meal})});assert.equal(r.status,201);const saved=await r.json();
  await stop();await start();
  let data=await fetch(origin+'/api/data').then(r=>r.json());assert.equal(data.meals.length,1);assert.equal(data.meals[0].dish,meal.dish);
  let analysisResponse=await fetch(origin+'/api/analyze',{method:'POST',headers,body:'{}'});assert.equal(analysisResponse.status,200);
  let analysis=await analysisResponse.json();assert.equal(analysis.source,'rules');assert.equal('classifications' in analysis,false);assert.ok(analysis.summary.includes('Текстовых комментариев нет'));
  const noText={date:'2026-11-05',dish:'Көже',rating:2,reason:'Температура',text:'',language:'kk'};
  const reviewResponse=await fetch(origin+'/api/data',{method:'POST',headers,body:JSON.stringify({kind:'review',data:noText})});assert.equal(reviewResponse.status,201);const review=await reviewResponse.json();
  analysisResponse=await fetch(origin+'/api/analyze',{method:'POST',headers,body:'{}'});assert.equal(analysisResponse.status,200);analysis=await analysisResponse.json();
  assert.equal(analysis.source,'rules');assert.ok(analysis.recommendations.some(r=>r.evidenceIds.includes(review.id)));
  const backup=await fetch(origin+'/api/backup').then(r=>r.json());assert.equal(backup.data.meals.length,1);assert.equal('token' in backup,false);
  r=await fetch(origin+'/api/data?id='+saved.id,{method:'DELETE',headers:{Origin:origin}});assert.equal(r.status,200);
  data=await fetch(origin+'/api/data').then(r=>r.json());assert.equal(data.meals.length,0);
  const html=await fetch(origin).then(r=>r.text());assert.equal(/https?:\/\//.test(html),false);
 }finally{await stop();}
});
