import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/features/board/lightweight-model.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {aggregateIntradayBars,buildChartPositions,tailUpdateStart,preserveLogicalRange}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const t=Date.parse('2026-09-04T15:00:00Z')/1000;
const bar=(unix,volume=2)=>({unix,open:100,high:104,low:98,close:102,volume,final:true});
test('minute data is deduplicated before OHLCV aggregation; gaps are not fabricated',()=>{
 const out=aggregateIntradayBars([bar(t+60,3),bar(t),{...bar(t+60,5),high:108,close:107},bar(t+600)],5);
 assert.equal(out.length,2);assert.deepEqual(out[0],{unix:t,open:100,high:108,low:98,close:107,volume:7,final:true});assert.equal(out[1].unix,t+600);
});
test('invalid candles never reach the chart engine',()=>{
 assert.equal(aggregateIntradayBars([null,{...bar(t),close:NaN},{...bar(t),low:110},{...bar(t),volume:-1}],1).length,0);
});
test('positions are from the exact underlying, keep missing values empty and merge equal scopes',()=>{
 const data={underlying_symbol:'NQU6',current:{call_wall:105,put_wall:null,gamma_flip:101,spot:102}};
 const out=buildChartPositions([{scope:'0dte',data},{scope:'d30',data:{...data,current:{call_wall:105,put_wall:0,gamma_flip:null,spot:102}}},{scope:'all',data:{...data,underlying_symbol:'NQZ6'}}],'0dte','NQU6',103);
 assert.deepEqual(out.find(p=>p.kind==='CW').scopes,['0dte','d30']);assert.equal(out.some(p=>p.kind==='PW'),false);assert.equal(out.some(p=>p.scopes.includes('all')),false);
 assert.equal(out.find(p=>p.kind==='SPOT').price,103);
});
test('tail updates are incremental, earlier corrections use a full replacement',()=>{
 const before=[bar(t),bar(t+60)];
 assert.equal(tailUpdateStart(before,[bar(t),bar(t+60,4),bar(t+120)]),1);
 assert.equal(tailUpdateStart(before,[bar(t,8),bar(t+60)]),null);
 assert.deepEqual(preserveLogicalRange(before,[...before,bar(t+120)],{from:0,to:8}),{from:0,to:8});
 assert.deepEqual(preserveLogicalRange(before,[bar(t-60),...before],{from:0,to:8}),{from:1,to:9});
});
