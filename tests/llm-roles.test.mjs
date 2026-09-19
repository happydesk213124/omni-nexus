import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveLlmRole,
  normalizeLlmRolesSettings,
  normalizeLlmFollowMain,
} from '../.test-build/llm-roles.mjs';
import { migrateSettings, exportSettings } from '../.test-build/settings-schema.mjs';

const mainLlm = {
  source: 'custom',
  provider: 'openrouter',
  model: 'main-model',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  api_key: 'main-key',
  temperature: 0.4,
  max_tokens: 8000,
};

test('normalizeLlmFollowMain defaults missing/unknown to true', () => {
  assert.equal(normalizeLlmFollowMain(undefined), true);
  assert.equal(normalizeLlmFollowMain(null), true);
  assert.equal(normalizeLlmFollowMain(''), true);
  assert.equal(normalizeLlmFollowMain(true), true);
  assert.equal(normalizeLlmFollowMain(false), false);
  assert.equal(normalizeLlmFollowMain('follow_main'), true);
  assert.equal(normalizeLlmFollowMain('custom'), false);
});

test('resolveLlmRole main always returns settings.llm', () => {
  const settings = { llm: mainLlm, llm_roles: { autotag: { follow_main: false, model: 'other' } } };
  assert.equal(resolveLlmRole(settings, 'main').model, 'main-model');
});

test('resolveLlmRole follow_main uses main tagging llm', () => {
  const settings = {
    llm: mainLlm,
    llm_roles: {
      autotag: { follow_main: true, model: 'ignored', api_key: 'ignored' },
      asset_char: { follow_main: true },
    },
  };
  assert.equal(resolveLlmRole(settings, 'autotag').model, 'main-model');
  assert.equal(resolveLlmRole(settings, 'asset_char').api_key, 'main-key');
});

test('resolveLlmRole own profile replaces main wholesale (no field merge)', () => {
  const settings = {
    llm: mainLlm,
    llm_roles: {
      autotag: {
        follow_main: false,
        source: 'custom',
        provider: 'openai',
        model: 'gpt-4o-mini',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        api_key: 'role-key',
        temperature: 0.1,
        max_tokens: 1024,
      },
    },
  };
  const resolved = resolveLlmRole(settings, 'autotag');
  assert.equal(resolved.model, 'gpt-4o-mini');
  assert.equal(resolved.provider, 'openai');
  assert.equal(resolved.api_key, 'role-key');
  assert.equal(resolved.temperature, 0.1);
  assert.equal('follow_main' in resolved, false);
  // No merge: main endpoint must not leak in when role has its own
  assert.equal(resolved.endpoint, 'https://api.openai.com/v1/chat/completions');
});

test('resolveLlmRole missing role defaults to follow main', () => {
  const settings = { llm: mainLlm };
  assert.equal(resolveLlmRole(settings, 'comic').model, 'main-model');
  const emptyRoles = resolveLlmRole({ llm: mainLlm, llm_roles: {} }, 'asset_char');
  assert.equal(emptyRoles.model, 'main-model');
});

test('resolveLlmRole legacy curator blob resolves to main (role retired)', () => {
  const settings = { llm: mainLlm, llm_roles: { curator: { follow_main: false, model: 'x' } } };
  assert.equal(resolveLlmRole(settings, 'curator').model, 'main-model');
});

test('migrateSettings fills llm_roles with follow_main true', () => {
  const migrated = migrateSettings({ llm: mainLlm });
  const roles = migrated.llm_roles;
  assert.ok(roles);
  assert.equal(roles.autotag.follow_main, true);
  assert.equal(roles.asset_char.follow_main, true);
  assert.equal(roles.curator, undefined);
});

test('migrateSettings preserves own role profile', () => {
  const migrated = migrateSettings({
    llm: mainLlm,
    llm_roles: {
      autotag: { follow_main: false, model: 'vision-x', provider: 'openai' },
    },
  });
  assert.equal(migrated.llm_roles.autotag.follow_main, false);
  assert.equal(migrated.llm_roles.autotag.model, 'vision-x');
  assert.equal(migrated.llm_roles.curator, undefined);
});

test('exportSettings redacts role api_key but keeps llm key name stable', () => {
  const json = exportSettings({
    llm: { ...mainLlm, api_key: 'main-secret' },
    llm_roles: {
      autotag: { follow_main: false, model: 'x', api_key: 'role-secret' },
    },
  });
  const parsed = JSON.parse(json);
  assert.equal(parsed.llm.model, 'main-model');
  assert.equal('api_key' in parsed.llm, false);
  assert.equal(parsed.llm_roles.autotag.model, 'x');
  assert.equal('api_key' in parsed.llm_roles.autotag, false);
});

test('normalizeLlmRolesSettings ensures both roles and drops retired curator', () => {
  const roles = normalizeLlmRolesSettings({ autotag: { follow_main: false, model: 'a' } });
  assert.equal(roles.autotag.follow_main, false);
  assert.equal(roles.autotag.model, 'a');
  assert.equal(roles.asset_char.follow_main, true);
  assert.equal(roles.curator, undefined);
});
