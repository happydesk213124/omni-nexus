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

it('sends the surviving character tabs’ roster identities, including shared namesakes', () => {
  const state = emptyState();
  const local = { id: 'local-a', scope: 'owner', name: '동명이인', appearance: 'red hair' };
  const shared = { id: 'shared-a', scope: '__global__', name: '동명이인', appearance: 'blue hair' };
  const roster = [local, shared];
  hydrateFromNai({ state, nai: { characters: [{ ...shared, prompt: 'blue hair' }, { ...local, prompt: 'red hair' }] },
    settings: {}, rosterPayload: { characters: [local], global: [shared] }, card: {} });
  assert.deepEqual(assembleOverrides(state, roster).characters.map(({ id, scope }) => ({ id, scope })),
    [{ id: shared.id, scope: shared.scope }, { id: local.id, scope: local.scope }]);
  const tabs = state.tabs.filter(tab => tab.kind === 'char');
  state.tabs = state.tabs.filter(tab => tab.id !== tabs[0].id);
  assert.deepEqual(assembleOverrides(state, roster).characters.map(char => char.id), [local.id],
    'deleted tabs cannot leak identity from the retained chars map');
  state.chars[tabs[1].id].rosterId = shared.id;
  assert.deepEqual(assembleOverrides(state, roster).characters.map(({ id, scope }) => ({ id, scope })),
    [{ id: shared.id, scope: shared.scope }], 'changing a tab replaces its old metadata identity');
  state.chars[tabs[1].id].rosterId = '';
  assert.equal(assembleOverrides(state, roster).characters[0].id, undefined,
    'an unassigned caption must not recover its stale roster identity');
});

describe('studioModelChoice', () => {
  it('maps metadata labels onto the two family buttons', () => {
    assert.equal(studioModelChoice('nai-diffusion-5-curated'), 'nai-diffusion-5-full');
    assert.equal(studioModelChoice('nai-diffusion-4-5-full'), 'nai-diffusion-4-5-full');
    assert.equal(studioModelChoice(''), '');
  });
});

describe('hydrateFromNai', () => {
  it('restores coordinate visibility without discarding imported positions', () => {
    for (const visible of [false, true]) {
      const state = emptyState();
      hydrateFromNai({ state, nai: { characters: [{ prompt: 'girl', center_x: 0.38, center_y: 0.5 }] },
        settings: { card: { studio_coords_visible: visible } }, rosterPayload: {}, card: {} });
      assert.equal(state.coordMode, 'manual');
      assert.equal(state.coordVisible, visible);
      assert.equal(assembleOverrides(state, []).characters[0].center_x, 0.38,
        'hiding the overlay must preserve generation coordinates');
    }
  });

  it('retains imported Medium effort and lets studio override it in either model mode', () => {
    const state = emptyState();
    hydrateFromNai({ state, nai: { model: 'nai-diffusion-5-full-medium', steps: 14, sampler: 'k_euler_ancestral' },
      settings: {}, rosterPayload: {}, card: {} });
    assert.equal(state.gen.effort, 'medium');
    assert.equal(assembleOverrides(state, []).model, 'nai-diffusion-5-full-medium');
    state.gen.model = '';
    assert.equal(assembleOverrides(state, []).model, 'nai-diffusion-5-full-medium', 'image values retain Medium');
    state.gen.effort = 'high';
    assert.equal(assembleOverrides(state, []).model, 'nai-diffusion-5-full', 'image values can switch to High');
    state.gen.model = 'nai-diffusion-5-full';
    state.gen.steps = '23'; state.gen.sampler = 'k_euler'; state.gen.rescale = 0.2;
    state.gen.effort = 'medium';
    const medium = assembleOverrides(state, []);
    assert.equal(medium.steps, 14); assert.equal(medium.sampler, 'k_euler_ancestral'); assert.equal(medium.cfg_rescale, 0);
    state.gen.model = 'nai-diffusion-4-5-full';
    assert.equal(assembleOverrides(state, []).model, 'nai-diffusion-4-5-full');
    assert.equal(assembleOverrides(state, []).steps, '23', 'V4 keeps editable settings');
    state.gen.model = 'nai-diffusion-5-full'; state.gen.effort = 'high';
    assert.equal(assembleOverrides(state, []).steps, '23', 'High settings survive temporary Medium selection');
    hydrateFromNai({ state, nai: { model: 'nai-diffusion-5-full', steps: 14 }, settings: {}, rosterPayload: {}, card: {} });
    assert.equal(state.gen.effort, 'high', '14 steps do not imply Medium');
  });

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

  for (const kind of ['illustration', 'comic']) {
  it(`keeps unmatched main and C captions verbatim (${kind})`, () => {
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
      card: { kind },
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

  it(`fills C from the image caption, not the live roster dump (${kind})`, () => {
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
      card: { kind },
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
    assert.equal(ov.characters[0].name, '보민');
    assert.equal(ov.characters[0].costume, 'default');
    assert.match(ov.characters[0].prompt, /school uniform/);
  });
  }
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


describe('studio costume upper and lower fields', () => {
  it('splits caption garments, includes edited bottoms, and respects clearing both fields', () => {
    const state = emptyState();
    hydrateFromNai({
      state,
      nai: { characters: [{ name: 'Hana', costume: 'default', action: 'smile',
        prompt: 'black hair, hoodie, blue jeans, custom lower garment, smile' }] },
      settings: { card: {} },
      rosterPayload: { characters: [{ id: 'hana', name: 'Hana', appearance: 'black hair',
        costumes: [{ name: 'default', attire: 'hoodie', bottoms: 'blue jeans, custom lower garment, unused roster garment' }] }], global: [] },
      card: {},
    });
    const c = Object.values(state.chars)[0];
    assert.equal(c.costumeTags, 'hoodie');
    assert.equal(c.costumeBottoms, 'blue jeans, custom lower garment');
    assert.equal(c.post, 'smile');
    c.costumeBottoms = 'pleated skirt';
    let prompt = assembleOverrides(state, []).characters[0].prompt;
    assert.match(prompt, /hoodie, pleated skirt/);
    assert.doesNotMatch(prompt, /jeans|custom lower garment|unused roster garment/);
    c.costumeTags = '';
    c.costumeBottoms = '';
    prompt = assembleOverrides(state, []).characters[0].prompt;
    assert.equal(prompt, 'black hair, smile');
  });
});
