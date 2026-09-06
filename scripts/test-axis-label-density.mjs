import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/board/axis-label-density.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {adaptiveLabelIndices}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('narrow axes reduce labels and retain both ends',()=>{
  const labels=adaptiveLabelIndices(101,220,60);
  assert.deepEqual(labels,[0,33,67,100]);
});

test('wide axes restore labels without duplicates',()=>{
  const labels=adaptiveLabelIndices(12,1200,50);
  assert.equal(labels.length,12);
  assert.equal(labels[0],0);
  assert.equal(labels.at(-1),11);
  assert.equal(new Set(labels).size,labels.length);
});

test('maximum label count is respected',()=>{
  assert.deepEqual(adaptiveLabelIndices(101,1000,20,5),[0,25,50,75,100]);
});
