import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleOverrides,
  emptyState,
  hasPlacedCoords,
  hydrateFromNai,
  mergeStudioRosterPayloads,
  studioModelChoice,
  studioCharacterLookTags,
  applyStudioWearState,
  studioRowIsGlobal,
} from '../.test-build/tag-studio-model.mjs';

describe('image-derived half mode and clothing state', () => {
  const stored = { id: 'a', scope: 'owner', name: 'A', gender: 'girl', appearance: 'girl, 2::black hair::, 1.7::blue eyes::',
    costumes: [{ name: 'default', attire: 'hoodie', bottoms: 'jeans' }, { name: 'school', attire: '2::white shirt::', bottoms: 'skirt' }] };
  const load = (prompt, wear_state, costume = 'school') => {
    const state = emptyState();
    hydrateFromNai({ state, nai: { characters: [{ id: stored.id, scope: stored.scope, prompt, costume, wear_state }] },
      settings: {}, rosterPayload: { characters: [stored] }, card: {} });
    return { state, char: Object.values(state.chars)[0] };
  };

  it('recognizes nude by scoped identity, restores roster looks and keeps the image outfit', () => {
    const { state, char } = load('0.5::girl, black hair, blue eyes::, 2::white shirt::, skirt, nsfw, nipples, pussy, breasts out, 1.7::smile::', 'nude');
    assert.equal(char.rosterId, stored.id);
    assert.equal(char.costume, 'school');
    assert.equal(char.wearState, 'nude');
    assert.equal(char.halfWeight, true);
    assert.match(char.tags, /2::black hair::/);
    assert.match(char.tags, /1.7::blue eyes::/);
    const request = () => assembleOverrides(state, [stored]).characters[0];
    assert.equal(request().wear_state, 'nude');
    assert.match(request().prompt, /^0\.5::girl, black hair, blue eyes, nsfw, nipples, pussy, breasts out::, 2::white shirt::/);
    assert.match(request().prompt, /1\.7::smile::$/);
    for (const tag of ['white shirt', 'skirt', 'nsfw', 'nipples', 'pussy']) assert.ok(request().prompt.includes(tag));
    assert.doesNotMatch(request().prompt, /hoodie|jeans|2::black hair::|1\.7::blue eyes::/);
    char.halfWeight = false;
    assert.match(request().prompt, /2::black hair::/);
    assert.match(request().prompt, /2::white shirt::/);
    assert.match(request().prompt, /nsfw/);
    assert.equal(request().costume, 'school');
  });

  it('weakens only appearance and leaves outfit, state, action and negative weights intact', () => {
    const { state, char } = load('girl, 2::black hair::, 1.7::blue eyes::, 2::white shirt::, skirt, 2::topless::, nipples, 1.4::smile::', 'topless');
    char.uc = '2::bad hands::';
    char.halfWeight = true;
    const request = assembleOverrides(state, [stored]).characters[0];
    assert.match(request.prompt, /^0\.5::girl, black hair, blue eyes, nipples::,/);
    for (const tag of ['2::white shirt::', '2::topless::', '1.4::smile::']) assert.ok(request.prompt.includes(tag));
    assert.equal(request.uc,'2::bad hands::');
    char.halfWeight = false;
    assert.match(assembleOverrides(state,[stored]).characters[0].prompt,/2::black hair::, 1\.7::blue eyes::/);
  });

  it('restores image weight over the comic default and regenerates edited weights', () => {
    for (const weight of [0, 0.1, 0.2, 0.3, 0.4, 0.6, 0.7]) {
      const { state, char } = load(`${weight}::girl, black hair, blue eyes::, 2::white shirt::, skirt, 1.7::smile::`, 'clothed');
      assert.equal(char.appearanceWeight, weight);
      assert.equal(char.halfWeight, true);
      assert.ok(assembleOverrides(state, [stored]).characters[0].prompt.startsWith(`${weight}::girl, black hair, blue eyes::`));
      char.appearanceWeight = 0.4;
      const edited = assembleOverrides(state, [stored]).characters[0].prompt;
      assert.ok(edited.startsWith('0.4::girl, black hair, blue eyes::'));
      assert.match(edited, /2::white shirt::.*1\.7::smile::/);
      char.halfWeight = false;
      assert.match(assembleOverrides(state, [stored]).characters[0].prompt, /2::black hair::/);
    }
    const state = emptyState();
    hydrateFromNai({ state, nai: { characters: [{ id: stored.id, prompt: 'girl, black hair, blue eyes, smile' }] },
      settings: { card: { comic_closeup_character_weight: 0 } }, rosterPayload: { characters: [stored] }, card: {} });
    const char = Object.values(state.chars)[0];
    assert.equal(char.appearanceWeight, 0);
    assert.equal(char.halfWeight, false);
    char.halfWeight = true;
    assert.ok(assembleOverrides(state, [stored]).characters[0].prompt.startsWith('0::'));
  });

  it('does not replace the image clothing when its roster costume has since changed', () => {
    const { state, char } = load('0.5::girl, black hair, blue eyes, red dress, smile::', 'clothed');
    assert.equal(char.costumeTags, 'red dress');
    for (const half of [true, false]) {
      char.halfWeight = half;
      const prompt = assembleOverrides(state, [stored]).characters[0].prompt;
      assert.match(prompt, /red dress/);
      assert.doesNotMatch(prompt, /white shirt|skirt|hoodie|jeans/);
    }
    applyStudioWearState(char, stored, 'completely');
    const prompt = assembleOverrides(state, [stored]).characters[0].prompt;
    assert.match(prompt, /completely nude.*smile/);
    assert.doesNotMatch(prompt, /red dress|white shirt|skirt/);
  });

  it('opening a completely nude image and toggling weight never dresses it', () => {
    const { state, char } = load('0.5::girl, black hair, blue eyes, completely nude, nipples, pussy, smile::', 'completely');
    assert.equal(char.wearState, 'completely');
    for (const half of [true, false]) {
      char.halfWeight = half;
      assert.doesNotMatch(assembleOverrides(state, [stored]).characters[0].prompt, /white shirt|skirt|hoodie|jeans/);
    }
    applyStudioWearState(char, stored, 'clothed');
    const request = assembleOverrides(state, [stored]).characters[0];
    assert.match(request.prompt, /white shirt.*skirt/);
    assert.doesNotMatch(request.prompt, /completely nude|nipples|pussy/);
    assert.equal(request.wear_state, 'clothed');
  });

  it('ordinary image staging does not inject bare state words into the prompt', () => {
    for (const [stateValue, caption] of [
      ['clothed', 'girl, 2::black hair::, 1.7::blue eyes::, white shirt, skirt, smile'],
      ['topless', 'girl, 2::black hair::, 1.7::blue eyes::, white shirt, skirt, 2::topless::, nipples, smile'],
      ['completely', 'girl, 2::black hair::, 1.7::blue eyes::, 2::completely nude::, nipples, pussy, smile'],
    ]) {
      const { state, char } = load(caption, stateValue, 1);
      const prompt = assembleOverrides(state, [stored]).characters[0].prompt;
      assert.equal(char.costume, 'school', 'numeric costume picks use the same resolver as generation');
      assert.equal(char.halfWeight, false);
      assert.doesNotMatch(prompt, /(?:^|, )clothed(?:,|$)|(?:^|, )topless(?:,|$)|(?:^|, )completely(?:,|$)/);
      assert.deepEqual(prompt.split(', ').sort(), caption.split(', ').sort());
    }
  });

  it('state selection preserves an edited outfit and clears old exposure tags', () => {
    const { state, char } = load('girl, 2::black hair::, 1.7::blue eyes::, white shirt, skirt, 2::topless::, nipples, smile', 'topless');
    char.costumeTags = 'sweater'; char.costumeBottoms = 'shorts';
    applyStudioWearState(char, stored, 'bottomless');
    let prompt = assembleOverrides(state, [stored]).characters[0].prompt;
    assert.match(prompt, /sweater, 2::bottomless::, pussy, shorts/);
    assert.doesNotMatch(prompt, /topless|nipples|white shirt|skirt/);
    applyStudioWearState(char, stored, 'completely');
    prompt = assembleOverrides(state, [stored]).characters[0].prompt;
    assert.match(prompt, /completely nude/);
    assert.doesNotMatch(prompt, /sweater|shorts|bottomless/);
    assert.match(prompt, /smile/);
  });
});

