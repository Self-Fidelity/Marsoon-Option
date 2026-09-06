import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/server/chain-from-dashboard.ts', import.meta.url), 'utf8');
let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
js = js.replace(
  /import \{[\s\S]*?\} from "@\/api\/options";/,
  'const optionProductConfig={NQ:{multiplier:20,tickSize:.25},ES:{multiplier:50,tickSize:.25},GC:{multiplier:100,tickSize:.1}};',
);
const { composeChainFromDashboard } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('composes a 09 chain from dashboard strike rows without fabricating quotes', () => {
  const now = 1_788_551_880;
  const expiration = now + 120;
  const cells = [
    { unix: now, expiration, underlying_symbol: 'NQU6', strike: 29600, call_gex: 10, put_gex: 0, call_oi: 440, put_oi: 12, call_iv: 0.2, put_iv: 0.22, call_vol: 8, put_vol: 3, quality_flags: 0 },
    { unix: now, expiration, underlying_symbol: 'NQU6', strike: 29500, call_gex: 4, put_gex: -2, call_oi: 80, put_oi: 515, call_iv: null, put_iv: 0.3, quality_flags: 0 },
  ];
  const dashboard = {
    source: 'databento-go',
    product: 'NQ',
    scope: '0dte',
    has_data: true,
    snapshot_unix: now,
    underlying_symbol: 'NQU6',
    market_state: { unix: now, expiration, underlying_symbol: 'NQU6', underlying_price: 29569 },
    summary: { underlying_price: 29569, atm_iv: 0.8, call_wall: null, put_wall: null },
    levels: [
      { unix: now, metric: 'call_oi_wall', rank: 1, level: 29600 },
      { unix: now, metric: 'put_oi_wall', rank: 1, level: 29500 },
    ],
    expiries: [{ expiration, underlying_symbol: 'NQU6', gross_gex: 12, atm_iv: 0.8 }],
    heatmap: { observed_min_unix: now, observed_max_unix: now, cells, levels: [] },
  };
  const chain = composeChainFromDashboard(dashboard, 'NQ', '0dte');
  assert.equal(chain.has_data, true);
  assert.equal(chain.chain.rows.length, 2);
  assert.equal(chain.chain.call_wall, 29600);
  assert.equal(chain.chain.put_wall, 29500);
  assert.equal(chain.chain.rows[0].call.bid, null);
  assert.equal(chain.chain.rows[0].call.oi, 440);
  const emptyCall = chain.chain.rows.find((row) => row.strike === 29500);
  assert.equal(emptyCall.call.oi, 80);
  assert.equal(emptyCall.put.oi, 515);
  assert.equal(chain.series.length, 1);
});

test('empty dashboard stays empty', () => {
  const dashboard = {
    product: 'NQ', scope: '0dte', has_data: false, snapshot_unix: 0,
    expiries: [], heatmap: { observed_min_unix: 0, observed_max_unix: 0, cells: [] },
    missing_reason: '当前周期暂无期权数据',
  };
  const chain = composeChainFromDashboard(dashboard, 'NQ', '0dte');
  assert.equal(chain.has_data, false);
  assert.equal(chain.chain, null);
});
