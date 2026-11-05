import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
export function createRemoteInference(db,{workerHash,now=Date.now,timeoutMs=150000}){
 if(!/^[a-f0-9]{64}$/.test(workerHash||''))throw new Error('A private worker hash is required');
 db.exec('CREATE TABLE IF NOT EXISTS ai_jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL,lease TEXT,result TEXT,expires INTEGER NOT NULL);');
 let lastSeen=0,info=null;
 function authorized(req){const header=req.headers.authorization||'';if(!/^Bearer [a-f0-9]{64}$/.test(header)||req.headers.origin)return false;return timingSafeEqual(createHash('sha256').update(header.slice(7)).digest(),Buffer.from(workerHash,'hex'));}
 function health(){return {ready:!!info&&now()-lastSeen<45000,model:info?.model||'multilingual-e5-small · Asyl As',training:info?.training,reviewRequired:true,remoteWorker:true};}
 function poll(body){
  const data=body?.health;
  if(!data||data.ready!==true||data.model!=='multilingual-e5-small · Asyl As'||!data.training||!/^[a-f0-9]{64}$/.test(data.training.adapterSha256||''))throw new Error('Некорректный статус модуля ИИ');
  const training={};for(const key of ['train','validation','test','baselineAccuracy','trainedAccuracy','macroF1']){if(typeof data.training[key]!=='number'||!Number.isFinite(data.training[key]))throw new Error('Некорректный протокол модели');training[key]=data.training[key];}
  training.adapterSha256=data.training.adapterSha256;training.source='Учебные синтетические отзывы';
  info={model:data.model,training};lastSeen=now();
  db.prepare('DELETE FROM ai_jobs WHERE expires<?').run(now());
  const pending=db.prepare('SELECT id,body FROM ai_jobs WHERE lease IS NULL ORDER BY expires LIMIT 1').get();
  if(!pending)return {job:null};
  const lease=randomUUID();const updated=db.prepare('UPDATE ai_jobs SET lease=? WHERE id=? AND lease IS NULL').run(lease,pending.id);
  return {job:updated.changes?{id:pending.id,lease,reviews:JSON.parse(pending.body)}:null};
 }
 function complete(body){
  const job=db.prepare('SELECT body,result FROM ai_jobs WHERE id=? AND lease=? AND expires>?').get(String(body?.id||''),String(body?.lease||''),now());
  if(!job)return {status:410,error:'Задание уже завершено или истекло'};
  if(job.result)return {ok:true,duplicate:true};
  if(body.error){db.prepare('UPDATE ai_jobs SET result=? WHERE id=?').run(JSON.stringify({error:'Модуль ИИ на ноутбуке не смог обработать отзывы. Повторите запрос.'}),body.id);return {ok:true};}
  const rows=JSON.parse(job.body),out=body.classifications;
  if(!Array.isArray(out)||out.length!==rows.length||new Set(out.map(r=>r.id)).size!==rows.length||out.some(r=>!rows.some(x=>x.id===r.id)||!['complaint','positive','insufficient'].includes(r.label)))throw new Error('Некорректные категории модели');
  db.prepare('UPDATE ai_jobs SET result=? WHERE id=?').run(JSON.stringify({model:info.model,classifications:out.map(({id,label})=>({id,label}))}),body.id);lastSeen=now();return {ok:true};
 }
 async function classify(reviews){
  if(!health().ready)throw new Error('ИИ на ноутбуке выключен. Запустите Start-Asyl-AI.cmd и дождитесь подключения.');
  const id=randomUUID(),expires=now()+timeoutMs;db.prepare('INSERT INTO ai_jobs(id,body,expires) VALUES(?,?,?)').run(id,JSON.stringify(reviews),expires);
  try{
   while(now()<expires){const row=db.prepare('SELECT result FROM ai_jobs WHERE id=?').get(id);if(row?.result){const result=JSON.parse(row.result);if(result.error)throw new Error(result.error);return result;}await new Promise(r=>setTimeout(r,300));}
   throw new Error('Ноутбук не ответил вовремя. Проверьте, что модуль ИИ работает и подключён к интернету.');
  }finally{db.prepare('DELETE FROM ai_jobs WHERE id=?').run(id);}
 }
 return {authorized,health,poll,complete,classify};
}
