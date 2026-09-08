import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/board/candle-stream.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {parseCandleStreamMessage,mergeCandleStreamBars}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const encode=(value)=>Buffer.from(JSON.stringify(value)).toString('base64');

test('decodes a realtime candle envelope and includes unknown volume',()=>{
 const message=JSON.stringify({stream:4,timeframe:60,data:encode({pair:{exchange:'DATABENTO',symbol:'nqu6'},timeframe:60,values:[{unix:60,open:100,high:103,low:99,close:102,vbuy:4,vsell:3,vunknown:2,final:false}]})});
 assert.deepEqual(parseCandleStreamMessage(message),{symbol:'NQU6',timeframe:60,bars:[{unix:60,open:100,high:103,low:99,close:102,volume:9,final:false}]});
});

test('ignores historical chunks and upserts repeated live minutes',()=>{
 const historical=JSON.stringify({stream:4,request_id:'history-1',data:encode({pair:{symbol:'NQU6'},timeframe:60,values:[{unix:60,open:1,high:1,low:1,close:1}]})});
 assert.equal(parseCandleStreamMessage(historical),null);
 const current={underlying_symbol:'NQU6',candle_underlying_symbol:'NQU6',has_data:true,bars:[{unix:60,open:100,high:101,low:99,close:100,volume:2}]};
 const batch={symbol:'NQU6',timeframe:60,bars:[{unix:60,open:100,high:104,low:99,close:103,volume:8,final:false},{unix:120,open:103,high:105,low:102,close:104,volume:5,final:false}]};
 const merged=mergeCandleStreamBars(current,batch,1);
 assert.equal(merged.bars.length,2);
 assert.equal(merged.bars[0].volume,8);
 assert.equal(merged.bars[1].close,104);
});
