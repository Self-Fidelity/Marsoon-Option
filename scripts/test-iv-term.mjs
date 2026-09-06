import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function load(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { buildIvTerm } = await load('../src/server/iv-term-model.ts');
const { ivTermGroups, ivTermPaths, ivTermX } = await load('../src/features/board/iv-term-model.ts');
const snapshot = 1788546600;
const expiry = snapshot + 7*86400;
const point = (symbol, expiration, iv) => ({ underlying_symbol: symbol, expiration, atm_iv: iv, observed_min_unix: snapshot, observed_max_unix: snapshot });

test('IV term preserves futures groups and missing IV; rejects zero, invalid and expired values', () => {
  const data = buildIvTerm({ has_data: true, snapshot_unix: snapshot, expiries: [
    point('ESU6', expiry, .2), point('ESZ6', expiry, .3), point('ESU6', expiry+86400, 0),
    point('ESU6', expiry+2*86400, null), point('ESU6', expiry+3*86400, .25),
    point('ESU6', snapshot-1, .8), point('', expiry, .4),
  ] }, 'ES', 'd90', '2026-09-04');
  assert.equal(data.has_data, true);
  assert.equal(data.points.length, 5);
  const groups = ivTermGroups(data);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].symbol, 'ESU6');
  const paths = ivTermPaths(groups[0].points, p=>p.expiration, v=>v);
  assert.equal(paths.length, 2);
  assert.equal(paths.some(path=>path.includes(' L')), false);
  assert.equal(ivTermX(data.points[0],snapshot,'dte'), 7);
  assert.equal(ivTermX(data.points[0],snapshot-86400,'dte'), 8);
  assert.equal(ivTermX(data.points[0],snapshot,'date'), ivTermX(data.points[0],snapshot-86400,'date'));
});

test('historical comparisons never relabel another day or stale expiry observations', () => {
  const response={has_data:true,snapshot_unix:snapshot,expiries:[point('ESU6',expiry,.2)]};
  assert.equal(buildIvTerm(response,'ES','d90','2026-09-03').has_data,false);
  const stale={...response,expiries:[{...response.expiries[0],observed_min_unix:snapshot-86400}]};
  assert.equal(buildIvTerm(stale,'ES','d90','2026-09-04').points[0].atm_iv,null);
  assert.equal(buildIvTerm({...response,has_data:false},'ES','d90').has_data,false);
});

test('historical cutoff is 16:00 CT in both summer and winter', async () => {
  const { sessionStart } = await load('../src/server/intraday-candles.ts');
  assert.equal(new Date((sessionStart('2026-09-05')-3600)*1000).toISOString(),'2026-09-04T21:00:00.000Z');
  assert.equal(new Date((sessionStart('2026-01-10')-3600)*1000).toISOString(),'2026-01-09T22:00:00.000Z');
});
