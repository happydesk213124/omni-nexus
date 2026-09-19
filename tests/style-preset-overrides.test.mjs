import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGenerationCfgParams } from '../.test-build/style-preset-overrides.mjs';

const baseNai = { cfg_scale: 7, cfg_rescale: 0.36, steps: 28, scheduler: 'karras', sampler: 'k_euler' };

test('empty preset keeps NAI CFG defaults', () => {
  assert.deepEqual(resolveGenerationCfgParams(baseNai, null), {
    cfg_scale: 7,
    cfg_rescale: 0.36,
    steps: 28,
    scheduler: 'karras',
    sampler: 'k_euler',
  });
  assert.deepEqual(resolveGenerationCfgParams(baseNai, {}), {
    cfg_scale: 7,
    cfg_rescale: 0.36,
    steps: 28,
    scheduler: 'karras',
    sampler: 'k_euler',
  });
});

test('preset cfg overrides NAI defaults', () => {
  assert.deepEqual(
    resolveGenerationCfgParams(baseNai, {
      cfg_scale: 5.5,
      cfg_rescale: 0.2,
      steps: 23,
      scheduler: 'native',
      sampler: 'k_dpmpp_2m_sde',
    }),
    { cfg_scale: 5.5, cfg_rescale: 0.2, steps: 23, scheduler: 'native', sampler: 'k_dpmpp_2m_sde' },
  );
});

test('empty preset sampler keeps the NAI family sampler', () => {
  assert.equal(resolveGenerationCfgParams(baseNai, { sampler: '' }).sampler, 'k_euler');
  assert.equal(resolveGenerationCfgParams(baseNai, { sampler: null }).sampler, 'k_euler');
  assert.equal(resolveGenerationCfgParams(baseNai, { sampler: 'ddim_v3' }).sampler, 'k_euler');
});
