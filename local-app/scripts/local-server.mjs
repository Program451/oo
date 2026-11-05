import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFeedbackBridge} from './feedback-bridge.mjs';
import {demoData,mealSchema,reviewSchema,experimentSchema,composeLocalAnalysis,localInsights,exportPollCsv} from '../local-dist/domain.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.ASYL_LOCAL_PORT||5174),origin=`http://127.0.0.1:${port}`;
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const dataDir=process.env.ASYL_LOCAL_DATA?path.resolve(process.env.ASYL_LOCAL_DATA):path.join(root,'local-data');
await mkdir(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'asyl.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cache(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
const readData=()=>{const data={meals:[],reviews:[],experiments:[]};for(const row of db.prepare('SELECT * FROM records ORDER BY created_at DESC').all()){const kind={meal:'meals',review:'reviews',experiment:'experiments'}[row.kind];if(kind)data[kind].push({...JSON.parse(row.body),id:row.id});}return data;};
const feedback=createFeedbackBridge(db,dataDir);
const htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function modelHealth(){try{const r=await fetch('http://127.0.0.1:11435/health',{headers:{'X-Asyl-Client':'local'},signal:AbortSignal.timeout(2000)});return r.ok?await r.json():{ready:false};}catch{return {ready:false};}}
class InputError extends Error {constructor(message,status=400){super(message);this.status=status;}}
async function jsonBody(req){const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>20000)throw new InputError('Слишком большой запрос',413);chunks.push(part);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('Некорректный JSON');}}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function reportHtml(){
 let report;
 try{const pointer=JSON.parse(await readFile(path.join(root,'local-ai/training-result.json'),'utf8'));const target=path.resolve(root,'local-ai',pointer.report);if(!target.startsWith(path.join(root,'local-ai')+path.sep))throw new Error('path');report=JSON.parse(await readFile(target,'utf8'));}catch{return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Обучение</title><p>Обучение ещё не завершено. Результат появится после проверки модели.</p><a href="/">Вернуться</a></html>';}
 const pct=n=>`${(n*100).toFixed(1)}%`;
 const table=Object.keys(report.trained_test.per_class).map(label=>`<tr><td>${htmlEscape(label)}</td><td>${pct(report.baseline_test.per_class[label].recall)}</td><td>${pct(report.trained_test.per_class[label].recall)}</td><td>${report.trained_test.per_class[label].support}</td></tr>`).join('');
 return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Asyl As — отчёт об обучении</title><link rel="stylesheet" href="/app.css"></head><body><main class="content" style="max-width:960px"><a href="/">← Вернуться в Asyl As</a><h1 style="margin:24px 0">Мы дообучили модель</h1><p>${htmlEscape(report.protocol.base_model)}. Задача: классификация анонимных отзывов на русском и казахском, ${report.trained_test.label_order.length} категории.</p><section class="card" style="padding:24px;margin:24px 0"><h2>Что было сделано</h2><p>${report.protocol.split_counts.train} учебных отзывов для обучения, ${report.protocol.split_counts.validation} для выбора версии, ${report.protocol.split_counts.test} для итоговой проверки. Обучаемых параметров: ${report.protocol.trainable_parameters.toLocaleString('ru-RU')}. Метод: ${htmlEscape(report.protocol.method)}. Выбрана эпоха ${report.selected.epoch}.</p><p>Все примеры составлены для разработки. Это небольшой учебный тест, а не измерение качества на реальной школе. Автоматический режим не прошёл критерий допуска: в приложении обязательна проверка категорий исследователем.</p></section><table><thead><tr><th>Показатель</th><th>До дообучения</th><th>После дообучения</th></tr></thead><tbody><tr><td>Верно определена категория</td><td>${pct(report.baseline_test.accuracy)}</td><td>${pct(report.trained_test.accuracy)}</td></tr><tr><td>Macro F1 (все категории равноправны)</td><td>${report.baseline_test.macro_f1.toFixed(3)}</td><td>${report.trained_test.macro_f1.toFixed(3)}</td></tr><tr><td>95% интервал для доли верных ответов</td><td>${report.baseline_test.accuracy_wilson_95.map(pct).join(' — ')}</td><td>${report.trained_test.accuracy_wilson_95.map(pct).join(' — ')}</td></tr></tbody></table><h2 style="margin:24px 0">Распознавание по категориям</h2><table><thead><tr><th>Категория</th><th>До: полнота</th><th>После: полнота</th><th>Примеров</th></tr></thead><tbody>${table}</tbody></table><section class="notice" style="margin-top:24px"><p>Результат относится только к этим ${report.protocol.split_counts.test} примерам. Задача была упрощена после анализа ошибок при разработке. Это разработческая оценка на искусственном наборе, а не независимое доказательство качества. Неопределённость связана также с малым тестом. Для защиты покажите также ошибки модели. Расчёты отходов и рекомендации приложения — отдельная логика; обучалась именно классификация отзывов.</p></section><h2>Проверяемые артефакты</h2><p>Метод: ${htmlEscape(report.protocol.method)}, seed 42. Базовое сравнение: ${htmlEscape(report.baseline_name||'Исходная Qwen в том же режиме классификации')}. Обучение на ${htmlEscape(report.protocol.gpu)}. Время: ${(report.training_seconds/60).toFixed(1)} мин.</p><p style="overflow-wrap:anywhere">SHA-256 дообученных весов: ${htmlEscape(report.adapter_sha256)}</p><p>Необходимо проверить модель на новых анонимных отзывах, которые не составлялись для её обучения.</p><p style="margin:24px 0">Запуск локальный. Отправки данных в облако нет.</p></main></body></html>`;
}
let analyzing=false;
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
 if(![ `127.0.0.1:${port}`,`localhost:${port}` ].includes(req.headers.host||''))return json(res,403,{error:'Разрешён только локальный адрес'});
 const url=new URL(req.url,origin);
 const requestOrigin=`http://${req.headers.host}`;
 if(req.headers.origin&&req.headers.origin!==requestOrigin)return json(res,403,{error:'Запрос с другого сайта отклонён'});
 if(!['GET','HEAD'].includes(req.method)&&(req.headers.origin!==requestOrigin||(['POST','PATCH'].includes(req.method)&&!req.headers['content-type']?.startsWith('application/json'))))return json(res,403,{error:'Изменения доступны только из локального приложения'});
 try{
  if(url.pathname==='/api/status'&&req.method==='GET'){const health=await modelHealth();return json(res,200,{signedIn:true,geminiConfigured:false,local:true,modelReady:health.ready,model:health.model,training:health.training});}
  if(url.pathname==='/api/shutdown'&&req.method==='POST'){
   await fetch('http://127.0.0.1:11435/shutdown',{method:'POST',headers:{'X-Asyl-Client':'local'},signal:AbortSignal.timeout(3000)}).catch(()=>{});
   json(res,200,{ok:true});server.close(()=>{db.close();process.exit(0);});return;
  }
  if(url.pathname==='/api/data'&&req.method==='GET')return json(res,200,readData());
  if(url.pathname==='/api/backup'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="asyl-as-backup.json"');return json(res,200,{version:1,exportedAt:new Date().toISOString(),data:readData(),surveys:db.prepare('SELECT body FROM feedback_surveys').all().map(x=>JSON.parse(x.body)),votes:db.prepare('SELECT id,survey_id,body FROM feedback_votes').all().map(x=>({id:x.id,surveyId:x.survey_id,...JSON.parse(x.body)}))});}
  if(url.pathname.startsWith('/api/feedback')){
   try{
    if(url.pathname==='/api/feedback'&&req.method==='GET')return json(res,200,await feedback.status());
    if(url.pathname==='/api/feedback/sync'&&req.method==='POST')return json(res,200,await feedback.sync());
    if(url.pathname==='/api/feedback/surveys'&&req.method==='POST')return json(res,201,await feedback.create(await jsonBody(req)));
    if(url.pathname==='/api/feedback/surveys'&&req.method==='PATCH')return json(res,200,await feedback.close((await jsonBody(req)).id));
    if(url.pathname==='/api/feedback/results.csv'&&req.method==='GET'){
     const state=await feedback.status(),survey=state.surveys.find(s=>s.id===url.searchParams.get('id'));
     if(!survey||survey.kind!=='poll')return json(res,404,{error:'Голосование не найдено'});
     res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="asyl-as-poll-${survey.id}.csv"`,'Cache-Control':'no-store'});
     return res.end(exportPollCsv(survey,state.lastSync));
    }
    if(['/api/feedback/qr','/api/feedback/poster'].includes(url.pathname)&&req.method==='GET'){
     const {survey,url:link,svg}=await feedback.qr(url.searchParams.get('id'));
     if(url.pathname.endsWith('/qr')){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});return res.end(svg);}
     res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Asyl As — QR-плакат</title><style>body{font:18px Arial;color:#254b3b;text-align:center;max-width:700px;margin:50px auto;padding:24px}svg{max-width:90%;height:auto}p{line-height:1.6}a{overflow-wrap:anywhere;color:inherit}@media print{body{margin:0}}</style><h2>asyl as · Столовая без потерь</h2><h1>${htmlEscape(survey.title)}</h1>${svg}<h2>${survey.kind==='poll'?'Выбери блюдо':'Оставь отзыв об обеде'}</h2><p>Наведи камеру телефона на QR-код.<br>Русский / Қазақша · без имени и регистрации.</p><p><a href="${htmlEscape(link)}">${htmlEscape(link)}</a></p><p>Участие добровольное. Не указывай личные данные.<br>Опрос открыт до ${htmlEscape(new Date(survey.closesAt).toLocaleString('ru-RU',{timeZone:'Asia/Qyzylorda'}))}.</p><p>Для печати нажми Ctrl+P</p></html>`);
    }
   }catch(e){return json(res,e.status||400,{error:e.message||'Не удалось загрузить ответы'});}
  }
  if(url.pathname==='/api/data'&&req.method==='POST'){const body=await jsonBody(req);const schema={meal:mealSchema,review:reviewSchema,experiment:experimentSchema}[body.kind];if(!schema)return json(res,400,{error:'Неизвестный вид записи'});const parsed=schema.safeParse(body.data);if(!parsed.success)return json(res,400,{error:parsed.error.issues[0].message});const id=randomUUID();db.prepare('INSERT INTO records VALUES(?,?,?,?)').run(id,body.kind,JSON.stringify(parsed.data),new Date().toISOString());return json(res,201,{id,...parsed.data});}
  if(url.pathname==='/api/data'&&req.method==='DELETE'){const id=url.searchParams.get('id');if(!id||id.length>80)return json(res,400,{error:'Неверный идентификатор'});db.prepare('DELETE FROM records WHERE id=?').run(id);return json(res,200,{ok:true});}
  if(url.pathname==='/api/analyze'&&req.method==='POST'){
   if(analyzing)return json(res,429,{error:'Дождитесь завершения предыдущего анализа'});
   const b=await jsonBody(req);let data=b.demo===true?demoData:readData();
   for(const field of ['from','to'])if(b[field]&&(!/^\d{4}-\d{2}-\d{2}$/.test(b[field])||!Number.isFinite(Date.parse(b[field]+'T00:00:00Z'))||new Date(b[field]+'T00:00:00Z').toISOString().slice(0,10)!==b[field]))return json(res,400,{error:'Некорректная дата'});
   if(b.from&&b.to&&b.from>b.to)return json(res,400,{error:'Начало периода позже окончания'});
   data={...data,meals:data.meals.filter(x=>(!b.from||x.date>=b.from)&&(!b.to||x.date<=b.to)),reviews:data.reviews.filter(x=>(!b.from||x.date>=b.from)&&(!b.to||x.date<=b.to))};
   if(!data.meals.length&&!data.reviews.length)return json(res,400,{error:'Добавьте измерения или отзывы'});
   const reviews=data.reviews.filter(x=>x.text.trim()).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,24).map(({id,text})=>({id,text:text.slice(0,300)}));
   if(!reviews.length){const analysis=localInsights(data);return json(res,200,{...analysis,summary:'Текстовых комментариев нет. '+analysis.summary,limitations:['Оценки, выбранные причины и измерения разобраны по правилам программы; модель классификации текста не запускалась.',...analysis.limitations]});}
   const health=await modelHealth();if(!health.ready)return json(res,503,{error:'Локальная модель ещё не запущена. Откройте Start-Asyl-Local.cmd и дождитесь загрузки.'});
   const hash=createHash('sha256').update(JSON.stringify({data,adapter:health.training?.adapterSha256,reviewRequired:health.reviewRequired,version:2})).digest('hex');const cached=db.prepare('SELECT body FROM cache WHERE id=?').get(hash);if(cached)return json(res,200,{...JSON.parse(cached.body),cached:true});
   analyzing=true;
   try{
    const r=await fetch('http://127.0.0.1:11435/classify',{method:'POST',headers:{'Content-Type':'application/json','X-Asyl-Client':'local'},body:JSON.stringify({reviews}),signal:AbortSignal.timeout(180000)});
    const result=await r.json();if(!r.ok)return json(res,502,{error:result.error||'Локальная модель не ответила'});
    if(!Array.isArray(result.classifications)||result.classifications.length!==reviews.length||result.classifications.some(x=>!reviews.some(r=>r.id===x.id)))throw new Error('Некорректный ответ модели');
    const analysis={...composeLocalAnalysis(data,result.classifications,result.model),classifications:result.classifications,reviewRequired:health.reviewRequired===true};
    db.prepare('INSERT OR REPLACE INTO cache VALUES(?,?)').run(hash,JSON.stringify(analysis));return json(res,200,analysis);
   }finally{analyzing=false;}
  }
  if(url.pathname==='/training'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(await reportHtml());}
  const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/app.css':['app.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};const asset=assets[url.pathname];
  if(asset&&['GET','HEAD'].includes(req.method)){const bytes=await readFile(path.join(root,'local-dist',asset[0]));res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-cache'});return res.end(req.method==='HEAD'?undefined:bytes);}
  return json(res,404,{error:'Не найдено'});
 }catch(e){return json(res,e instanceof InputError?e.status:500,{error:e instanceof InputError?e.message:'Операция не выполнена. Повторите запрос; сохранённые данные не изменены.'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Asyl As local: ${origin}`));
process.on('SIGINT',()=>server.close(()=>{db.close();process.exit(0);}));
