import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createFeedbackBridge} from './feedback-bridge.mjs';

// A real HTTP service and two disposable SQLite databases. No production URL,
// access token or research records are used. Only test HTTPS is routed locally.
test('QR collection, retry, import, restart, CSV and closure work together',async()=>{
 const siteDir=path.resolve(process.env.ASYL_FEEDBACK_SITE||'../feedback-site');
 const siteOrigin='http://127.0.0.1:5190',appOrigin='http://127.0.0.1:5191';
 const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
 const nativeFetch=globalThis.fetch,children=[];
 let db;
 for(const origin of [siteOrigin,appOrigin]){
  let occupied=false;try{await nativeFetch(origin,{signal:AbortSignal.timeout(500)});occupied=true;}catch{}
  assert.equal(occupied,false,`${origin} is occupied; refusing to interfere`);
 }
 await mkdir('outputs',{recursive:true});
 const root=await mkdtemp(path.resolve('outputs/feedback-flow-'));
 const localData=path.join(root,'research'),siteData=path.join(root,'website');
 await mkdir(localData,{recursive:true});
 await writeFile(path.join(localData,'feedback-connection.json'),JSON.stringify({url:'https://feedback.test',token}));
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function start(cwd,script,env,origin){
  const child=spawn(process.execPath,[script],{cwd,env:{...process.env,...env},windowsHide:true,stdio:'pipe'});
  children.push(child);let diagnostic='';child.stderr.on('data',s=>diagnostic+=s);child.stdout.resume();
  for(let i=0;i<80;i++){
   if(child.exitCode!==null)throw new Error('Test server exited: '+diagnostic);
   try{if((await nativeFetch(origin,{signal:AbortSignal.timeout(500)})).ok)return child;}catch{}
   await sleep(100);
  }
  throw new Error('Test server did not start: '+diagnostic);
 }
 async function stop(child){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
 const publicPost=async body=>nativeFetch(siteOrigin+'/api/public/respond',{method:'POST',headers:{Origin:siteOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  await start(siteDir,'scripts/server-node.mjs',{PORT:'5190',BIND:'127.0.0.1',PUBLIC_ORIGIN:siteOrigin,DATA_DIR:siteData,ADMIN_TOKEN_HASH:hash,TRUST_PROXY:'0'},siteOrigin);
  globalThis.fetch=(url,options)=>{
   const parsed=new URL(url);
   if(parsed.origin==='https://feedback.test')return nativeFetch(siteOrigin+parsed.pathname+parsed.search,options);
   return nativeFetch(url,options);
  };
  const openDb=()=>{db=new DatabaseSync(path.join(localData,'asyl.sqlite'));db.exec('CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL)');return createFeedbackBridge(db,localData);};
  let bridge=openDb();
  const survey=await bridge.create({title:'Учебная проверка RU / ҚАЗ',kind:'feedback',dishes:['Көже','Рис'],days:1});
  const qr=await bridge.qr(survey.id);
  assert.equal(new URL(qr.url).searchParams.get('s'),survey.id);assert.match(qr.svg,/<svg/);assert.equal(qr.svg.includes(token),false);
  const response={surveyId:survey.id,clientId:randomUUID(),dish:'Көже',language:'kk',rating:2,reason:'Температура',text:'Сорпа суық болды. Бұл — оқу тексеруі.'};
  assert.equal((await publicPost(response)).status,201);
  assert.equal((await publicPost(response)).status,200);
  assert.equal((await publicPost({...response,clientId:randomUUID(),dish:'Нет в меню'})).status,400);
  const poll=await bridge.create({title:'Учебное голосование',kind:'poll',dishes:['Көже','Рис'],days:1});
  assert.equal((await publicPost({surveyId:poll.id,clientId:randomUUID(),dish:'Рис',language:'ru'})).status,201);
  const synced=await bridge.sync();assert.equal(synced.addedReviews,1);assert.equal(synced.addedVotes,1);
  assert.equal(synced.surveys.find(s=>s.id===poll.id).total,1);
  assert.equal(JSON.parse(db.prepare('SELECT body FROM records').get().body).text,response.text);
  assert.equal(JSON.stringify(synced).includes(token),false);
  // Reopen the local database, then retry import: the cursor survives a restart.
  db.close();db=undefined;bridge=openDb();
  const repeated=await bridge.sync();assert.equal(repeated.addedReviews,0);assert.equal(repeated.addedVotes,0);
  const rows=db.prepare('SELECT * FROM records').all();assert.equal(rows.length,1);
  assert.equal(db.prepare('SELECT count(*) n FROM feedback_votes').get().n,1);
  const local=await start(process.cwd(),'scripts/local-server.mjs',{ASYL_LOCAL_DATA:localData,ASYL_LOCAL_PORT:'5191'},appOrigin);
  const data=await nativeFetch(appOrigin+'/api/data').then(r=>r.json());
  assert.equal(data.meals.length,0);assert.equal(data.reviews.length,1);assert.equal(data.reviews[0].language,'kk');
  const csvResponse=await nativeFetch(appOrigin+'/api/feedback/results.csv?id='+poll.id);
  assert.equal(csvResponse.status,200);assert.match(csvResponse.headers.get('content-disposition'),/attachment/);
  const csv=await csvResponse.text();assert.match(csv,/Учебное голосование/);assert.match(csv,/"Рис";"1";"100";"1"/);assert.match(csv,/"Көже";"0";"0";"1"/);assert.equal(csv.includes(token),false);
  assert.equal((await nativeFetch(appOrigin+'/api/feedback/results.csv?id='+survey.id)).status,404);
  if(process.env.ASYL_TEST_MODEL==='1'){
   const analysisResponse=await nativeFetch(appOrigin+'/api/analyze',{method:'POST',headers:{Origin:appOrigin,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(180000)});
   assert.equal(analysisResponse.status,200);
   const analysis=await analysisResponse.json();assert.equal(analysis.source,'local');assert.equal(analysis.reviewRequired,true);assert.equal(analysis.classifications.length,1);assert.equal(analysis.classifications[0].id,data.reviews[0].id);
   assert.ok(['complaint','positive','insufficient'].includes(analysis.classifications[0].label));
  }
  await stop(local);
  await bridge.close(survey.id);
  assert.equal((await publicPost({...response,clientId:randomUUID()})).status,410);
  assert.equal((await publicPost(response)).status,200); // Retry an already accepted answer.
  assert.equal((await nativeFetch(siteOrigin+'/api/admin/responses')).status,401);
  // Cached QR and counts remain available when the website is offline.
  await stop(children[0]);const offline=await bridge.status();assert.equal(offline.surveys.length,2);assert.match((await bridge.qr(poll.id)).svg,/<svg/);
 }finally{
  globalThis.fetch=nativeFetch;
  for(const child of children)await stop(child);
  db?.close();
 }
});
