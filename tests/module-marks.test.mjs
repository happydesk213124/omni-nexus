import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Making sure of a module used to read every module in Risu, at each start and before each bake. These count the
// reads: `full` is the whole module list, `ids` the enabled list alone.
const bundle = await build({ stdin: { contents: `export { ensureInrayDisplayModule } from './src/storage/inray-display-module';
  export { ensureOmniHelperModule } from './src/storage/omni-helper-module';
  export { ensureInlineTagModule } from './src/storage/inline-tag-module';
  export { forgetModuleMarks } from './src/storage/module-write';
  export { resetDeviceStore } from './src/storage/device-store';
  export { writeHostDatabase } from './src/core/host';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

let db, save, reads, writes;
beforeEach(() => {
  db = { modules: [{ id: 'someone-elses', name: 'Other', regex: [], lorebook: [] }], enabledModules: ['someone-elses'] };
  save = new Map(); reads = { full: 0, ids: 0 }; writes = 0;
  globalThis.risuai = {
    pluginStorage: { getItem: async k => structuredClone(save.get(k)), setItem: async (k, v) => { save.set(k, structuredClone(v)); }, removeItem: async k => { save.delete(k); } },
    getDatabase: async keys => {
      if (keys.includes('modules')) reads.full++; else reads.ids++;
      return Object.fromEntries(keys.map(key => [key, structuredClone(db[key])]));
    },
    setDatabase: async patch => { writes++; Object.assign(db, structuredClone(patch)); },
  };
  api.resetDeviceStore(); api.forgetModuleMarks();
});
const controls = { enabled: true, userchat: false, folded: false };
const restart = () => { api.resetDeviceStore(); api.forgetModuleMarks(); reads.full = 0; reads.ids = 0; writes = 0; };

test('a module written once is not read again: later calls, and later starts, ask for the enabled list at most', async () => {
  assert.equal(await api.ensureInrayDisplayModule(false, 100, controls), true);
  assert.deepEqual([reads.full, writes], [1, 1], 'installed with one read of the modules and one write');
  assert.ok(db.enabledModules.includes('inlay-inray-display'));
  reads.full = 0; reads.ids = 0; writes = 0;
  for (let i = 0; i < 5; i++) assert.equal(await api.ensureInrayDisplayModule(false, 100, controls), true);
  assert.deepEqual([reads.full, writes], [0, 0], 'five bakes later: no module read, no write');
  assert.ok(reads.ids <= 1, 'the enabled list is asked for once, not once per bake');
  restart();
  assert.equal(await api.ensureInrayDisplayModule(false, 100, controls), true);
  assert.deepEqual([reads.full, reads.ids, writes], [0, 1, 0], 'the next start: the save says it is written, the enabled list says it is on');
});

test('what a mark cannot vouch for is made sure of the old way', async () => {
  await api.ensureInrayDisplayModule(false, 100, controls);
  // Another setting: other content.
  restart();
  await api.ensureInrayDisplayModule(false, 80, controls);
  assert.deepEqual([reads.full, writes], [1, 1], 'a changed scale is other content: read and written');
  // Switched off by hand in Risu.
  restart();
  db.enabledModules = db.enabledModules.filter(id => id !== 'inlay-inray-display');
  await api.ensureInrayDisplayModule(false, 80, controls);
  assert.equal(reads.full, 1, 'no longer switched on: read and put back');
  assert.ok(db.enabledModules.includes('inlay-inray-display'));
  // A save that never heard of the mark (an older build wrote the module).
  restart();
  save.delete('onx_module_marks');
  await api.ensureInrayDisplayModule(false, 80, controls);
  assert.deepEqual([reads.full, writes], [1, 0], 'no mark: read, found as it should be, nothing written');
  restart();
  await api.ensureInrayDisplayModule(false, 80, controls);
  assert.equal(reads.full, 0, 'and marked from then on');
});

test('the helper and the streaming-tag module: off and never used is "as wanted" too, with no module read at a start', async () => {
  assert.equal(await api.ensureOmniHelperModule(false), true);
  assert.equal(await api.ensureInlineTagModule(false, 100, false), true);
  assert.equal(db.modules.some(m => m.id === 'omni-inline-tags'), false, 'a module never switched on is not created');
  restart();
  assert.equal(await api.ensureOmniHelperModule(false), true);
  assert.equal(await api.ensureInlineTagModule(false, 100, false), true);
  assert.deepEqual([reads.full, writes], [0, 0]);
  assert.ok(reads.ids <= 1, 'both ask one enabled list between them');
  // Switched on: it is not on in Risu yet, so it is written.
  assert.equal(await api.ensureInlineTagModule(true, 100, false), true);
  assert.ok(db.enabledModules.includes('omni-inline-tags'));
  restart();
  assert.equal(await api.ensureInlineTagModule(true, 100, false), true);
  assert.deepEqual([reads.full, writes], [0, 0]);
});

test('a module write goes through setDatabaseLite where Risu has it: the full write marks every chat as not streaming', async () => {
  const calls = [];
  globalThis.risuai.setDatabaseLite = async patch => { calls.push('lite'); Object.assign(db, structuredClone(patch)); };
  globalThis.risuai.setDatabase = async () => { calls.push('full'); };
  await api.ensureInrayDisplayModule(false, 100, controls);
  assert.deepEqual(calls, ['lite']);
  delete globalThis.risuai.setDatabaseLite;
  globalThis.risuai.setDatabase = async patch => { calls.push('full'); Object.assign(db, structuredClone(patch)); };
  await api.writeHostDatabase({ enabledModules: [] });
  assert.deepEqual(calls, ['lite', 'full'], 'a host without it is written the old way');
});
