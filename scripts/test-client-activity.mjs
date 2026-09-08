import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/retention/client-activity-state.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {ACTIVITY_KEYS,ACTIVITY_RESUME_INTERVAL_MS,pendingActivityEvent,completeActivityEvent,shouldReportActivity}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function storage() {
 const values=new Map();
 return {values,getItem:(key)=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:(key)=>values.delete(key)};
}

test('failed reports reuse one event id for the same user and rotate on user change',()=>{
 const store=storage(); let ids=0;
 assert.equal(pendingActivityEvent(store,'user-a',()=>`event-${++ids}`),'event-1');
 assert.equal(pendingActivityEvent(store,'user-a',()=>`event-${++ids}`),'event-1');
 assert.equal(pendingActivityEvent(store,'user-b',()=>`event-${++ids}`),'event-2');
 assert.equal(store.getItem(ACTIVITY_KEYS.pendingUser),'user-b');
});

test('success clears pending identity and foreground resumes are throttled for 30 minutes',()=>{
 const store=storage(); pendingActivityEvent(store,'user-a',()=> 'event-1');
 completeActivityEvent(store,1_000_000);
 assert.equal(store.getItem(ACTIVITY_KEYS.pendingEvent),null);
 assert.equal(store.getItem(ACTIVITY_KEYS.pendingUser),null);
 assert.equal(shouldReportActivity(1_000_000,1_000_000+ACTIVITY_RESUME_INTERVAL_MS-1),false);
 assert.equal(shouldReportActivity(1_000_000,1_000_000+ACTIVITY_RESUME_INTERVAL_MS),true);
});
