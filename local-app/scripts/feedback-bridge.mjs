import {readFile} from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import {reviewSchema} from '../local-dist/domain.mjs';

export function createFeedbackBridge(db,dataDir,connection){
 db.exec('CREATE TABLE IF NOT EXISTS feedback_surveys(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS feedback_imports(id TEXT PRIMARY KEY,seq INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS feedback_votes(id TEXT PRIMARY KEY,survey_id TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT NOT NULL);');
 const get=(id,fallback='')=>db.prepare('SELECT value FROM settings WHERE id=?').get(id)?.value??fallback;
 const set=(id,value)=>db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(id,String(value));
 const surveys=()=>db.prepare('SELECT body FROM feedback_surveys').all().map(x=>JSON.parse(x.body)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 let syncing=false;
 async function config(){try{const c=connection||JSON.parse(await readFile(path.join(dataDir,'feedback-connection.json'),'utf8'));const u=new URL(c.url);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^[a-f0-9]{64}$/.test(c.token))throw new Error('invalid');return {url:u.origin,token:c.token};}catch{return null;}}
 async function remote(route,method='GET',body){const c=await config();if(!c)throw new Error('Подключение сайта ещё не настроено');let r;try{r=await fetch(c.url+route,{method,headers:{Authorization:`Bearer ${c.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Нет связи с сайтом отзывов. Проверьте интернет; локальные данные сохранены.');}const text=await r.text();if(text.length>2000000)throw new Error('Слишком большой ответ сайта');let d;try{d=JSON.parse(text);}catch{throw new Error('Сайт вернул неверный ответ. Проверьте подключение.');}if(!r.ok)throw new Error(d.error||`Ошибка сайта: ${r.status}`);return d;}
 function saveSurvey(s){if(!s||!isUuid(s.id)||!['poll','feedback'].includes(s.kind)||!Array.isArray(s.dishes)||typeof s.title!=='string')throw new Error('Некорректный опрос с сайта');db.prepare('INSERT OR REPLACE INTO feedback_surveys VALUES(?,?)').run(s.id,JSON.stringify(s));}
 async function status(){const c=await config();return {configured:!!c,url:c?.url||'',surveys:surveys(),lastSync:get('feedback.lastSync'),syncing,importedReviews:Number(get('feedback.reviewCount','0')),importedVotes:Number(get('feedback.voteCount','0'))};}
 async function sync(){
  if(syncing)throw new Error('Синхронизация уже выполняется');syncing=true;let addedReviews=0,addedVotes=0;
  try{
   const list=await remote('/api/admin/surveys');if(!Array.isArray(list.surveys))throw new Error('Некорректный список опросов');
   db.exec('BEGIN');try{for(const s of list.surveys)saveSurvey(s);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   let more=true,pages=0;
   while(more&&pages++<25){const cursor=Number(get('feedback.cursor','0')),d=await remote('/api/admin/responses?after='+cursor);
    if(!Array.isArray(d.responses)||d.responses.length>200||!Number.isSafeInteger(d.next)||d.next<cursor)throw new Error('Некорректный пакет ответов');
    const rows=d.responses.map((r,i)=>{if(!isUuid(r.id)||!isUuid(r.surveyId)||!Number.isSafeInteger(r.seq)||r.seq<=(i?d.responses[i-1].seq:cursor)||!['poll','feedback'].includes(r.kind))throw new Error('Некорректный ответ сайта');if(r.kind==='feedback')return {...r,data:reviewSchema.parse(r.data)};if(typeof r.data?.dish!=='string'||r.data.dish.length>100)throw new Error('Некорректный голос');return r;});
    if(rows.length&&d.next!==rows.at(-1).seq||!rows.length&&d.next!==cursor)throw new Error('Некорректная последовательность ответов');
    db.exec('BEGIN');try{for(const r of rows){const exists=db.prepare('SELECT id FROM feedback_imports WHERE id=?').get(r.id);if(exists)continue;if(r.kind==='feedback'){db.prepare('INSERT INTO records VALUES(?,?,?,?)').run('web-'+r.id,'review',JSON.stringify({...r.data,source:'qr',surveyId:r.surveyId}),r.createdAt);addedReviews++;}else{db.prepare('INSERT INTO feedback_votes VALUES(?,?,?)').run(r.id,r.surveyId,JSON.stringify(r.data));addedVotes++;}db.prepare('INSERT INTO feedback_imports VALUES(?,?)').run(r.id,r.seq);}set('feedback.cursor',d.next);set('feedback.reviewCount',db.prepare('SELECT COUNT(*) AS n FROM feedback_imports i WHERE EXISTS(SELECT 1 FROM records r WHERE r.id=\'web-\'||i.id)').get().n);set('feedback.voteCount',db.prepare('SELECT COUNT(*) AS n FROM feedback_votes').get().n);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    more=d.hasMore===true;if(more&&!rows.length)throw new Error('Сайт не продвинул синхронизацию');
   }
   set('feedback.lastSync',new Date().toISOString());return {...await status(),addedReviews,addedVotes,hasMore:more};
  }finally{syncing=false;}
 }
 async function create(body){const s=await remote('/api/admin/surveys','POST',body);saveSurvey(s);return s;}
 async function close(id){if(!isUuid(id))throw new Error('Неверный опрос');await remote('/api/admin/surveys','PATCH',{id,closed:true});const s=surveys().find(s=>s.id===id);if(s)saveSurvey({...s,closed:true});return {ok:true};}
 async function qr(id){const c=await config(),s=surveys().find(s=>s.id===id);if(!c||!s)throw new Error('Опрос не найден');const url=c.url+'/?s='+encodeURIComponent(id);return {survey:s,url,svg:await QRCode.toString(url,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320})};}
 return {status,sync,create,close,qr};
}
function isUuid(s){return typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);}
