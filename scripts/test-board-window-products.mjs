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
  const localRequire = (name) => name === './option-stats-model'
    ? loadModule('../src/features/board/option-stats-model.ts')
    : require(name);
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
