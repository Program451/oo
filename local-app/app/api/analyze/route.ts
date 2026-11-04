import {identity,loadData,database,apiError,readBody,sameOrigin} from "@/lib/server-data";
import {demoData} from "@/lib/demo";
import {analyze} from "@/lib/gemini";
import {today} from "@/lib/domain";
export async function POST(req:Request){try{
 const owner=await identity();if(!sameOrigin(req))return Response.json({error:"Запрос отклонён"},{status:403});const b=await readBody(req);let data=b.demo===true?demoData:await loadData(owner);
 if(b.from&&/^\d{4}-\d{2}-\d{2}$/.test(b.from))data={...data,meals:data.meals.filter(m=>m.date>=b.from),reviews:data.reviews.filter(r=>r.date>=b.from)};
 if(b.to&&/^\d{4}-\d{2}-\d{2}$/.test(b.to))data={...data,meals:data.meals.filter(m=>m.date<=b.to),reviews:data.reviews.filter(r=>r.date<=b.to)};
 data={...data,meals:data.meals.slice(0,100),reviews:data.reviews.slice(0,100)};if(!data.meals.length)return Response.json({error:"Сначала добавьте хотя бы одно измерение."},{status:400});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(data))))).map(b=>b.toString(16).padStart(2,"0")).join(""),cacheKey=`${owner}:${hash}`;
 const cache=await database().prepare("SELECT body FROM analyses WHERE id=? AND owner=?").bind(cacheKey,owner).first<{body:string}>();if(cache)return Response.json({...JSON.parse(cache.body),cached:true});
 const now=Date.now(),updated=await database().prepare("INSERT INTO ai_usage(id,requests,last_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET requests=requests+1,last_at=excluded.last_at WHERE requests<8 AND last_at<? RETURNING requests").bind(`${owner}:${today()}`,now,now-60000).first();if(!updated)return Response.json({error:"Подождите минуту между запросами. Суточный лимит — 8 запросов для защиты бюджета."},{status:429});
 let result;try{result=await analyze(data);}catch(e){return Response.json({error:e instanceof Error?e.message:"Ошибка Gemini"},{status:502});}
 await database().prepare("INSERT INTO analyses(id,owner,body,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(cacheKey,owner,JSON.stringify(result),new Date().toISOString()).run();return Response.json(result);
 }catch(e){return apiError(e);}}
