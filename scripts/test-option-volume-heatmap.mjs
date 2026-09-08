import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/board/option-volume-heatmap-model.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildOptionVolumeHeatmapModel,optionVolumeHeatmapValue}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const row=(unix,strike,call,put,expiration=1000)=>({unix,expiration,strike,call_buy_contracts:call,call_sell_contracts:0,call_unknown_contracts:0,put_buy_contracts:put,put_sell_contracts:0,put_unknown_contracts:0,call_trades:call?1:0,put_trades:put?1:0,source_unix:unix});
const response={product:'NQ',scope:'0dte',from:0,to:1000,source_from:0,source_to:1000,fallback:false,fallback_days:0,base_timeframe:60,has_data:true,rows:[row(60,100,10,4),row(60,100,3,2,1100),row(120,100,1,5),row(120,105,2,0)]};

test('one-minute heatmap aggregates expirations at the same strike without differencing minutes',()=>{
 const model=buildOptionVolumeHeatmapModel(response,'difference','1m');
 const first=model.cells.find(cell=>cell.unix===60&&cell.strike===100);
 assert.deepEqual({call:first.call,put:first.put,total:first.total,difference:first.difference,ratio:first.ratio},{call:13,put:6,total:19,difference:7,ratio:7/19});
 assert.equal(optionVolumeHeatmapValue(first,'difference'),7);
});

test('five-minute mode sums raw minute buckets and session mode accumulates through time',()=>{
 const five=buildOptionVolumeHeatmapModel(response,'total','5m');
 assert.deepEqual(five.cells.find(cell=>cell.strike===100),{unix:0,strike:100,call:14,put:11,total:25,difference:3,ratio:3/25,callTrades:3,putTrades:3});
 const session=buildOptionVolumeHeatmapModel(response,'difference','session');
 const last=session.cells.filter(cell=>cell.unix===120&&cell.strike===100)[0];
 assert.deepEqual({call:last.call,put:last.put,difference:last.difference},{call:14,put:11,difference:3});
});
