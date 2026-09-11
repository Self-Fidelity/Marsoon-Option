import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/board/intraday-data.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {mergeCandlePayload,mergeDashboardCurrent,unionBars}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const intraday={product:'NQ',scope:'d30',day:'2026-09-05:closed',has_data:true,underlying_symbol:'NQU6',bars:[],levels:[],current:null};
const dashboard={product:'NQ',scope:'d30',has_data:true,snapshot_unix:120,market_state:{underlying_symbol:'NQU6'},summary:{underlying_price:100,call_wall:110,put_wall:90,gamma_flip:101,atm_iv:.2,expected_move_lower:80,expected_move_upper:120}};

test('dashboard current levels fill the matching intraday scope without changing history',()=>{
  const merged=mergeDashboardCurrent(intraday,dashboard);
  assert.deepEqual(merged.current,{captured_at:120,spot:100,call_wall:110,put_wall:90,gamma_flip:101,atm_iv:.2,expected_move:20});
  assert.deepEqual(merged.levels,[]);
});

test('dashboard current levels fail closed on another underlying or empty data',()=>{
  assert.equal(mergeDashboardCurrent(intraday,{...dashboard,market_state:{underlying_symbol:'NQZ6'}}),intraday);
  assert.equal(mergeDashboardCurrent(intraday,{...dashboard,has_data:false}),intraday);
});

test('independent candles paint first and survive the later option payload',()=>{
  const candles={...intraday,has_data:true,bars:[{unix:60,open:100,high:102,low:99,close:101,volume:7}],candle_underlying_symbol:'NQU6',candle_notice:'最近交易日'};
  assert.equal(mergeCandlePayload(undefined,candles),candles);
  const merged=mergeCandlePayload({...intraday,current:{spot:101},levels:[{t:60,call_wall:110}]},candles);
  assert.deepEqual(merged.bars,candles.bars);
  assert.deepEqual(merged.levels,[{t:60,call_wall:110}]);
  assert.deepEqual(merged.current,{spot:101});
  assert.equal(merged.candle_notice,'最近交易日');
});

test('a degraded candle payload must never wipe existing history (union, 2026-09-10)',()=>{
  const history=[{unix:60,open:100,high:101,low:99,close:100,volume:5},{unix:120,open:100,high:102,low:99,close:101,volume:6},{unix:180,open:101,high:103,low:100,close:102,volume:8}];
  const degraded={...intraday,has_data:true,bars:[{unix:240,open:102,high:104,low:101,close:103,volume:3}],candle_underlying_symbol:'NQU6'};
  const merged=mergeCandlePayload({...intraday,bars:history},degraded);
  assert.equal(merged.bars.length,4);
  assert.deepEqual(merged.bars.map(b=>b.unix),[60,120,180,240]);
  assert.deepEqual(unionBars(history,[]),history);
  assert.deepEqual(unionBars([],history),history);
  assert.deepEqual(unionBars(history,[{unix:180,open:1,high:1,low:1,close:1,volume:0}]).at(-1).volume,0);
});
