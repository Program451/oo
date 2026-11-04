import {z} from 'zod';
export const surveySchema=z.object({title:z.string().trim().min(4).max(120),kind:z.enum(['feedback','poll']),dishes:z.array(z.string().trim().min(2).max(100)).min(1).max(8),days:z.number().int().min(1).max(14)}).refine(v=>new Set(v.dishes.map(d=>d.toLocaleLowerCase())).size===v.dishes.length,'Названия блюд не должны повторяться').refine(v=>v.kind!=='poll'||v.dishes.length>=2,'Для голосования нужны хотя бы два варианта');
const responseSchema=z.object({surveyId:z.string().uuid(),clientId:z.string().uuid(),dish:z.string().trim().min(2).max(100),language:z.enum(['ru','kk']),rating:z.number().int().min(1).max(5).optional(),reason:z.enum(['Всё понравилось','Вкус','Температура','Размер порции','Мало времени','Другое']).optional(),text:z.string().trim().max(300).default(''),website:z.string().max(100).default('')});
type Survey={id:string;title:string;kind:string;dishes:string;created_at:string;closes_at:string;closed:number};
export type FeedbackEnv={DB?:D1Database;ADMIN_TOKEN_HASH?:string};
export async function sha256(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const result=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const error=(message:string,status=400)=>result({error:message},status);
const publicSurvey=(s:Survey)=>({id:s.id,title:s.title,kind:s.kind,dishes:JSON.parse(s.dishes) as string[],createdAt:s.created_at,closesAt:s.closes_at,closed:!!s.closed});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function body(req:Request){
 if(!req.headers.get('content-type')?.startsWith('application/json'))throw new Error('json');
 const reader=req.body?.getReader();if(!reader)throw new Error('json');let size=0,text='';const decoder=new TextDecoder();
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();throw new Error('size');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);
}
async function authorized(req:Request,env:FeedbackEnv){const value=req.headers.get('authorization')||'';if(!env.ADMIN_TOKEN_HASH||!/^Bearer [a-f0-9]{64}$/.test(value))return false;const digest=await sha256(value.slice(7));let different=0;for(let i=0;i<64;i++)different|=digest.charCodeAt(i)^env.ADMIN_TOKEN_HASH.charCodeAt(i);return env.ADMIN_TOKEN_HASH.length===64&&different===0;}
export async function handleFeedback(req:Request,env:FeedbackEnv):Promise<Response>{
 const url=new URL(req.url),db=env.DB;if(!db||!env.ADMIN_TOKEN_HASH)return error('Сбор отзывов ещё настраивается. Попробуйте позже.',503);
 try{
  if(url.pathname.startsWith('/api/admin/')){
   if(!await authorized(req,env))return error('Доступ только из программы исследователя',401);
   if(url.pathname==='/api/admin/surveys'&&req.method==='GET'){
    const rows=await db.prepare('SELECT s.*, COUNT(r.seq) AS total FROM surveys s LEFT JOIN responses r ON r.survey_id=s.id GROUP BY s.id ORDER BY s.created_at DESC LIMIT 200').all<Survey&{total:number}>();
    const counts=await db.prepare('SELECT survey_id,dish,COUNT(*) AS total FROM responses GROUP BY survey_id,dish').all<{survey_id:string;dish:string;total:number}>();
    return result({surveys:rows.results.map(s=>({...publicSurvey(s),total:s.total,counts:counts.results.filter(c=>c.survey_id===s.id).map(({dish,total})=>({dish,total}))}))});
   }
   if(url.pathname==='/api/admin/surveys'&&req.method==='POST'){
    const parsed=surveySchema.safeParse(await body(req));if(!parsed.success)return error(parsed.error.issues[0].message);
    const count=await db.prepare('SELECT COUNT(*) AS count FROM surveys').first<{count:number}>();if((count?.count||0)>=200)return error('Достигнут лимит 200 опросов',409);
    const s=parsed.data,id=crypto.randomUUID(),createdAt=new Date().toISOString(),closesAt=new Date(Date.now()+s.days*86400000).toISOString();
    await db.prepare('INSERT INTO surveys(id,title,kind,dishes,created_at,closes_at,closed) VALUES(?,?,?,?,?,?,0)').bind(id,s.title,s.kind,JSON.stringify(s.dishes),createdAt,closesAt).run();
    return result({id,title:s.title,kind:s.kind,dishes:s.dishes,createdAt,closesAt,closed:false,total:0,counts:[]},201);
   }
   if(url.pathname==='/api/admin/surveys'&&req.method==='PATCH'){
    const parsed=z.object({id:z.string().uuid(),closed:z.literal(true)}).safeParse(await body(req));if(!parsed.success)return error('Некорректный опрос');
    const changed=await db.prepare('UPDATE surveys SET closed=1 WHERE id=?').bind(parsed.data.id).run();return changed.meta.changes?result({ok:true}):error('Опрос не найден',404);
   }
   if(url.pathname==='/api/admin/responses'&&req.method==='GET'){
    const cursor=url.searchParams.get('after')||'0';if(!/^\d{1,12}$/.test(cursor))return error('Некорректный курсор');
    const rows=await db.prepare('SELECT r.seq,r.id,r.survey_id,r.body,r.created_at,s.kind FROM responses r JOIN surveys s ON s.id=r.survey_id WHERE r.seq>? ORDER BY r.seq LIMIT 200').bind(Number(cursor)).all<{seq:number;id:string;survey_id:string;body:string;created_at:string;kind:string}>();
    return result({responses:rows.results.map(r=>({seq:r.seq,id:r.id,surveyId:r.survey_id,kind:r.kind,data:JSON.parse(r.body),createdAt:r.created_at})),next:rows.results.at(-1)?.seq||Number(cursor),hasMore:rows.results.length===200});
   }
   return error('Не найдено',404);
  }
  if(req.method==='GET'&&url.pathname.startsWith('/api/public/surveys/')){
   const id=url.pathname.split('/').at(-1);if(!z.string().uuid().safeParse(id).success)return error('Опрос не найден',404);
   const s=await db.prepare('SELECT * FROM surveys WHERE id=?').bind(id).first<Survey>();if(!s)return error('Опрос не найден. Проверьте QR-код.',404);
   return result({...publicSurvey(s),closed:!!s.closed||s.closes_at<=new Date().toISOString()});
  }
  if(req.method==='POST'&&url.pathname==='/api/public/respond'){
   if(req.headers.get('origin')!==url.origin)return error('Откройте форму по QR-коду',403);
   const parsed=responseSchema.safeParse(await body(req));if(!parsed.success)return error('Проверьте блюдо, оценку и комментарий');const v=parsed.data;
   if(v.website)return error('Не удалось отправить форму');
   const s=await db.prepare('SELECT * FROM surveys WHERE id=?').bind(v.surveyId).first<Survey>();if(!s)return error('Опрос не найден',404);
   const nonce=await sha256(env.ADMIN_TOKEN_HASH+':'+v.surveyId+':'+v.clientId);
   const exists=await db.prepare('SELECT id FROM responses WHERE survey_id=? AND nonce=?').bind(s.id,nonce).first();if(exists)return result({ok:true,duplicate:true});
   if(s.closed||s.closes_at<=new Date().toISOString())return error('Сбор ответов завершён',410);
   if(!(JSON.parse(s.dishes) as string[]).includes(v.dish))return error('Выберите блюдо из списка');
   if(s.kind==='feedback'&&(!v.rating||!v.reason))return error('Выберите оценку и причину');
   const minute=Math.floor(Date.now()/60000),ip=req.headers.get('cf-connecting-ip')||'unknown';const rateId=await sha256(env.ADMIN_TOKEN_HASH+':'+minute+':'+ip);
   await db.prepare('DELETE FROM rate_limits WHERE expires<?').bind(Date.now()).run();
   await db.prepare('INSERT INTO rate_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1').bind(rateId,Date.now()+120000).run();
   const rate=await db.prepare('SELECT count FROM rate_limits WHERE id=?').bind(rateId).first<{count:number}>();if((rate?.count||0)>300)return error('Слишком много ответов одновременно. Подождите минуту.',429);
   const data=s.kind==='poll'?{date:today(),dish:v.dish,language:v.language}:{date:today(),dish:v.dish,rating:v.rating,reason:v.reason,text:v.text,language:v.language};
   const created=await db.prepare('INSERT INTO responses(id,survey_id,nonce,dish,body,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM surveys WHERE id=? AND closed=0 AND closes_at>?) AND (SELECT COUNT(*) FROM responses WHERE survey_id=?)<5000 ON CONFLICT(survey_id,nonce) DO NOTHING').bind(crypto.randomUUID(),s.id,nonce,v.dish,JSON.stringify(data),new Date().toISOString(),s.id,new Date().toISOString(),s.id).run();
   if(!created.meta.changes){const duplicate=await db.prepare('SELECT id FROM responses WHERE survey_id=? AND nonce=?').bind(s.id,nonce).first();return duplicate?result({ok:true,duplicate:true}):error('Сбор ответов завершён или достигнут лимит',410);}
   return result({ok:true},201);
  }
  return error('Не найдено',404);
 }catch(e){if(e instanceof SyntaxError||(e instanceof Error&&['json','size'].includes(e.message)))return error('Некорректный или слишком большой запрос');return error('Не удалось выполнить запрос. Попробуйте ещё раз.',500);}
}
