import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadModule(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => require(name);
  new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}

test('widget product changes are local; toolbar switches all windows including restored unlinked ones', () => {
  const { useBoardWindowStore: store, effectiveTableScope } = loadModule('../src/features/board/board-window-store.ts');
  for (const id of ['overview', 'intraday', 'chain']) store.getState().ensureWindow(id);
  const initial = store.getState();
  store.getState().hydrate({
    master: initial.master,
    perProductScope: initial.perProductScope,
    windows: {
      ...initial.windows,
      chain: { ...initial.windows.chain, productLinked: false, scope: 'd90', scopes: ['d90'], kPeriod: 15 },
    },
  });
  const before = store.getState();
  store.getState().setWindowProduct('overview', 'ES');
  const local = store.getState();
  assert.equal(local.windows.overview.product, 'ES');
  assert.equal(local.master, before.master);
  assert.equal(local.windows.intraday, before.windows.intraday);
  assert.equal(local.windows.chain, before.windows.chain);
  assert.equal(local.perProductScope, before.perProductScope);

  store.getState().setWindowProduct('chain', 'GC');
  assert.equal(store.getState().windows.overview.product, 'ES');
  assert.equal(store.getState().master.product, 'NQ');

  // Reapplying the master product must also bring locally changed windows back.
  store.getState().setMasterProduct('NQ');
  assert.ok(Object.values(store.getState().windows).every((config) => config.product === 'NQ'));
  store.getState().setMasterProduct('GC');
  const global = store.getState();
  assert.equal(global.master.product, 'GC');
  for (const id of Object.keys(before.windows)) {
    assert.deepEqual(global.windows[id], { ...before.windows[id], product: 'GC' });
  }
  assert.equal(effectiveTableScope(global.windows.chain, global.perProductScope), 'd90');
  store.getState().ensureWindow('new-window');
  assert.equal(store.getState().windows['new-window'].product, 'GC');

  store.getState().setWindowProduct('overview', 'ES');
  const saved = store.getState();
  store.getState().hydrate({ master: saved.master, perProductScope: saved.perProductScope, windows: saved.windows });
  assert.equal(store.getState().windows.overview.product, 'ES');
  assert.equal(store.getState().windows.chain.product, 'GC');
  assert.equal(store.getState().master.product, 'GC');
});

test('widget scope changes update only that widget and leave the master query stable', () => {
  const { useBoardWindowStore: store, effectiveLineScopes } = loadModule('../src/features/board/board-window-store.ts');
  for (const id of ['volatility']) store.getState().ensureWindow(id);
  const before = store.getState();

  store.getState().toggleLineScope('volatility', 'd30');
  const afterLine = store.getState();
  assert.equal(afterLine.master, before.master);
  assert.equal(afterLine.perProductScope, before.perProductScope);
  assert.equal(afterLine.windows.volatility.productLinked, false);
  assert.deepEqual(effectiveLineScopes(afterLine.windows.volatility, afterLine.perProductScope), ['d30']);
});

test('volatility scopes support an isolated four-way overlay and never become empty', () => {
  const { useBoardWindowStore: store, effectiveLineScopes } = loadModule('../src/features/board/board-window-store.ts');
  store.getState().ensureWindow('volatility');
  const master = store.getState().master;
  for (const scope of ['d30', 'd90', 'close']) store.getState().toggleLineScopeMulti('volatility', scope);
  assert.deepEqual(effectiveLineScopes(store.getState().windows.volatility, store.getState().perProductScope), ['0dte', 'd30', 'd90', 'close']);
  assert.equal(store.getState().master, master);
  store.getState().toggleLineScopeMulti('volatility', 'd30');
  assert.deepEqual(effectiveLineScopes(store.getState().windows.volatility, store.getState().perProductScope), ['0dte', 'd90', 'close']);
  for (const scope of ['d90', 'close', '0dte']) store.getState().toggleLineScopeMulti('volatility', scope);
  assert.deepEqual(effectiveLineScopes(store.getState().windows.volatility, store.getState().perProductScope), ['0dte']);
});

test('query-driving widget controls survive dock remounts without changing sibling windows', () => {
  const { useBoardWindowStore: store } = loadModule('../src/features/board/board-window-store.ts');
  for (const id of ['expiration', 'volatility', 'chain', 'spread', 'intraday']) store.getState().ensureWindow(id);
  const intraday = store.getState().windows.intraday;
  store.getState().setHeatmapExpiryMode('expiration', 'all');
  store.getState().setSmileSelectedSeries('volatility', 'NQ:0dte', 'series-a');
  store.getState().setChainExpiration('chain', 1790000000);
  store.getState().setSpreadView('spread', 'pcr');
  store.getState().setIvTermAxis('spread', 'date');
  store.getState().setIvTermDates('spread', ['2026-09-05', 'bad-date', '2026-09-04']);
  const saved = store.getState();
  store.getState().hydrate({ master: saved.master, perProductScope: saved.perProductScope, windows: saved.windows });
  const restored = store.getState().windows;
  assert.equal(restored.expiration.heatmapExpiryMode, 'all');
  assert.equal(restored.volatility.smileSelectedSeries['NQ:0dte'], 'series-a');
  assert.equal(restored.chain.chainExpiration, 1790000000);
  assert.equal(restored.spread.spreadView, 'pcr');
  assert.equal(restored.spread.ivTermAxis, 'date');
  assert.deepEqual(restored.spread.ivTermDates, ['2026-09-05', '2026-09-04']);
  assert.deepEqual({ ...restored.intraday, vpW: undefined }, { ...intraday, vpW: undefined });
});
