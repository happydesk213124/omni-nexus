import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleOverrides,
  emptyState,
  hasPlacedCoords,
  hydrateFromNai,
  mergeStudioRosterPayloads,
  studioModelChoice,
  studioRowIsGlobal,
} from '../.test-build/tag-studio-model.mjs';

describe('studioModelChoice', () => {
  it('maps metadata labels onto the two family buttons', () => {
    assert.equal(studioModelChoice('nai-diffusion-5-curated'), 'nai-diffusion-5-full');
    assert.equal(studioModelChoice('nai-diffusion-4-5-full'), 'nai-diffusion-4-5-full');
    assert.equal(studioModelChoice(''), '');
  });
});

describe('hydrateFromNai', () => {
  it('fills gen from image meta and turns coord view on when centers are placed', () => {
    const state = emptyState();
    hydrateFromNai({
      state,
      nai: {
        main_prompt: 'cafe, night',
        negative_prompt: 'lowres',
        model: 'nai-diffusion-4-5-full',
        seed: 777,
        width: 1216,
        height: 832,
        characters: [
          { name: '', prompt: 'girl', uc: '', center_x: 0.2, center_y: 0.5 },
        ],
      },
      settings: { card: { presets: [] } },
      rosterPayload: { characters: [], global: [] },
      card: { kind: 'illustration' },
    });
    assert.equal(state.gen.model, 'nai-diffusion-4-5-full');
    assert.equal(state.gen.w, 1216);
    assert.equal(state.gen.h, 832);
    assert.equal(state.gen.seed, 777);
    assert.equal(state.coordMode, 'manual');
    assert.equal(state.coordVisible, true);
    const ov = assembleOverrides(state, []);
    assert.equal(ov.model, 'nai-diffusion-4-5-full');
    assert.equal(ov.width, 1216);
    assert.equal(ov.height, 832);
    assert.equal(ov.use_coords, true);
  });

  it('keeps AI choice when every center is 0.5', () => {
    const state = emptyState();
    hydrateFromNai({
      state,
      nai: {
        main_prompt: 'cafe',
        characters: [
          { prompt: 'girl', center_x: 0.5, center_y: 0.5 },
        ],
      },
      settings: { card: { presets: [] } },
      rosterPayload: { characters: [], global: [] },
      card: {},
    });
    assert.equal(state.coordMode, 'ai');
    assert.equal(assembleOverrides(state, []).use_coords, false);
    const id = Object.keys(state.chars)[0];
    assert.equal(state.chars[id].charName, '');
    assert.equal(state.tabs.find((t) => t.kind === 'char')?.label, 'C1');
  });

  it('keeps C1/C2 labels when a metadata name is not on the roster', () => {
    const state = emptyState();
    hydrateFromNai({
      state,
      nai: {
        main_prompt: 'cafe',
        characters: [
          { name: '모르는사람', prompt: 'girl, waving' },
          { prompt: 'boy, sitting' },
        ],
      },
      settings: { card: { presets: [] } },
      rosterPayload: { characters: [], global: [] },
      card: {},
    });
    const labels = state.tabs.filter((t) => t.kind === 'char').map((t) => t.label);
    assert.deepEqual(labels, ['C1', 'C2']);
  });

  it('does not open C tabs for empty character slots', () => {
    const state = emptyState();
    hydrateFromNai({
      state,
      nai: {
        main_prompt: 'cafe',
        characters: [
          { prompt: '', uc: '', name: '' },
          { prompt: '', center_x: 0.5, center_y: 0.5 },
        ],
      },
      settings: { card: { presets: [] } },
      rosterPayload: { characters: [], global: [] },
      card: {},
    });
    assert.equal(state.tabs.filter((t) => t.kind === 'char').length, 0);
    assert.equal(assembleOverrides(state, []).characters.length, 0);
  });

  it('keeps unmatched main and C captions verbatim', () => {
    const state = emptyState();
    const main = '0.5::artist:lunch \\(shin new\\) ::,  anime coloring,  close-up';
    const girl = 'android, tall, 175cm,  jet black hair';
    hydrateFromNai({
      state,
      nai: {
        main_prompt: main,
        negative_prompt: 'lowres,  worst quality',
        characters: [{ prompt: girl, uc: 'bad hands' }],
      },
      settings: { card: { presets: [{ id: 'other', positive: 'best quality, very aesthetic' }] } },
      rosterPayload: { characters: [], global: [] },
      card: { kind: 'illustration' },
    });
    assert.equal(state.main.presetId, '');
    assert.equal(state.main.presetPrompt, '');
    assert.equal(state.main.post, main);
    assert.equal(state.main.neg, 'lowres,  worst quality');
    const id = Object.keys(state.chars)[0];
    assert.equal(state.chars[id].tags, '');
    assert.equal(state.chars[id].costumeTags, '');
    assert.equal(state.chars[id].post, girl);
    const ov = assembleOverrides(state, []);
    assert.equal(ov.main_prompt, main);
    assert.equal(ov.negative_prompt, 'lowres,  worst quality');
    assert.equal(ov.characters[0].prompt, girl);
  });

  it('fills C from the image caption, not the live roster dump', () => {
    const state = emptyState();
    hydrateFromNai({
      state,
      nai: {
        main_prompt: 'cafe',
        characters: [{
          name: '보민',
          prompt: 'long silver hair, blue eyes, school uniform, blue tie, waving, smile',
          action: 'waving',
          expression: 'smile',
          costume: 'default',
          center_x: 0.5,
          center_y: 0.5,
        }],
      },
      settings: { card: { presets: [] } },
      rosterPayload: {
        characters: [{
          id: 'bomin',
          name: '보민',
          appearance: 'long silver hair, blue eyes, extra roster only',
          costumes: [{ name: 'default', attire: 'school uniform, blue tie', note: '' }],
        }],
        global: [],
      },
      card: { kind: 'illustration' },
    });
    const id = Object.keys(state.chars)[0];
    const c = state.chars[id];
    assert.equal(c.tags, 'long silver hair, blue eyes');
    assert.equal(c.costumeTags, 'school uniform, blue tie');
    assert.equal(c.post, 'waving, smile');
    assert.equal(c.charName, '보민');
    assert.ok(!c.tags.includes('extra roster only'));
    c.tags = 'bob cut';
    const ov = assembleOverrides(state, [{
      id: 'bomin',
      name: '보민',
      appearance: 'long silver hair, extra roster only',
    }]);
    assert.match(String(ov.characters[0].prompt), /bob cut/);
    assert.ok(!String(ov.characters[0].prompt).includes('extra roster only'));
    assert.ok(!String(ov.characters[0].prompt).includes('long silver hair'));
  });
});

