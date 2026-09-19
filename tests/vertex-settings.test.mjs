import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const built = await build({ stdin: { contents: `
  export { updateSettings, publicSettings, saveConfig } from './src/services/settings.ts';
  export { getConfig } from './src/services/context.ts';
  export { readLlmRoleFromDom } from './src/ui-contract/llm-form.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Subject' });

function fixture() {
  const stored = new Map();
  const state = { fail: false, dropWrite: false };
  const context = { console, performance, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout,
    risuai: { pluginStorage: {
      getItem: async key => structuredClone(stored.get(key) ?? null),
      setItem: async (key, value) => { if (state.fail) throw new Error('write rejected'); if (!state.dropWrite) stored.set(key, structuredClone(value)); },
    } },
  };
  runInNewContext(built.outputFiles[0].text, context);
  return { ...context.Subject, stored, state };
}
const sa = JSON.stringify({ project_id: 'test-project', client_email: 'test@example.invalid', private_key: 'fake-test-key' });

test('SA updates acknowledge durable storage and public responses redact the credential', async () => {
  const f = fixture();
  const result = await f.updateSettings({ llm: { service_account_json: sa } });
  assert.equal(f.stored.get('onx_native_settings')?.llm.service_account_json, sa);
  assert.equal(result.settings.llm.service_account_json, '');
  assert.equal(result.settings.llm.service_account_configured, true);
  await f.updateSettings({ llm: { service_account_json: '' } });
  assert.equal(f.getConfig().llm.service_account_json, sa, 'blank form preserves the saved key');
  await f.saveConfig({ flush: true });
});

test('the empty credential form can clear main and role SA without clearing another role', async () => {
  const f = fixture();
  await f.updateSettings({ llm: { service_account_json: sa }, llm_roles: {
    autotag: { service_account_json: sa }, asset_char: { service_account_json: sa },
  } });
  const patch = f.readLlmRoleFromDom({ has: () => true, get: () => '', checked: id => id.endsWith('-clear-sa') }, 'nx-llm');
  await f.updateSettings({ llm: patch, llm_roles: { autotag: { clearServiceAccount: true } } });
  assert.equal(f.getConfig().llm.service_account_json, '');
  assert.equal(f.getConfig().llm_roles.autotag.service_account_json, '');
  assert.equal(f.getConfig().llm_roles.asset_char.service_account_json, sa);
  assert.equal(f.publicSettings().llm.service_account_configured, false);
  assert.equal(f.stored.get('onx_native_settings')?.llm_roles.autotag.service_account_json, '');
});

test('SA write failures reject the save instead of returning success', async () => {
  const f = fixture();
  f.state.fail = true;
  await assert.rejects(f.updateSettings({ llm: { service_account_json: sa } }), /write rejected/);
  assert.equal(f.publicSettings().llm.service_account_configured, false, 'failed saves must not become registered after repaint');
});

test('failed SA removal keeps the registered credential and can be retried', async () => {
  const f = fixture();
  await f.updateSettings({ llm_roles: { comic: { service_account_json: sa } } });
  f.state.fail = true;
  await assert.rejects(f.updateSettings({ llm_roles: { comic: { clearServiceAccount: true } } }), /write rejected/);
  assert.equal(f.getConfig().llm_roles.comic.service_account_json, sa);
  assert.equal(f.publicSettings().llm_roles.comic.service_account_configured, true);
  f.state.fail = false;
  await f.updateSettings({ llm_roles: { comic: { clearServiceAccount: true } } });
  assert.equal(f.stored.get('onx_native_settings').llm_roles.comic.service_account_json, '');
});

test('a host that silently ignores a credential write is not reported as saved', async () => {
  const f = fixture();
  await f.updateSettings({ llm: { service_account_json: sa } });
  f.state.dropWrite = true;
  await assert.rejects(f.updateSettings({ llm: { clearServiceAccount: true } }), /설정 저장 실패/);
  assert.equal(f.getConfig().llm.service_account_json, sa);
});