it('picker looks resolve costume slots and retain weighted appearance without duplicate colors', () => {
  const stored = { gender: 'girl', appearance: 'girl, 2::black hair::, freckles', hair_color: 'black',
    hair_style: 'long hair', eye_color: 'blue', age: 24, height: '172cm', costumes: [
      { name: 'default', attire: 'hoodie', bottoms: 'jeans' },
      { name: 'alternate', appearance: '[base]', hair_style: 'ponytail', hair_color: 'red',
        eye_color: '[base]', age: '28', height: '165cm', attire: 'shirt', bottoms: 'skirt' },
    ] };
  assert.equal(studioCharacterLookTags(stored, 'default'),
    'girl, 2::black hair::, freckles, long hair, blue eyes, 172cm, tall, 24 years old');
  assert.equal(studioCharacterLookTags(stored, 'alternate'),
    'girl, 2::black hair::, freckles, red hair, ponytail, blue eyes, 165cm, 28 years old');
  assert.equal(studioCharacterLookTags({ appearance: 'freckles' }), 'freckles');
  assert.equal(studioCharacterLookTags(null), '');
});

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
  it('restores explicit AI/manual mode ahead of the imported image coordinates', () => {
    for (const [mode, x] of [['ai', 0.38], ['manual', 0.5]]) {
      const state = emptyState();
      hydrateFromNai({ state, nai: { characters: [{ prompt: 'girl', center_x: x, center_y: 0.5 }] },
        settings: { card: { studio_coord_mode: mode, studio_coords_visible: false } }, rosterPayload: {}, card: {} });
      assert.equal(state.coordMode, mode);
      assert.equal(state.coordVisible, false);
      const request = assembleOverrides(state, []);
      assert.equal(request.use_coords, mode === 'manual');
      assert.equal(request.characters[0].center_x, mode === 'manual' ? x : undefined);
    }
  });

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
