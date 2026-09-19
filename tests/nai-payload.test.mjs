import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBaseParameters,
  isNaiV5,
  modelToNaia,
  resolveModel,
  supportsDirectorReference,
  supportsVibeTransfer,
  usesCharCaptions,
} from '../.test-build/nai-payload.mjs';

test('modelToNaia maps official V5 ids and loose aliases', () => {
  assert.equal(modelToNaia('nai-diffusion-5-full'), 'naid5f');
  assert.equal(modelToNaia('nai-diffusion-5-curated'), 'naid5c');
  assert.equal(modelToNaia('NAI v5'), 'naid5f');
  assert.equal(modelToNaia('v5 curated'), 'naid5c');
  assert.equal(modelToNaia('nai-diffusion-4-5-full'), 'naid4.5f');
});

test('resolveModel sends official V5 slugs to the image API', () => {
  assert.equal(resolveModel('naid5f'), 'nai-diffusion-5-full');
  assert.equal(resolveModel('NAI v5'), 'nai-diffusion-5-full');
  assert.equal(resolveModel('nai-diffusion-5-curated'), 'nai-diffusion-5-curated');
  assert.equal(resolveModel('nai-diffusion-4-5-full'), 'nai-diffusion-4-5-full');
});

test('V5 uses v4_prompt captions; V5 launch has no director/vibe', () => {
  assert.equal(isNaiV5('nai-diffusion-5-full'), true);
  assert.equal(usesCharCaptions('nai-diffusion-5-full'), true);
  assert.equal(supportsDirectorReference('nai-diffusion-5-full'), false);
  assert.equal(supportsVibeTransfer('nai-diffusion-5-full'), false);
  assert.equal(supportsDirectorReference('nai-diffusion-4-5-full'), true);
});

test('buildBaseParameters attaches V5 character captions and params_version 4', () => {
  const params = buildBaseParameters({
    prompt: 'cafe',
    negative_prompt: 'lowres',
    width: 832,
    height: 1216,
    seed: 1,
    steps: 23,
    cfg_scale: 7,
    cfg_rescale: 0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    model: 'nai-diffusion-5-full',
    characters: [{ prompt: 'boy, smile', uc: '', center_x: 0.5, center_y: 0.5 }],
  });
  assert.equal(params.params_version, 4);
  assert.equal(params.autoSmea, false);
  assert.equal(params.v4_prompt?.caption?.base_caption, 'cafe');
  assert.equal(params.v4_prompt?.caption?.char_captions?.[0]?.char_caption, 'boy, smile');
  assert.equal(params.use_coords, false);
  assert.equal(params.v4_prompt?.use_coords, false);
});

test('buildBaseParameters sends use_coords only when requested', () => {
  const params = buildBaseParameters({
    prompt: 'cafe',
    negative_prompt: 'lowres',
    width: 832,
    height: 1216,
    seed: 1,
    steps: 23,
    cfg_scale: 7,
    cfg_rescale: 0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    model: 'nai-diffusion-5-full',
    use_coords: true,
    characters: [
      { prompt: 'girl', uc: '', center_x: 0.2, center_y: 0.5 },
      { prompt: 'boy', uc: '', center_x: 0.8, center_y: 0.5 },
    ],
  });
  assert.equal(params.use_coords, true);
  assert.equal(params.v4_prompt?.use_coords, true);
});
