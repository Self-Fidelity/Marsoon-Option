import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/server/option-scope-routing.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {backendOptionScope,defaultDashboardDays}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('unified option scopes remain distinct across the adapter boundary',()=>{
 assert.deepEqual(['close','0dte','d30','d90'].map(backendOptionScope),['close','0dte','d30','d90']);
 assert.notEqual(backendOptionScope('d30'),'all');
 assert.notEqual(backendOptionScope('d90'),'all');
});

test('dashboard horizons match each public scope',()=>{
 assert.equal(defaultDashboardDays('0dte'),1);
 assert.equal(defaultDashboardDays('d30'),30);
 assert.equal(defaultDashboardDays('d90'),90);
});