describe('hasPlacedCoords', () => {
  it('is false for the AI-choice default', () => {
    assert.equal(hasPlacedCoords([{ center_x: 0.5, center_y: 0.5 }]), false);
    assert.equal(hasPlacedCoords([{ x: 0.3, y: 0.5 }]), true);
  });
});

describe('studioRowIsGlobal', () => {
  const globals = [{ id: 'g1', name: 'Hana' }];

  it('matches the same id, not a shared name', () => {
    assert.equal(studioRowIsGlobal({ id: 'g1', name: 'Hana' }, globals), true);
    assert.equal(studioRowIsGlobal({ id: 's1', name: 'Hana' }, globals), false);
  });

  it('treats an explicit global scope as global', () => {
    assert.equal(studioRowIsGlobal({ id: 'x', name: 'A', scope: '__global__' }, []), true);
  });
});

describe('mergeStudioRosterPayloads', () => {
  it('keeps session rows from a second source when the first is empty', () => {
    const merged = mergeStudioRosterPayloads(
      { characters: [], global: [{ id: 'g1', name: 'G' }] },
      { characters: [{ id: 's1', name: 'Chat' }], global: [] },
    );
    assert.equal(merged.characters.length, 1);
    assert.equal(merged.characters[0].id, 's1');
    assert.equal(merged.global[0].id, 'g1');
  });
});
