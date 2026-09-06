import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/board/expiration-heatmap-viewport.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {nearbyStrikeWindow,virtualRowWindow}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('nearby strike mode keeps 40 rows on each side of spot',()=>{
  const strikes=Array.from({length:200},(_,index)=>4000-index*5);
  const selected=nearbyStrikeWindow(strikes,3500,40);
  assert.equal(selected.length,81);
  assert.ok(selected.includes(3500));
});

test('virtual heatmap renders only visible rows plus bounded overscan',()=>{
  const first=virtualRowWindow(404,0,620,28,44,10);
  assert.deepEqual(first,{start:0,end:31,top:0,bottom:(404-31)*28});
  const middle=virtualRowWindow(404,44+200*28,620,28,44,10);
  assert.equal(middle.start,190);assert.equal(middle.end,231);
  assert.equal(middle.top+middle.bottom+(middle.end-middle.start)*28,404*28);
});
