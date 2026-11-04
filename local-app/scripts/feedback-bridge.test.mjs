import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createFeedbackBridge} from './feedback-bridge.mjs';
test('sync separates votes, imports reviews once, and never exposes the access token',async()=>{
 const dir=path.resolve('outputs','bridge-test-'+Date.now());await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'feedback-connection.json'),JSON.stringify({url:'https://feedback.test',token:'b'.repeat(64)}));
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,body TEXT,created_at TEXT)');
 const surveyId=crypto.randomUUID(),reviewId=crypto.randomUUID(),voteId=crypto.randomUUID(),createdAt=new Date().toISOString(),survey={id:surveyId,title:'Учебный опрос',kind:'feedback',dishes:['Рис'],createdAt,closesAt:createdAt,counts:[],total:1};
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+'b'.repeat(64));if(url.endsWith('/surveys'))return Response.json({surveys:[survey]});const after=Number(new URL(url).searchParams.get('after'));return Response.json(after===0?{responses:[{id:reviewId,seq:1,surveyId,kind:'feedback',createdAt,data:{date:'2026-11-05',dish:'Рис',rating:4,reason:'Вкус',text:'Тестовый отзыв',language:'ru'}},{id:voteId,seq:2,surveyId,kind:'poll',createdAt,data:{date:'2026-11-05',dish:'Рис',language:'ru'}}],next:2,hasMore:false}:{responses:[],next:2,hasMore:false});};
 try{const bridge=createFeedbackBridge(db,dir),first=await bridge.sync();assert.equal(first.addedReviews,1);assert.equal(first.addedVotes,1);assert.equal(db.prepare('SELECT count(*) n FROM records').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM feedback_votes').get().n,1);assert.equal(JSON.stringify(await bridge.status()).includes('b'.repeat(64)),false);const next=await bridge.sync();assert.equal(next.addedReviews,0);assert.equal(next.addedVotes,0);db.prepare('DELETE FROM records WHERE id=?').run('web-'+reviewId);await bridge.sync();assert.equal(db.prepare('SELECT count(*) n FROM records').get().n,0);const qr=await bridge.qr(surveyId);assert.ok(qr.svg.includes('<svg'));assert.equal(qr.url,'https://feedback.test/?s='+surveyId);}finally{globalThis.fetch=original;db.close();}
});
