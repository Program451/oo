import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createRemoteInference} from './remote-inference.mjs';
const token='b'.repeat(64),workerHash=createHash('sha256').update(token).digest('hex');
const health={ready:true,model:'multilingual-e5-small · Asyl As',training:{train:128,validation:32,test:64,baselineAccuracy:53/64,trainedAccuracy:55/64,macroF1:.77,adapterSha256:'f'.repeat(64)}};
test('only the dedicated laptop token can access inference jobs',()=>{const db=new DatabaseSync(':memory:'),q=createRemoteInference(db,{workerHash});assert.equal(q.authorized({headers:{}}),false);assert.equal(q.authorized({headers:{authorization:'Bearer '+token}}),true);assert.equal(q.authorized({headers:{authorization:'Bearer '+token,origin:'https://other.test'}}),false);db.close();});
test('laptop jobs validate labels, reject wrong leases, and are removed after delivery',async()=>{
 const db=new DatabaseSync(':memory:'),q=createRemoteInference(db,{workerHash});assert.equal(q.health().ready,false);await assert.rejects(q.classify([{id:'one',text:'Суп холодный'}]),/выключен/);
 q.poll({health});const result=q.classify([{id:'one',text:'Суп холодный'}]);const {job}=q.poll({health});assert.equal(q.poll({health}).job,null);
 assert.equal(q.complete({id:job.id,lease:'wrong',classifications:[]}).status,410);
 assert.throws(()=>q.complete({...job,classifications:[{id:'made-up',label:'complaint'}]}));
 assert.equal(q.complete({...job,classifications:[{id:'one',label:'complaint'}]}).ok,true);
 assert.equal(q.complete({...job,classifications:[]}).duplicate,true);
 assert.equal((await result).classifications[0].label,'complaint');assert.equal(db.prepare('SELECT count(*) n FROM ai_jobs').get().n,0);db.close();
});
test('heartbeat expiry and abandoned jobs are reported instead of fabricating analysis',async()=>{
 const db=new DatabaseSync(':memory:');let now=1000;const q=createRemoteInference(db,{workerHash,now:()=>now,timeoutMs:50});q.poll({health});const pending=q.classify([{id:'one',text:'Учебная проверка'}]);now+=100;await assert.rejects(pending,/не ответил/);assert.equal(db.prepare('SELECT count(*) n FROM ai_jobs').get().n,0);now+=45000;assert.equal(q.health().ready,false);db.close();
});
