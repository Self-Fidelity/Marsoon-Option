import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/server/option-underlying.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {bindOptionQuery,checkBoundResponse,allowedStatusEntry}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('all GC option routes force GCZ6, including an obsolete explicit query',()=>{
 for(const path of ['dashboard','levels','chain','term','intraday','underlying-bars','heatmap']){
  const q=bindOptionQuery('/options/'+path,{product:'GC',underlying:'GCV6',strict_underlying:'false'});
  assert.equal(q.underlying,'GCZ6');assert.equal(q.strict_underlying,'true');
 }
});
test('NQ and ES keep their existing selection behavior',()=>{
 const q={product:'NQ',scope:'0dte'};assert.equal(bindOptionQuery('/options/dashboard',q),q);
});
test('mismatched nested data fails closed instead of being renamed',()=>{
 assert.doesNotThrow(()=>checkBoundResponse({series:[{futures:'GCZ6'}],heatmap:{cells:[{underlying_symbol:'gcz6'}]}},'GCZ6'));
 assert.throws(()=>checkBoundResponse({chain:{futures:'GCV6'}},'GCZ6'),/其他合约/);
 assert.throws(()=>checkBoundResponse({heatmap:{cells:[{underlying_symbol:'GCV6'}]}},'GCZ6'),/其他合约/);
});
test('status does not use a fresh GCV6 entry to indicate GCZ6 is fresh',()=>{
 assert.equal(allowedStatusEntry({product:'GC',underlying_symbol:'GCV6'}),false);
 assert.equal(allowedStatusEntry({product:'GC',underlying_symbol:'GCZ6'}),true);
 assert.equal(allowedStatusEntry({product:'ES',underlying_symbol:'ESU6'}),true);
});
