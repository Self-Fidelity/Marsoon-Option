import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/board/strike-viewport.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {clampStrikeViewport,zoomStrikeViewport,panStrikeViewport,defaultStrikeViewport}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('wheel zoom keeps the pointer strike anchored and respects minimum span',()=>{
  const full={lo:100,hi:200};
  const zoomed=zoomStrikeViewport(full,full,150,-300,10);
  assert.ok(zoomed.lo>100&&zoomed.hi<200);
  assert.equal((150-zoomed.lo)/(zoomed.hi-zoomed.lo),.5);
  const minimum=zoomStrikeViewport(zoomed,full,150,-10000,10);
  assert.equal(minimum.hi-minimum.lo,10);
});

test('drag pan keeps the visible span and clamps to the full strike range',()=>{
  const full={lo:100,hi:200};
  assert.deepEqual(panStrikeViewport({lo:120,hi:160},full,.25,10),{lo:130,hi:170});
  assert.deepEqual(panStrikeViewport({lo:120,hi:160},full,-10,10),{lo:100,hi:140});
  assert.deepEqual(clampStrikeViewport({lo:180,hi:260},full,10),{lo:120,hi:200});
});

test('default window sits around spot and falls back to the full chain when short',()=>{
  const full={lo:100,hi:400};
  assert.deepEqual(defaultStrikeViewport(full,250,5,10,24),{lo:190,hi:310});
  assert.deepEqual(defaultStrikeViewport({lo:100,hi:140},120,5,10,24),{lo:100,hi:140});
});
