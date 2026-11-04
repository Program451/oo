import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData,composeLocalAnalysis} from '../local-dist/domain.mjs';
test('trained review labels control recommendations and preserve evidence',()=>{
 const result=composeLocalAnalysis(demoData,[{id:demoData.reviews[0].id,label:'time'}],'test-local');
 assert.equal(result.source,'local');assert.equal(result.recommendations[0].title,'Время на обед');
 assert.deepEqual(result.recommendations[0].evidenceIds,[demoData.reviews[0].id]);
});
test('unknown evidence and duplicate classifications are rejected',()=>{
 assert.throws(()=>composeLocalAnalysis(demoData,[{id:'invented',label:'time'}],'test'));
 const row={id:demoData.reviews[0].id,label:'time'};
 assert.throws(()=>composeLocalAnalysis(demoData,[row,row],'test'));
});
test('no feedback does not fabricate classified reviews',()=>{
 const result=composeLocalAnalysis({...demoData,reviews:[]},[],'test');
 assert.match(result.summary,/метки для 0 отзывов/);assert.ok(result.limitations.some(x=>x.includes('учебной')));
});
test('reviewed classifications are attributed to researcher verification',()=>{
 const result=composeLocalAnalysis(demoData,[{id:demoData.reviews[0].id,label:'complaint'}],'test',true);
 assert.match(result.recommendations[0].observation,/После проверки исследователем/);
});
