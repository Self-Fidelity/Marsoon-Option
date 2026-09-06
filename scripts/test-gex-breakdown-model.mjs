import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/board/gex-breakdown-model.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {profileBarRatio,profileP95,splitSignedGrossExposure}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('Delta profile reconstructs positive and negative legs from net and gross',()=>{
  assert.deepEqual(splitSignedGrossExposure(40,100),{positive:70,negative:30,net:40,gross:100});
  assert.deepEqual(splitSignedGrossExposure(-40,100),{positive:30,negative:70,net:-40,gross:100});
});

test('Delta net is clamped to gross for inconsistent inputs',()=>{
  assert.deepEqual(splitSignedGrossExposure(120,100),{positive:100,negative:0,net:100,gross:100});
  assert.equal(splitSignedGrossExposure(undefined,100),undefined);
});

test('P95 and square-root scaling keep ordinary profile bars visible',()=>{
  const values=[...Array.from({length:95},(_,i)=>i+1),1000];
  const scale=profileP95(values);
  assert.equal(scale,91);
  assert.equal(profileBarRatio(scale,scale),1);
  assert.ok(profileBarRatio(10,scale)>.3);
  assert.equal(profileBarRatio(1000,scale),1);
});
