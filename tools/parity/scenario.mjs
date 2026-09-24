/**
 * The parity scenario: one deterministic pass over the whole public surface.
 *
 * Every step's result (or thrown error) is appended to a transcript. The legacy
 * backend and the 2.0 backend must produce the same normalised transcript.
 *
 * Add a step whenever a route or bridge method gains behaviour — this file is the
 * executable definition of "feature parity".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LLM_REPLY, PNG_1X1 } from './host.mjs';

// Fixed sync floor for both backends (the pre-user-defaults first-boot
// extract). Boot/reset packs are user content and differ from 1.x by design,
// so the scenario imports this floor before any behaviour step and asserts
// the real packs sharply via settings.boot_floor / settings.reset_factory_floor.
const RESET_FLOOR_JSON = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), './floor.json'),
  'utf8',
);
// The 1.x reader, used as an oracle for both targets so the assertion does not
// depend on the code under test.
import { parseStoreZip } from '../../reference/gallery-zip.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PNG_DATA_URL = `data:image/png;base64,${b64(PNG_1X1)}`;

/**
 * Unpacks an export response into something worth comparing.
 *
 * The raw base64 cannot be compared, not even by length: the manifest carries
 * wall-clock timestamps, and `created_at` is fractional seconds whose digit
 * count varies run to run, so the ZIP is a byte or two different every time.
 * Decoding it lets the comparer apply its normal rules to the fields inside,
 * which asserts the manifest's actual contents rather than a byte count.
 */
const describeExport = (res) => {
  if (!res || typeof res.zip_base64 !== 'string' || !res.zip_base64) {
    return { ok: res?.ok ?? null, count: res?.count ?? null, zip: null };
  }
  const entries = parseStoreZip(new Uint8Array(Buffer.from(res.zip_base64, 'base64')));
  const manifest = entries.has('manifest.json')
    ? JSON.parse(Buffer.from(entries.get('manifest.json')).toString('utf8'))
    : null;
  return {
    ok: res.ok ?? null,
    count: res.count ?? null,
    // Entry names, plus sizes for the images only — the manifest's own size is
    // timestamp-dependent, and its contents are compared directly below.
    names: [...entries.keys()].sort(),
    imageBytes: [...entries.keys()]
      .filter((n) => n !== 'manifest.json')
      .sort()
      .map((n) => entries.get(n).length),
    manifest,
  };
};

export async function runScenario(N, handles) {
  const transcript = [];
  let step = 0;

  /** Records the outcome of `fn` under `name`, capturing errors as data. */
  const rec = async (name, fn) => {
    step += 1;
    try {
      const value = await fn();
      transcript.push({ step, name, ok: true, value });
      return value;
    } catch (error) {
      transcript.push({
        step,
        name,
        ok: false,
        error: { message: String(error?.message ?? error), status: error?.status ?? null, data: error?.data ?? null },
      });
      return null;
    }
  };

  const get = (p) => N.fetch(p, { method: 'GET' });
  const post = (p, body) => N.fetch(p, { method: 'POST', body });
  const put = (p, body) => N.fetch(p, { method: 'PUT', body });

  const waitForJob = async (jobId) => {
    for (let i = 0; i < 200; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      const res = await get(`/v1/jobs/${jobId}`);
      if (res?.state === 'done' || res?.state === 'error' || res?.state === 'cancelled') return res;
    }
    return { state: 'timeout' };
  };

  // ── boot ────────────────────────────────────────────────────────────────
  await rec('ready', () => N.ready());
  const supportsComicNatural = typeof (await get('/v1/settings'))?.settings?.card?.comic_natural_supplement === 'boolean';
  // Shape, not value: a 2.0 is expected to report a different version than 1.3.
  // `tools/audit.mjs` asserts the exact string in the built bundle.
  await rec('bridge.VERSION', () => (/^\d+\.\d+\.\d+$/.test(String(N.VERSION)) ? 'semver' : `bad:${N.VERSION}`));
  await rec('storage.savefile_only', async () => {
    const h = await get('/v1/health');
    const body = h?.health && typeof h.health === 'object' ? h.health : h;
    return { storage: body?.storage, storage_api: body?.storage_api, storage_scope: body?.storage_scope };
  });

  // ── settings ────────────────────────────────────────────────────────────
  await rec('settings.initial', () => get('/v1/settings'));
  // Boot pack is user content (differs from the 1.x extract by design; see
  // compare). Sync both sides to the fixed floor before any behaviour step.
  await rec('settings.boot_floor', async () => {
    const card = (await get('/v1/settings'))?.settings?.card || {};
    return {
      image_min: card.image_min,
      image_max: card.image_max,
      execute: card.execute,
      lore_extra: card.lore_extra,
      asset_nai_tags: card.asset_nai_tags,
      active_preset_id: card.active_preset_id,
      presets: Array.isArray(card.presets) ? card.presets.length : -1,
    };
  });
  await post('/v1/settings/import', { json: RESET_FLOOR_JSON });
  await rec('settings.stream_contract', async () => {
    const initial = (await get('/v1/settings')).settings.card;
    if (!('omni_helper_prompt' in initial)) return {unsupported:true};
    if (initial.omni_helper_prompt !== false) throw new Error('Helper must start disabled');
    const enabled = (await put('/v1/settings', {card:{omni_helper_prompt:true,inline_chat_images:false,persist_chat_images:false,llm_anchor_percent:true}})).settings.card;
    if (enabled.omni_helper_prompt !== true || enabled.inline_chat_images !== true || enabled.persist_chat_images !== true || enabled.llm_anchor_percent !== false) throw new Error('Streaming settings invariants failed');
    await put('/v1/settings', {card:{omni_helper_prompt:false}});
    return {defaultOff:true,helperToggle:true,mandatoryOn:true,percentDisabled:true};
  });
  await rec('job.commit_output_unknown', async () => {
    const result = await post('/v1/jobs/commit-output', {job_id:'missing',stream_id:'missing'});
    if (result.ok !== false || result.error?.code !== 'not_pending') throw new Error('Unknown stream must not attach');
    return result;
  });
  await rec('settings.image_analysis_separate', async () => {
    const initial = (await get('/v1/settings')).settings.card.image_analysis_separate;
    await put('/v1/settings', {card:{image_analysis_separate:true}});
    const enabled = (await get('/v1/settings')).settings.card.image_analysis_separate;
    await put('/v1/settings', {card:{image_analysis_separate:false}});
    if (initial !== false || enabled !== true) throw new Error('image analysis separation roundtrip failed');
    return {initial, enabled};
  });
  // llm_configured reflects the boot pack, so these run post-sync.
  await rec('health', () => get('/v1/health'));
  await rec('healthz', () => get('/healthz'));
  await rec('readyz', () => get('/readyz'));
  await rec('settings.put', () => put('/v1/settings', {
    llm: {
      source: 'custom',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-test',
      api_key: 'sk-parity',
      temperature: 0.4,
      max_tokens: 2048,
      reasoning_effort: 'medium',
    },
    nai: {
      backend: 'nai',
      api_key: 'pst-parity',
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 23,
      cfg_scale: 5,
      sampler: 'k_euler_ancestral',
      apply_quality_tags: true,
    },
    card: { power: true, image_max: 1, image_min: 1, character_max: 4, execute: 'auto' },
  }));
  await rec('settings.after_put', () => get('/v1/settings'));
  // Legacy boolean still accepted; 2.0 migrates true→"short" (see compare natural_base).
  await rec('settings.update_alias', () => post('/v1/settings/update', { card: { natural_base: true } }));
  await rec('settings.natural_base_after_bool', async () => {
    const s = await get('/v1/settings');
    return { natural_base: s?.settings?.card?.natural_base };
  });
  await rec('settings.natural_base_set_detailed', () => post('/v1/settings/update', { card: { natural_base: 'detailed' } }));
  await rec('settings.natural_base_after_detailed', async () => {
    const s = await get('/v1/settings');
    return { natural_base: s?.settings?.card?.natural_base };
  });
  // Role-swap is an option bar now (off|memo|authority); legacy boolean true
  // still migrates to "authority" (compare drops this 2.0-only key vs 1.x).
  await rec('settings.reverse_bar_alias', () => post('/v1/settings/update', { card: { llm_reverse_bar: true } }));
  await rec('settings.reverse_bar_after_bool', async () => {
    const s = await get('/v1/settings');
    return { llm_reverse_bar: s?.settings?.card?.llm_reverse_bar };
  });
  await rec('settings.reverse_bar_set_memo', () => post('/v1/settings/update', { card: { llm_reverse_bar: 'memo' } }));
  await rec('settings.reverse_bar_after_memo', async () => {
    const s = await get('/v1/settings');
    return { llm_reverse_bar: s?.settings?.card?.llm_reverse_bar };
  });
  // Client Comments inputs (4.5.1 direction / focus): stored verbatim,
  // trimmed; the central block renders them in the module's template.
  await rec('settings.client_comments_set', () => post('/v1/settings/update', { card: { client_direction: '밤, 비', client_focus: '엘로디아' } }));
  await rec('settings.client_comments_after', async () => {
    const s = await get('/v1/settings');
    return {
      client_direction: s?.settings?.card?.client_direction,
      client_focus: s?.settings?.card?.client_focus,
    };
  });
  await rec('settings.client_comments_clear', () => post('/v1/settings/update', { card: { client_direction: '', client_focus: '' } }));
  await rec('settings.reverse_bar_restore_off', () => post('/v1/settings/update', { card: { llm_reverse_bar: 'off' } }));
  // Old viewer minimize modes died with the viewer: stored icon keeps its
  // parked spot as bubble, toolbar/actions collapse to buttons. The final
  // restore leaves buttons stored so later steps compare clean.
  await rec('settings.minimize_migrate_icon', async () => {
    const s = await post('/v1/settings/update', { card: { viewer_minimize_mode: 'icon' } });
    return { viewer_minimize_mode: s?.settings?.card?.viewer_minimize_mode };
  });
  await rec('settings.minimize_migrate_toolbar', async () => {
    const s = await post('/v1/settings/update', { card: { viewer_minimize_mode: 'toolbar' } });
    return { viewer_minimize_mode: s?.settings?.card?.viewer_minimize_mode };
  });
  await rec('settings.minimize_restore_buttons', async () => {
    const s = await post('/v1/settings/update', { card: { viewer_minimize_mode: 'buttons' } });
    return { viewer_minimize_mode: s?.settings?.card?.viewer_minimize_mode };
  });
  // 2.0-only card flags (compare drops them vs 1.x). Prove defaults stay off.
  await rec('settings.card_flags_2x', async () => {
    const s = await get('/v1/settings');
    const card = s?.settings?.card ?? {};
    return {
      inline_chat_images: card.inline_chat_images === true,
      persist_chat_images: card.persist_chat_images === true,
      persist_chat_images_folded: card.persist_chat_images_folded === true,
      inline_msg_actions: card.inline_msg_actions === true,
      inline_chat_dom_radius: Number(card.inline_chat_dom_radius ?? 4),
      progress_toast: card.progress_toast === true,
      image_done_sound: card.image_done_sound === true,
      viewer_minimize_mode: String(card.viewer_minimize_mode || 'buttons'),
      llm_json_retry: card.llm_json_retry === true,
      llm_reverse_bar: String(card.llm_reverse_bar || 'off'),
      client_direction: String(card.client_direction || ''),
      client_focus: String(card.client_focus || ''),
      llm_tag_cal: card.llm_tag_cal === true,
      nai5_first: card.nai5_first === true,
      nai5_only: card.nai5_only === true,
      nai4_fallback: card.nai4_fallback === true,
      nai5_speech: card.nai5_speech === true,
      studio_seed_lock: card.studio_seed_lock === true,
      studio_folds: card.studio_folds && typeof card.studio_folds === 'object' ? card.studio_folds : {},
      nai_use_coords: card.nai_use_coords !== false,
      v5_natural_lang: card.v5_natural_lang === 'ja' ? 'ja' : 'en',
      secondary_preset_id: String(card.secondary_preset_id || ''),
      comic_gen: card.comic_gen === 'on',
      comic_llm_batch: String(card.comic_llm_batch || 'once'),
      comic_schedule: String(card.comic_schedule || 'overlap'),
      comic_max_pages: Number(card.comic_max_pages ?? 2),
      comic_gen_ratio: Number(card.comic_gen_ratio ?? 50),
      comic_coords: String(card.comic_coords || 'llm'),
      comic_aspect: String(card.comic_aspect || 'llm'),
    };
  });
  // 2.4.7: leftover human_focus is forced to none (1.x kept human_focus).
  await rec('settings.uc_preset_none', async () => {
    const s = await get('/v1/settings');
    return { none: s?.settings?.nai?.uc_preset === 'none' };
  });
  await rec('settings.export', () => get('/v1/settings/export'));
  await rec('settings.registered_keys', async () => {
    const before = await get('/v1/settings');
    if (!('api_keys_v4_configured' in (before?.settings?.nai || {}))) return {unsupported:true};
    await put('/v1/settings', {nai:{api_keys_v4:['parity-v4'],api_keys_v5:['parity-v5']}});
    const cleared = await put('/v1/settings', {nai:{api_keys_v5:[],clearApiKeysV5:true}});
    const keys = cleared?.settings?.nai || {};
    await put('/v1/settings', {nai:{api_keys_v4:[],clearApiKeysV4:true}});
    return { ownCleared: keys.api_keys_v5_configured === 0, otherKept: keys.api_keys_v4_configured === 1 };
  });

  // ── prompts ─────────────────────────────────────────────────────────────
  const promptList = await rec('prompts.list', async () => {
    const result = await get('/v1/prompts');
    const retired = ['char_looks', 'autotag', 'asset_tags_inject'];
    // This new editable prompt has no legacy counterpart. Assert its actual
    // contract before comparing the shared prompt catalog.
    if (N.VERSION !== '1.3.0') {
      if (result.prompts.some(p => retired.includes(p.key))) throw new Error('retired prompt still editable');
      if (!result.prompts.some(p => p.key === 'asset_author_note')) throw new Error('asset author note editor missing');
      if (!result.prompts.some(p => p.key === 'tagger') || !result.prompts.some(p => p.key === 'format')) throw new Error('active prompt missing');
      const common = result.prompts.find(p => p.key === 'character_common');
      if (!common || !common.text.includes('hair_style') || !common.text.includes('eye_color')) throw new Error('missing shared character prompt');
      await put('/v1/prompts/character_common', {text:'PARITY SHARED CHARACTER RULES'});
      if ((await get('/v1/prompts/character_common')).text !== 'PARITY SHARED CHARACTER RULES') throw new Error('common prompt edit lost');
      await post('/v1/prompts/character_common/reset', {});
    }
    // The active catalog intentionally drops retired editors; their absence on
    // the new side is asserted above before comparing the remaining catalog.
    return {...result, prompts: result.prompts.filter(p => p.key !== 'character_common' && !retired.includes(p.key))};
  });
  await rec('prompts.get_tagger', () => get('/v1/prompts/tagger'));
  await rec('prompts.put_tagger', () => put('/v1/prompts/tagger', { text: 'PARITY TAGGER OVERRIDE' }));
  await rec('prompts.get_tagger_after_put', () => get('/v1/prompts/tagger'));
  await rec('prompts.reset_tagger', () => post('/v1/prompts/tagger/reset', {}));
  await rec('prompts.get_tagger_after_reset', () => get('/v1/prompts/tagger'));
  await rec('prompts.keys', () =>
    (promptList?.prompts ?? [])
      .map((p) => p.key)
      .filter((k) => k !== 'command_reroll' && k !== 'command_char_edit' && k !== 'lorefilter_scan'),
  );
  await rec('lorefilter.get_empty', () => get('/v1/characters/lorefilter?character_id=char_parity'));
  await rec('lorefilter.set', () => post('/v1/characters/lorefilter', {
    character_id: 'char_parity',
    selected: ['t:alice'],
  }));
  await rec('lorefilter.get_after_set', () => get('/v1/characters/lorefilter?character_id=char_parity'));
  await rec('lorefilter.empty_is_initialized', async () => {
    await post('/v1/characters/lorefilter', { character_id: 'char_parity', selected: [] });
    const result = await get('/v1/characters/lorefilter?character_id=char_parity');
    await post('/v1/characters/lorefilter', { character_id: 'char_parity', selected: ['t:alice'] });
    return result;
  });
  await rec('chars.import_picker_persona', () => get('/v1/characters/import-picker?kind=persona'));
  await rec('chars.import_fill_empty', () => post('/v1/characters/import-fill', { picks: [] }));

  // ── characters: shared surname must not merge ───────────────────────────
  await rec('chars.create_shared_surname', () => post('/v1/characters', {
    session_id: 'sess_identity',
    characters: [
      // Explicit UI fields: save matching no longer fills spelling fields via a folded display view.
      { id: 'jinwoo', name: 'HAN JINWOO', surname: 'HAN', given_name: 'JINWOO', surname_variants: ['HAN'], given_name_variants: ['JINWOO'], aliases: ['HAN', 'JINWOO', 'HAN JINWOO'], appearance: 'boy, black hair', attire: 'suit' },
      { id: 'mina', name: 'HAN MINA', surname: 'HAN', given_name: 'MINA', surname_variants: ['HAN'], given_name_variants: ['MINA'], aliases: ['HAN', 'MINA', 'HAN MINA'], appearance: 'girl, brown hair', attire: 'dress' },
    ],
  }));
  await rec('chars.get_identity', () => get('/v1/characters?session_id=sess_identity'));
  await rec('chars.unify', () => post('/v1/characters/unify', {
    target_session_id: 'sess_identity', source_session_ids: [], include_target: true,
  }));
  await rec('chars.get_after_unify', () => get('/v1/characters?session_id=sess_identity'));

  // ── characters: global scope + toggles ─────────────────────────────────
  await rec('chars.create_global', () => post('/v1/characters', {
    session_id: 'sess_identity',
    scope: '__global__',
    character: { id: 'g-aria', name: '아리아', aliases: ['아리아', 'Aria'], appearance: '1girl, blonde hair', attire: 'armor' },
  }));
  await rec('chars.global_toggles_set', () => post('/v1/characters/global-toggles', {
    character_id: 'char_parity', disabled_globals: ['아리아'],
  }));
  await rec('chars.get_with_char_id', () => get('/v1/characters?session_id=sess_identity&character_id=char_parity'));
  await rec('chars.global_toggles_clear', () => post('/v1/characters/global-toggles', {
    character_id: 'char_parity', disabled_globals: [],
  }));
  await rec('chars.triggered', () => post('/v1/characters/triggered', {
    message: '카페에서 아리아가 HAN JINWOO를 불렀다',
    session_id: 'sess_identity',
    character_id: 'char_parity',
    source_session_ids: [],
  }));
  await rec('chat.restore_chrome', () => post('/v1/chat/restore-chrome', {}));

  // ── unified roster patching across root chats ─────────────────────────
  for (const [sessionId, id, appearance] of [
    ['sess_chat_a', 'chat-a-nim', 'old chat A marker'],
    ['sess_chat_b', 'chat-b-nim', 'old chat B marker'],
  ]) {
    await rec(`chars.seed_${sessionId}`, async () => {
      const saved = await post('/v1/characters', {
        session_id: sessionId,
        characters: [{ id, name: '니메리엘', aliases: ['니메리엘', 'Nimeriel'], appearance, attire: 'white dress' }],
      });
      const char = (saved?.characters || []).find((c) => c.name === '니메리엘') || saved?.characters?.[0];
      // 2.0: "hat" must not match inside "chat" — marker stays appearance, dress stays attire.
      return {
        ...saved,
        wear_ok:
          String(char?.appearance || '').includes(appearance)
          && String(char?.attire || '').includes('white dress')
          && !String(char?.attire || '').includes('marker'),
      };
    });
  }
  await rec('chars.unified_patch', () => post('/v1/characters', {
    session_id: 'sess_unified',
    root_session_ids: ['sess_chat_a', 'sess_chat_b'],
    characters: [{
      id: 'chat-a-nim', name: '니메리엘', aliases: ['니메리엘', 'Nimeriel'],
      appearance: '1girl, vivid violet eyes, long silver hair', attire: 'blue dress',
      scope: 'sess_chat_a',
    }],
  }));
  await rec('chars.chat_a_after_patch', () => get('/v1/characters?session_id=sess_chat_a'));
  await rec('chars.chat_b_after_patch', () => get('/v1/characters?session_id=sess_chat_b'));

  // A chat that never had her must NOT gain her.
  await rec('chars.seed_chat_c', () => post('/v1/characters', {
    session_id: 'sess_chat_c',
    characters: [{ id: 'chat-c-other', name: '다른캐릭', aliases: ['다른캐릭'], appearance: '1girl, brown hair', attire: 'coat' }],
  }));
  await rec('chars.unified_patch_single', () => post('/v1/characters', {
    session_id: 'sess_unified',
    root_session_ids: ['sess_chat_a', 'sess_chat_b', 'sess_chat_c'],
    character: {
      id: 'chat-a-nim', name: '니메리엘', aliases: ['니메리엘', 'Nimeriel'],
      appearance: '1girl, vivid violet eyes, long silver hair', attire: 'blue dress',
      scope: 'sess_chat_a',
    },
  }));
  await rec('chars.chat_c_untouched', () => get('/v1/characters?session_id=sess_chat_c'));
  await rec('roster.bot_lore_contract', async () => {
    const db=await globalThis.risuai.getDatabase();
    const a=db.characters.find(c=>c.chaId==='sess_chat_a');
    const b=db.characters.find(c=>c.chaId==='sess_chat_b');
    const entry=c=>c.globalLore.find(l=>l.comment==='omni.nexus.data.global');
    const ae=entry(a),be=entry(b);
    return {stored:!!ae&&!!be,disabled:ae?.key===''&&ae?.alwaysActive===false,
      isolated:ae&&be ? JSON.parse(ae.content).roster[0].appearance==='old chat A marker' && JSON.parse(be.content).roster[0].appearance==='old chat B marker' : false};
  });

  // ── legacy appearance API ──────────────────────────────────────────────
  await rec('appearance.get', () => get('/v1/appearance/sess_chat_a'));
  await rec('appearance.post', () => post('/v1/appearance/sess_appear', {
    appearance: { '테스트': '1girl, red hair' },
  }));
  await rec('appearance.get_after_post', () => get('/v1/appearance/sess_appear'));

  // ── job pipeline (tag → generate → cards) ─────────────────────────────
  // Cast ids persist on the roster row: the job character must exist before
  // generate, or ensureCastIds issues an id it cannot store and resolve goes blind.
  // Setup, not an assertion (2.0 folds global into session by design).
  await post('/v1/characters', {
    session_id: 'sess_main',
    characters: [{ id: 'char_main', name: '패리티봇', aliases: ['패리티봇'], appearance: 'blacksmith', attire: 'apron' }],
  });
  const generationGate = handles.pauseGeneration();
  const job = await rec('job.create', () => post('/v1/jobs/create', {
    session_id: 'sess_main',
    character_id: 'char_main',
    character_name: '패리티봇',
    chat_id: 'chat_main',
    chat_name: '패리티 채팅',
    assistant_text: '태양이 망치를 들었다. 불꽃이 튀었다.',
    message_index: 1,
    message_role: 'char',
    content_hash: 'hash_main',
    char_index: 0,
    chat_index: 0,
    recent_messages: [{ role: 'user', content: '무엇을 하고 있어?' }],
    lorebook: [
      { comment: '작업장', content: '오래된 대장간이다.', key: '망치', always: false },
    ],
    lore_trigger_keys: ['망치'],
    character_description: '대장장이 캐릭터',
    persona_description: '방문자',
  }));
  // Hold generation so both backends check the duplicate while it is busy.
  await generationGate.started;
  const busyDup = await rec('job.busy_duplicate', () => post('/v1/jobs/create', {
    character_id: 'char_main', chat_id: 'chat_main',
    session_id: 'sess_main', content_hash: 'hash_main', message_index: 1, assistant_text: '태양이 망치를 들었다.',
  }));
  generationGate.release();
  const jobResult = await rec('job.wait', () => waitForJob(job?.job_id));
  await rec('job.line_placement_contract', () => {
    const cards = jobResult?.result?.cards;
    if (!cards?.length || cards.some(c=>c.y_percent !== null || c.line !== 1)) throw new Error('Generated shots must use L1 and no percent');
    return {line:1,percent:null,count:cards.length};
  });
  await rec('job.card_count', () => (jobResult?.result?.cards ?? []).length);
  // 2.0: default person_tag_weight=3 wraps cast count as N::1boy:: (1.x was plain).
  await rec('job.person_tag_emphasis', () => {
    const main = String(jobResult?.result?.cards?.[0]?.main_prompt || '');
    return {
      emphasized: /^3::1boy::/.test(main) || /^3::1girl/.test(main),
      prefix: main.slice(0, 24),
    };
  });
  await rec('job.uc_preset_none', () => {
    const neg = String(jobResult?.result?.cards?.[0]?.negative_prompt || '');
    return {
      clean: !/(?:^|,)\s*(?:@_@|mismatched pupils|glowing eyes)\s*(?:,|$)/i.test(neg),
    };
  });




  // ── gallery ───────────────────────────────────────────────────────────
  const gallery = await rec('gallery.list', () => get('/v1/gallery?session_id=sess_main&limit=40'));
  await rec('jobs.write_unified_session', () => ({
    job: /^risu_[0-9a-f]{16}$/.test(String(job?.session_id || '')),
    listed: (gallery?.items ?? []).length > 0,
  }));
  await rec('gallery.card_aspect', () => {
    const aspects = (gallery?.items || []).map((row) => String(row?.aspect || ''));
    return {
      first: aspects[0] || '',
      all_canvas: aspects.every((a) => a === 'portrait' || a === 'square' || a === 'landscape'),
    };
  });
  const cardId = gallery?.items?.[0]?.id;
  // Rows carry no display URL at all; the UI asks `resolveImageUrl` at paint
  // time. The key being absent (not merely empty) is the assertion — an empty
  // string is what a row someone started re-attaching to looks like on a miss.
  await rec('gallery.rows_carry_no_display_url', () => ({
    rows: gallery?.items?.length ?? 0,
    keyed: (gallery?.items || []).filter((r) => r && 'image_url' in r).length,
  }));
  await rec('gallery.display_url_scheme', () => {
    const u = String(N.resolveImageUrl?.(cardId) ?? '');
    if (/^blob:/i.test(u)) return 'blob';
    if (/^data:image\//i.test(u)) return 'data';
    return 'other';
  });
  // 2.0 asks for a newest-first window and names the hashes it is about to
  // paint, so an old shot still attaches without listing the whole session.
  await rec('gallery.window_reports_total', () => {
    const all = gallery?.items?.length ?? -1;
    return { total: gallery?.total, matches_items: gallery?.total === all, window_oldest_at: gallery?.window_oldest_at };
  });
  await rec('gallery.window_excludes_beyond_limit', async () => {
    const limit = 1;
    const win = await get(`/v1/gallery?session_id=sess_main&limit=${limit}`);
    const total = Number(win?.total);
    const items = win?.items?.length ?? -1;
    return {
      items,
      total,
      // The window returns min(limit, total), and reports an edge only when it
      // stopped short of the session — that edge is what a merge prunes against.
      window_capped: items === Math.min(limit, total),
      edge_only_when_short: (typeof win?.window_oldest_at === 'number') === (total > limit),
    };
  });
  await rec('gallery.hash_outside_window_still_ships', async () => {
    // limit=0: nothing from the window, only what the hash asks for.
    const byHash = await get('/v1/gallery?session_id=sess_main&limit=0&hashes=hash_main');
    const other = await get('/v1/gallery?session_id=sess_main&limit=0&hashes=no_such_hash');
    return {
      hashed_rows: byHash?.items?.length ?? -1,
      all_match: (byHash?.items || []).every((r) => r.content_hash === 'hash_main'),
      unknown_hash_rows: other?.items?.length ?? -1,
    };
  });
  const explore = await rec('gallery.explore', () => get('/v1/gallery/explore?limit=200'));
  await rec('gallery.explore_rows_carry_no_display_url', () => ({
    rows: explore?.items?.length ?? 0,
    keyed: (explore?.items || []).filter((r) => r && 'image_url' in r).length,
  }));
  await rec('gallery.favorites_empty', () => get('/v1/gallery/favorites'));
  await rec('gallery.favorites_set', () => post('/v1/gallery/favorites', { ids: cardId ? [cardId] : [] }));
  await rec('gallery.favorites_after_set', () => get('/v1/gallery/favorites'));

  // ── bridge image helpers ──────────────────────────────────────────────
  await rec('bridge.resolveImageUrl', () => String(N.resolveImageUrl?.(gallery?.items?.[0]) ?? '').slice(0, 22));
  await rec('bridge.ensureImageUrl', async () => String((await N.ensureImageUrl?.(cardId)) ?? '').slice(0, 22));
  await rec('bridge.warmImages', () => N.warmImages?.(cardId ? [cardId] : []).then(() => 'ok'));
  const imageJson = await rec('images.json', () => get(`/v1/images/${cardId}.json`));

  // 2.0-only: fullscreen chips resolve the filename `.c` cast segment to names
  // (1.x 404 → NEW_ONLY_STEPS). Source the ids off a real generated asset so
  // the step proves the full chain: issuance → location → filename → resolve.
  await rec('shots.resolve_cast', async () => {
    const ids = Array.isArray(imageJson?.cast_ids) ? imageJson.cast_ids.map(String) : [];
    // Route returns a flat {id:name} map.
    const names = ids.length ? await post('/v1/shots/resolve-cast', { ids }) : {};
    const unknown = await post('/v1/shots/resolve-cast', { ids: ['zzzz'] });
    const detail = await post('/v1/shots/resolve-cast', { ids, details: true });
    return {
      count: ids.length,
      identities: detail?.characters || [],
      resolved: ids.map((id) => names?.[id] || ''),
      unknown_keys: Object.keys(unknown || {}),
    };
  });

  // 2.0-only: card id → cast ids from the character asset name (1.x 404).
  // The rendered chat img src is Risu's own filename, so this route (not
  // the DOM) is the fullscreen chip source.
  const castRec = await rec('shots.cast', async () => {
    const got = cardId ? await get(`/v1/shots/cast?card_id=${encodeURIComponent(cardId)}`) : {};
    return {
      ids: Array.isArray(got?.ids) ? got.ids.map(String) : [],
      name: typeof got?.name === 'string' ? got.name : '',
    };
  });

  // 2.0-only: the ⛶ handler design — chat div's data-inray-asset file name →
  // base64 pixels + resolved cast names in one round trip (1.x 404).
  await rec('shots.asset', async () => {
    const got = castRec?.name
      ? await get(`/v1/shots/asset?name=${encodeURIComponent(castRec.name)}`)
      : {};
    const names = got?.names && typeof got.names === 'object' ? got.names : {};
    const pixels = castRec?.name ? await get(`/v1/shots/asset?cast=0&name=${encodeURIComponent(castRec.name)}`) : {};
    const blob = castRec?.name ? await get(`/v1/shots/asset?cast=0&display=blob&name=${encodeURIComponent(castRec.name)}`) : {};
    let blobPixels = false;
    if (blob?.image_url?.startsWith('blob:')) {
      try {
        const bytes = new Uint8Array(await (await fetch(blob.image_url)).arrayBuffer());
        const expected = new Uint8Array(await (await fetch(pixels.image_url)).arrayBuffer());
        blobPixels = bytes.length > 0 && bytes.length === blob.image_bytes && bytes.length === expected.length && bytes.every((value, i) => value === expected[i]);
      } finally { URL.revokeObjectURL(blob.image_url); }
      if (!blobPixels) throw new Error('Blob fullscreen must preserve every original image byte');
    }
    return {
      blob_pixels: blobPixels,
      has_image: typeof got?.image_url === 'string' && got.image_url.startsWith('data:'),
      names: Object.keys(names).length,
      pixels_only: pixels?.image_url === got?.image_url && Object.keys(pixels?.names || {}).length === 0,
      ordered_ids: JSON.stringify(pixels?.ids) === JSON.stringify(castRec?.ids),
    };
  });

  // ── card editing + reroll ─────────────────────────────────────────────
  // Finish the overlapping job before reroll so 1.x/2.0 do not race on busy locks
  // (2.0 finishes the duplicate faster; without this wait, cards.reroll is busy on 1.x only).
  await rec('job.wait_busy_duplicate', () => waitForJob(busyDup?.job_id));
  await rec('jobs.unified_no_duplicate_card', async () => {
    const g = await get('/v1/gallery?session_id=sess_main&limit=40');
    return { count: (g?.items ?? []).length };
  });
  // 2.0-only soft-stop route (1.x 404 → NEW_ONLY_STEPS). Idle session → stopped:0.
  await rec('job.stop_idle', () => post('/v1/jobs/stop', { session_id: 'sess_stop_idle' }));


  await rec('cards.nai_prompt', async () => {
    const recipe=await get(`/v1/cards/${cardId}/nai-prompt`);
    const sent=handles.naiRequests.filter(r=>r.kind==='generate').map(r=>r.body);
    return {...recipe,matches_generated_input:sent.some(body=>body.input===recipe.main_prompt && body.parameters?.width===recipe.width && body.parameters?.height===recipe.height)};
  });
  await rec('asset_only.contract',()=>({
    no_fabricated_message:imageJson?.message_index===-1 && imageJson?.content_hash==='',
    gallery_bytes_positive:Number(gallery?.items?.[0]?.png_bytes)>0,
    explorer_metadata_deferred:explore?.items?.find(row=>row.id===cardId)?.png_bytes===0,
  }));
  await rec('cards.nai_from_image_empty', () => post('/v1/cards/nai-from-image', {}));
  await rec('cards.tags', () => post(`/v1/cards/${cardId}/tags`, {
    main_prompt: 'PARITY EDITED PROMPT',
    negative_prompt: 'parity negative',
    characters: [{ name: '태양', prompt: 'boy, black hair', action: 'standing' }],
  }));
  // 2.0-only: shot-tag command rewrite fills fields (look-lock keeps caption).
  handles.setLlmReply?.(JSON.stringify({
    setup: 'CMD SETUP TAGS',
    negative_prompt: 'cmd neg',
    characters: [{ index: 0, name: '태양', prompt: 'CHANGED LOOK', action: 'waving', uc: '' }],
  }));
  await rec('cards.command_rewrite', async () => {
    const res = await post(`/v1/cards/${cardId}/command-rewrite`, {
      instruction: 'make happier',
      look_locked: [true],
      main_prompt: 'PARITY EDITED PROMPT',
      negative_prompt: 'parity negative',
      characters: [{ name: '태양', prompt: 'boy, black hair', action: 'standing' }],
    });
    return {
      ok: res?.ok ?? null,
      look_kept: String(res?.characters?.[0]?.prompt || '').includes('black hair'),
      action: String(res?.characters?.[0]?.action || ''),
      has_setup: String(res?.main_prompt || '').includes('CMD SETUP')
        || String(res?.main_prompt || '').length > 0,
    };
  });
  // Restore default tagger JSON so later jobs are unaffected.
  handles.setLlmReply?.(DEFAULT_LLM_REPLY);

  // 2.0-only session author's note + character command rewrite.
  await rec('session_note.put', () => put('/v1/session-author-note', {
    session_id: 'risu_937274804192db48',
    text: 'parity session note',
  }));
  await rec('session_note.get', () => get('/v1/session-author-note?session_id=risu_937274804192db48'));
  await rec('session_note.split_put', () => put('/v1/session-author-note', {
    session_id: 'risu_937274804192db48',
    prefix: 'pre-note',
    suffix: 'post-note',
  }));
  await rec('session_note.split_get', () => get('/v1/session-author-note?session_id=risu_937274804192db48'));
  await rec('session_note.location_put', () => put('/v1/session-author-note', {
    session_id: 'risu_937274804192db48',
    prefix: 'pre-note',
    suffix: 'post-note',
    location: 'tatami, indoor',
  }));
  await rec('session_note.location_get', () => get('/v1/session-author-note?session_id=risu_937274804192db48'));
  // 2.0-only session wear map (id-keyed outfits). 1.x drops the unknown key.
  // Cleared right after so later prompt steps stay comparable.
  await rec('session_note.wear_put', () => put('/v1/session-author-note', {
    session_id: 'risu_937274804192db48',
    wear: { char_a: { name: 'A', wear: 'nude' }, bogus: { name: 'B', wear: 'flying' } },
  }));
  await rec('session_note.wear_get', () => get('/v1/session-author-note?session_id=risu_937274804192db48'));
  await rec('session_note.wear_clear', () => put('/v1/session-author-note', {
    session_id: 'risu_937274804192db48',
    wear: {},
  }));
  await rec('char_example.get', () => get('/v1/characters/example-shot?character_id=char_parity&scope=sess_main'));
  await rec('char_cmd_presets.put', () => put('/v1/character-command-presets', {
    items: [{ id: 'p1', name: '더 밝게', text: 'add smile' }],
  }));
  await rec('char_cmd_presets.get', () => get('/v1/character-command-presets'));
  handles.setLlmReply?.(JSON.stringify({
    appearance: { add: ['mole'], remove: [] },
    new_costumes: [{ name: 'swimsuit', attire: { add: ['bikini'] } }],
  }));
  await rec('chars.command_rewrite', async () => {
    const res = await post('/v1/characters/char_parity/command-rewrite', {
      instruction: 'add smile',
      character: {
        id: 'char_parity',
        name: '아리아',
        appearance: 'girl, black hair',
        costumes: [{ name: 'default', note: '', attire: 'dress', accessories: '' }],
      },
    });
    return {
      ok: res?.ok ?? null,
      mole: String(res?.character?.appearance || '').includes('mole'),
      costumes: Array.isArray(res?.character?.costumes) ? res.character.costumes.length : 0,
    };
  });
  handles.setLlmReply?.(DEFAULT_LLM_REPLY);
  await rec('cards.gallery_after_tags', () => get('/v1/gallery?session_id=sess_main&limit=40'));
  // 2.0-only: studio commit writes tags (and optional canvas bytes) on the same card id.
  await rec('cards.studio_commit', () => post(`/v1/cards/${cardId}/studio-commit`, {
    main_prompt: 'STUDIO COMMIT',
    negative_prompt: 'studio neg',
    characters: [{ name: '태양', prompt: 'boy, black hair', action: 'sitting' }],
  }));
  const reroll = await rec('cards.reroll', () => post(`/v1/cards/${cardId}/reroll`, { mode: 'nai' }));
  const rerolledId = reroll?.card?.id;
  // 2.0-only: studio commit with canvas bytes publishes under a NEW card id at
  // the same place (1.x overwrote the same id → NEW_ONLY_STEPS). Run it on the
  // rerolled card so the tags-only commit above keeps comparing the legacy path.
  await rec('cards.studio_commit_bytes', () => post(`/v1/cards/${rerolledId}/studio-commit`, {
    main_prompt: 'STUDIO BYTES',
    negative_prompt: 'studio bytes neg',
    characters: [{ name: '태양', prompt: 'boy, black hair' }],
    image_data_url: PNG_DATA_URL,
  }).then((res) => ({
    replaced: res?.replaced ?? null,
    id: res?.card?.id ?? null,
    image_url_len: String(res?.card?.image_url ?? '').length,
    message_index: res?.card?.message_index ?? null,
  })));
  await rec('cards.reroll_with_overrides', () => post(`/v1/cards/${rerolledId}/reroll`, {
    mode: 'nai',
    overrides: { main_prompt: '', negative_prompt: '', characters: [] },
  }));
  await rec('messages.reroll', () => post('/v1/messages/reroll', {
    session_id: 'sess_main', content_hash: 'hash_main', message_index: 1,
  }));

  // ── hash rebind + unlink ──────────────────────────────────────────────
  const galleryForRebind = await rec('gallery.before_rebind', () => get('/v1/gallery?session_id=sess_main&limit=40'));
  await rec('gallery.rebind_hash', () => post('/v1/gallery/rebind-hash', {
    session_id: 'sess_main',
    card_ids: (galleryForRebind?.items ?? []).map((i) => i.id),
    to_hash: 'hash_main_v2',
    assistant_preview: '태양이 망치를 들었다.',
  }));
  await rec('gallery.after_rebind', () => get('/v1/gallery?session_id=sess_main&limit=40'));
  await rec('gallery.unlink', () => post('/v1/gallery/unlink', {
    session_id: 'sess_main', content_hash: 'hash_main_v2', message_index: 1,
  }));
  await rec('gallery.after_unlink', () => get('/v1/gallery?session_id=sess_main&limit=40'));

  // ── zip export / import round trip ────────────────────────────────────
  const exported = await post('/v1/gallery/export', { all: true });
  await rec('gallery.export', () => describeExport(exported));
  await rec('gallery.export_shape', () => ({
    ok: exported?.ok ?? null,
    count: exported?.count ?? null,
    hasZip: typeof exported?.zip_base64 === 'string' && exported.zip_base64.length > 0,
    filename: typeof exported?.filename === 'string' ? exported.filename.replace(/\d{10,}/, '<TS>') : null,
  }));
  await rec('gallery.import', () => post('/v1/gallery/import', {
    zip_base64: exported?.zip_base64 ?? '', prefer_new_ids: true,
  }));
  await rec('gallery.explore_after_import', () => get('/v1/gallery/explore?limit=200'));

  // ── reference image + vibe transfer ───────────────────────────────────
  await rec('nai.reference_status_empty', () => get('/v1/nai/reference'));
  await rec('nai.reference_set', () => post('/v1/nai/reference', { image_b64: PNG_DATA_URL }));
  await rec('nai.reference_status', () => get('/v1/nai/reference'));
  await rec('bridge.refPreviewUrl', () => String(N.refPreviewUrl?.() ?? '').slice(0, 22));
  await rec('nai.vibe_set', () => post('/v1/nai/vibe', {
    image_b64: PNG_DATA_URL, information_extracted: 1, strength: 0.6,
  }));
  await rec('nai.vibe_status', () => get('/v1/nai/vibe'));
  await rec('bridge.vibePreviewUrl', () => String(N.vibePreviewUrl?.() ?? '').slice(0, 22));
  await rec('nai.vibe_clear', () => post('/v1/nai/vibe/clear', {}));
  await rec('nai.vibe_after_clear', () => get('/v1/nai/vibe'));
  await rec('nai.reference_clear', () => post('/v1/nai/reference/clear', {}));
  await rec('nai.reference_after_clear', () => get('/v1/nai/reference'));

  // ── connectivity tests + autotag ──────────────────────────────────────
  await rec('models.test', () => post('/v1/models/test', {}));
  await rec('models.test_with_override', () => post('/v1/models/test', {
    llm: { source: 'custom', provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-test', api_key: 'sk-parity' },
  }));
  await rec('nai.test', () => post('/v1/nai/test', {}));
  await rec('nai.quota', () => get('/v1/nai/quota'));
  await rec('nai.probe', () => post('/v1/nai/probe', {}));
  await rec('autotag', () => post('/v1/autotag', { image_b64: PNG_DATA_URL, threshold: 0.2 }));

  // ── stored-source tagger: L-numbers, context and spinner slots share one
  // stored original (P1+P2+P3) ────────────────────────────────────────────
  // Context tokens are stripped, the current message is excluded by
  // construction, the tagger reads the stored message, and spinner slots map
  // back to raw lines. New slots atomically replace old image/spinner marks,
  // including automatic generation (force is omitted below). 1.x numbers the request text and keeps
  // tokens/duplicates, so `job.stored_source_tagger_input` /
  // `job.stored_source_chat` are INTENTIONAL_DIFF steps with sharp new-side
  // checks in compare.mjs. Cards are deleted at the end so later absolute
  // folder/item assertions never see this session.
  const STORED_BODY = [
    '[[@inrayspinner::old-job_0::832::1216]][[@inray::old-card::inxshot_old-card.webp::832::1216]][[@inrayspinner::abandoned_1::832::1216]]',
    '맹약도 과분했다.',
    '태양은 자비를 두지 않았다.',
    '망치가 불꽃을 튀겼다.',
  ].join('\n');
  await rec('job.stored_source_character', () => post('/v1/characters', {
    session_id: 'sess_stored',
    characters: [{ id: 'char_stored', name: '보관봇', aliases: ['보관봇'], appearance: '1girl, brown hair', attire: 'coat' }],
  }));
  const storedIdx = await rec('job.stored_source_seed', async () => {
    const db = await globalThis.risuai.getDatabase();
    const ci = db.characters.findIndex((c) => c.chaId === 'char_stored');
    const chat = { id: 'chat_stored', message: [{ role: 'user', data: '이전에 뭐했어?' }, { role: 'char', data: STORED_BODY }], localLore: [] };
    await globalThis.risuai.setChatToIndex(ci, 0, chat);
    return { char_index: ci, chat_index: 0, message_index: 1 };
  });
  await rec('job.stored_source_settings', () => put('/v1/settings', { card: { include_max: 3 } }));
  handles.setLlmReply?.(JSON.stringify({
    new_characters: [
      {
        name: '태양',
        aliases: ['태양', 'Taeyang'],
        original: '',
        appearance: 'boy, young adult, tall, black hair, short hair, messy hair, amber eyes',
        attire: 'white shirt, black trousers',
      },
    ],
    scenes: [
      {
        place: 'interior, workshop',
        shots: [
          { paragraph: 0, line: 2, y_percent: 50, characters: [{ name: '태양', action: 'standing' }] },
        ],
      },
    ],
  }));
  const storedLlmMark = handles.llmRequests.length;
  const storedJob = await rec('job.stored_source_create', () => post('/v1/jobs/create', {
    session_id: 'sess_stored',
    character_id: 'char_stored',
    character_name: '보관봇',
    chat_id: 'chat_stored',
    chat_name: '보관 채팅',
    // Deliberately different from STORED_BODY: the new backend must number
    // the stored original, not this text.
    assistant_text: '태양이 망치를 들었다. 불꽃이 튀었다.',
    message_index: 1,
    message_role: 'char',
    content_hash: 'hash_stored',
    char_index: storedIdx?.char_index ?? -1,
    chat_index: storedIdx?.chat_index ?? -1,
    recent_messages: [
      { role: 'char', content: STORED_BODY },
      { role: 'user', content: '이전에 뭐했어?[[@inray::tok::inxshot_tok.webp]]' },
    ],
  }));
  const storedDone = await waitForJob(storedJob?.job_id);
  // Slim value on purpose: the full wait response embeds the debug event
  // window, whose image stages land at different polls on each backend.
  await rec('job.stored_source_wait', () => ({
    state: storedDone?.state ?? null,
    cards: (storedDone?.result?.cards ?? []).length,
  }));
  await rec('job.stored_source_tagger_input', () => {
    const users = handles.llmRequests.slice(storedLlmMark)
      .flatMap((r) => (Array.isArray(r?.messages) ? r.messages : []))
      .filter((m) => m?.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
    const tagged = users.filter((t) => t.includes('L1|'));
    const user = tagged.length ? tagged[tagged.length - 1] : '';
    return {
      has_tokens: /\[\[@inray/.test(user),
      has_stored_l3: /L3\|망치가/.test(user),
    };
  });
  await rec('job.stored_source_chat', async () => {
    const db = await globalThis.risuai.getDatabase();
    const chat = db.characters[storedIdx.char_index].chats[storedIdx.chat_index];
    const body = String(chat.message[1]?.data ?? '');
    return { body, has_previous_marks: /old-card|old-job_0|abandoned_1/.test(body) };
  });
  handles.setLlmReply?.(DEFAULT_LLM_REPLY);
  await rec('job.stored_source_restore', () => put('/v1/settings', { card: { include_max: 0 } }));
  await rec('job.stored_source_cleanup', () => post('/v1/gallery/delete', {
    card_ids: (storedDone?.result?.cards ?? []).map((c) => c?.id).filter(Boolean),
  }));
  // ── ComfyUI backend path ──────────────────────────────────────────────
  await rec('comfy.configure', () => put('/v1/settings', {
    nai: {
      backend: 'comfy',
      comfy_url: 'http://127.0.0.1:8188',
      comfy_workflow_json: JSON.stringify({
        3: { class_type: 'KSampler', inputs: { seed: 0, steps: 20 } },
        6: { class_type: 'CLIPTextEncode', inputs: { text: '[[pos]]' } },
        7: { class_type: 'CLIPTextEncode', inputs: { text: '[[neg]]' } },
        9: { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
      }),
    },
  }));
  await rec('comfy.test', () => post('/v1/nai/test', {}));
  await rec('comfy.restore_nai', () => put('/v1/settings', { nai: { backend: 'nai' } }));

  // ── LLM via Risu main/aux ─────────────────────────────────────────────
  await rec('llm.source_main', () => put('/v1/settings', { llm: { source: 'main' } }));
  await rec('llm.test_main', () => post('/v1/models/test', {}));
  await rec('llm.source_aux', () => put('/v1/settings', { llm: { source: 'aux' } }));
  await rec('llm.test_aux', () => post('/v1/models/test', {}));
  await rec('llm.source_custom', () => put('/v1/settings', { llm: { source: 'custom' } }));

  // ── folder delete + card delete ───────────────────────────────────────
  // Generate a fresh card so there is a real folder to delete.
  const folderJob = await rec('job.create_for_folder', () => post('/v1/jobs/create', {
    session_id: 'sess_folder',
    character_id: 'char_folder',
    character_name: '폴더봇',
    chat_id: 'chat_folder',
    chat_name: '폴더 채팅',
    assistant_text: '태양이 다시 망치를 들었다.',
    message_index: 3,
    message_role: 'char',
    content_hash: 'hash_folder',
    lorebook: [],
  }));
  await rec('job.wait_for_folder', () => waitForJob(folderJob?.job_id));
  const exploreForDelete = await rec('gallery.explore_for_delete', () => get('/v1/gallery/explore?limit=200'));
  // Intended difference from 1.x: a folder now reports every shot stored in it,
  // not just the ones inside the explorer's window. 1.x counted the window, so a
  // folder of 800 read "120장" once the limit bit. One item ships here and the
  // folder tallies must still add up to the whole gallery.
  await rec('gallery.explore_window_folder_counts', async () => {
    const windowed = await get('/v1/gallery/explore?limit=1');
    const full = await get('/v1/gallery/explore?limit=200');
    return {
      items: (windowed?.items ?? []).length,
      folder_total: (windowed?.folders ?? []).reduce((n, f) => n + (Number(f.count) || 0), 0),
      full_items: (full?.items ?? []).length,
    };
  });
  // Folder rows expose `key`; only item rows carry `folder_key`.
  await rec('gallery.explore_folder_keys', () => (exploreForDelete?.folders ?? []).map((f) => f.key).sort());

  // Card delete path: remove the freshly generated sess_folder card by id.
  const galleryForCardDelete = await rec('gallery.before_card_delete', () => get('/v1/gallery?session_id=sess_folder&limit=40'));
  await rec('gallery.unlink_duplicate_hash_isolated', async () => {
    const cardIds = new Set((galleryForCardDelete?.items ?? []).map((i) => i.id));
    const result = await post('/v1/gallery/unlink', {
      session_id: 'sess_folder',
      content_hash: 'hash_folder',
      message_index: 99,
    });
    const after = await get('/v1/gallery?session_id=sess_folder&limit=40');
    const kept = (after?.items ?? []).some((row) =>
      cardIds.has(row.id)
      && String(row.content_hash || '') === 'hash_folder'
      && Number(row.message_index) === 3);
    return { unlinked: Number(result?.unlinked || 0), kept };
  });
  await rec('gallery.delete_cards', () => post('/v1/gallery/delete', {
    card_ids: (galleryForCardDelete?.items ?? []).map((i) => i.id),
  }));
  await rec('gallery.after_card_delete', () => get('/v1/gallery?session_id=sess_folder&limit=40'));

  // Folder delete path: drop the main chat's folder, which still holds cards.
  const folderKey = (exploreForDelete?.folders ?? []).find((f) => f.key === 'char_main|chat_main')?.key;
  await rec('gallery.delete_folder_key_present', () => typeof folderKey === 'string' && folderKey.length > 0);
  await rec('gallery.delete_folder', () => post('/v1/gallery/delete', { folder_key: folderKey }));
  await rec('gallery.explore_after_folder_delete', () => get('/v1/gallery/explore?limit=200'));

  // ── settings import / reset ───────────────────────────────────────────
  const exportForImport =   await rec('settings.export_for_import', () => get('/v1/settings/export'));
  await rec('settings.import', () => post('/v1/settings/import', { json: exportForImport?.json ?? '{}' }));
  // 2.0 settings EXPORT embeds the prompts pack; IMPORT restores it (1.x has
  // neither — NEW_ONLY). Marker → re-import the same pack → marker must be gone.
  await rec('settings.prompts_in_export', () => {
    let doc = {};
    try { doc = JSON.parse(exportForImport?.json ?? '{}'); } catch { /* not JSON */ }
    const pack = doc?.prompts;
    return {
      embedded: !!pack && typeof pack === 'object' && !Array.isArray(pack),
      tagger_text: typeof pack?.tagger === 'string' ? String(pack.tagger).slice(0, 40) : null,
    };
  });
  await put('/v1/prompts/tagger', { text: 'PROMPTS ROUNDTRIP PROBE' });
  await rec('settings.prompts_import_restores', async () => {
    await post('/v1/settings/import', { json: exportForImport?.json ?? '{}' });
    const tagger = await get('/v1/prompts/tagger');
    return {
      restored: tagger?.text !== 'PROMPTS ROUNDTRIP PROBE',
      marker_gone: !String(tagger?.text || '').includes('PROBE'),
    };
  });
  await rec('settings.tagger_dirty_before_reset', () => put('/v1/prompts/tagger', { text: 'FACTORY RESET MUST WIPE' }));
  await rec('settings.reset', () => post('/v1/settings/reset', {}));
  await rec('settings.after_reset', () => get('/v1/settings'));
  await rec('settings.reset_factory_floor', async () => {
    const card = (await get('/v1/settings'))?.settings?.card || {};
    const tagger = await get('/v1/prompts/tagger');
    return {
      image_min: card.image_min,
      image_max: card.image_max,
      execute: card.execute,
      lore_extra: card.lore_extra,
      asset_nai_tags: card.asset_nai_tags,
      tagger_wiped: !String(tagger?.text || '').includes('FACTORY RESET MUST WIPE'),
    };
  });
  // Reset now loads the recommended pack. Re-apply the boot extract + the
  // opening put so later jobs stay comparable to 1.x.
  await post('/v1/settings/import', { json: RESET_FLOOR_JSON });
  await put('/v1/settings', {
    llm: {
      source: 'custom',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-test',
      api_key: 'sk-parity',
      temperature: 0.4,
      max_tokens: 2048,
      reasoning_effort: 'medium',
    },
    nai: {
      backend: 'nai',
      api_key: 'pst-parity',
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 23,
      cfg_scale: 5,
      sampler: 'k_euler_ancestral',
      apply_quality_tags: true,
    },
    card: { power: true, image_max: 1, image_min: 1, character_max: 4, execute: 'auto' },
  });

  // ── style presets ─────────────────────────────────────────────────────
  await rec('presets.save', () => put('/v1/settings', {
    card: {
      presets: [
        { id: 'p1', name: '패리티프리셋', positive: 'best quality', negative: 'lowres' },
        { id: 'p2', name: '두번째', positive: 'masterpiece', negative: 'worst quality' },
      ],
      active_preset_id: 'p2',
      custom_pos: 'masterpiece',
      custom_neg: 'worst quality',
    },
  }));
  await rec('presets.after_save', () => get('/v1/settings'));
  await rec('presets.look_clear', () => post('/v1/presets/look/clear', { preset_id: 'p1' }));
  await rec('presets.look_empty', async () => {
    try {
      const r = await post('/v1/presets/look', { preset_id: 'p1' });
      return { ok: r?.ok ?? false };
    } catch (err) {
      return { ok: false, threw: true };
    }
  });

  // Reroll replays the saved image (mock PNG base is "parity cafe"). The
  // active preset must not replace that base — see INTENTIONAL_DIFF_STEPS.
  await rec('presets.save_swap_markers', () => put('/v1/settings', {
    card: {
      presets: [
        { id: 'p1', name: '패리티프리셋', positive: 'parity_style_alpha', negative: 'lowres' },
        { id: 'p2', name: '두번째', positive: 'parity_style_beta', negative: 'worst quality' },
      ],
      active_preset_id: 'p2',
    },
  }));
  const styleJob = await rec('presets.style_job_create', () => post('/v1/jobs/create', {
    session_id: 'sess_style',
    character_id: 'char_style',
    character_name: '스타일봇',
    chat_id: 'chat_style',
    chat_name: '스타일 채팅',
    assistant_text: '햇살이 창으로 들어왔다.',
    message_index: 1,
    message_role: 'char',
    content_hash: 'hash_style',
    char_index: 0,
    chat_index: 0,
    recent_messages: [{ role: 'user', content: '날씨가 좋아.' }],
  }));
  const styleJobResult = await rec('presets.style_job_wait', () => waitForJob(styleJob?.job_id));
  const styleCardId = styleJobResult?.result?.cards?.[0]?.id;
  await rec('presets.style_before_swap', () => (
    styleCardId ? get(`/v1/gallery?session_id=sess_style&limit=5`) : { items: [] }
  ));
  await rec('presets.activate_alpha', () => put('/v1/settings', {
    card: { active_preset_id: 'p1' },
  }));
  const savedStyleRecipe=await get(`/v1/cards/${styleCardId}/nai-prompt`).catch(()=>null);
  const styleReroll = await rec('presets.reroll_after_swap', () => (
    styleCardId ? post(`/v1/cards/${styleCardId}/reroll`, { mode: 'nai' }) : { ok: false }
  ));
  const afterMain = String(styleReroll?.card?.main_prompt || '');
  await rec('presets.reroll_swaps_style', () => ({
    kept_file: Boolean(savedStyleRecipe?.main_prompt) && afterMain===savedStyleRecipe.main_prompt,
    ignored_preset: !afterMain.includes('parity_style_alpha'),
    swapped: false,
  }));

  // A reroll builds its prompt for one family (V5 natural / speech / family
  // preset) and must send that family's model with it. 1.x dropped the route and
  // fell back to the model tab, so a V5-only prompt was generated on V4.5.
  const rerolledStyleId = styleReroll?.card?.id;
  await rec('presets.nai5_only_on', () => put('/v1/settings', { card: { nai5_only: true } }));
  const naiGenBefore = handles.naiRequests.filter((r) => r.kind === 'generate').length;
  await rec('presets.reroll_nai5_only', () => (
    rerolledStyleId ? post(`/v1/cards/${rerolledStyleId}/reroll`, { mode: 'nai' }) : { ok: false }
  ));
  await rec('presets.reroll_keeps_v5_model', () => {
    const sent = handles.naiRequests.filter((r) => r.kind === 'generate').slice(naiGenBefore);
    const model = String(sent[sent.length - 1]?.body?.model || '');
    return {
      sent: sent.length,
      model,
      v5: model.includes('nai-diffusion-5'),
      keeps_file: model.includes('nai-diffusion-4-5') && !model.includes('nai-diffusion-5'),
    };
  });
  await rec('presets.nai5_only_off', () => put('/v1/settings', { card: { nai5_only: false } }));

  // nai5_first + stored complexity=simple must reroll on V4, not fall through
  // to V5 because the reconstructed shot omitted complexity.
  const simpleReply = JSON.parse(DEFAULT_LLM_REPLY);
  simpleReply.scenes[0].shots[0].complexity = 'simple';
  handles.setLlmReply?.(JSON.stringify(simpleReply));
  await rec('presets.nai5_first_on', () => put('/v1/settings', { card: { nai5_first: true, nai5_only: false } }));
  const firstJob = await rec('presets.first_simple_job', () => post('/v1/jobs/create', {
    session_id: 'sess_first_simple',
    character_id: 'char_style',
    character_name: '스타일봇',
    chat_id: 'chat_first_simple',
    chat_name: '선택권 채팅',
    assistant_text: '망치를 들었다.',
    message_index: 1,
    message_role: 'char',
    content_hash: 'hash_first_simple',
    char_index: 0,
    chat_index: 0,
    recent_messages: [{ role: 'user', content: '작업하자.' }],
  }));
  const firstWait = await rec('presets.first_simple_wait', () => waitForJob(firstJob?.job_id));
  const firstSimpleId = firstWait?.result?.cards?.[0]?.id;
  const naiGenBeforeSimple = handles.naiRequests.filter((r) => r.kind === 'generate').length;
  const simpleRerolled = await rec('presets.reroll_simple_complexity', () => (
    firstSimpleId ? post(`/v1/cards/${firstSimpleId}/reroll`, { mode: 'nai' }) : { ok: false }
  ));
  await rec('presets.reroll_keeps_v4_from_complexity', () => {
    const sent = handles.naiRequests.filter((r) => r.kind === 'generate').slice(naiGenBeforeSimple);
    const model = String(sent[sent.length - 1]?.body?.model || '');
    return {
      sent: sent.length,
      model,
      v4: model.includes('nai-diffusion-4') && !model.includes('nai-diffusion-5'),
    };
  });
  handles.setLlmReply?.(DEFAULT_LLM_REPLY);
  await rec('presets.nai5_first_off', () => put('/v1/settings', { card: { nai5_first: false } }));

  // NAI SDXL식 강조: flag on → 전송 직전에 N::/{}/[]가 () 가중치로 변환된다.
  // 저장 카드·recipe main은 domain 형태 그대로. 1.x에는 flag 자체가 없어
  // 와이어 비교가 불가하므로 변환 판정은 NEW_ONLY_STEPS에서 새 쪽만 본다.
  await rec('nai.sdxl_emphasis_on', () => put('/v1/settings', { nai: { sdxl_emphasis: true } }));
  const sdxlGenBefore = handles.naiRequests.filter((r) => r.kind === 'generate').length;
  // reroll은 원본 카드를 교체하므로 교체된 쪽의 id를 쓴다.
  const sdxlCardId = simpleRerolled?.card?.id;
  await rec('nai.sdxl_reroll', () => (
    sdxlCardId ? post(`/v1/cards/${sdxlCardId}/reroll`, { mode: 'nai', overrides: { main_prompt: '2::sdxlprobe::, {sdxlbrace}, plain' } }) : { ok: false }
  ));
  await rec('nai.sdxl_emphasis_converts', () => {
    const sent = handles.naiRequests.filter((r) => r.kind === 'generate').slice(sdxlGenBefore);
    const input = String(sent[sent.length - 1]?.body?.input || '');
    return {
      sent: sent.length,
      converted: input.includes('(sdxlprobe:2)') && input.includes('(sdxlbrace)') && input.includes('plain'),
      kept_domain: !input.includes('2::sdxlprobe::') && !input.includes('{sdxlbrace}'),
      input: input.slice(0, 120),
    };
  });
  await rec('nai.sdxl_emphasis_off', () => put('/v1/settings', { nai: { sdxl_emphasis: false } }));

  // 2.4.20: a V5 bubble rides the speaker's own character caption, not the end of
  // main. Read it off the outbound NAI payload rather than the card, because the
  // stored caption is deliberately kept speech-free for the tag editor.
  const speechReply = JSON.parse(DEFAULT_LLM_REPLY);
  speechReply.scenes[0].shots[0].characters[0].speech = '안돼!!';
  handles.setLlmReply?.(JSON.stringify(speechReply));
  await rec('speech.on', () => put('/v1/settings', {
    card: { nai5_speech: true, nai5_only: true },
  }));
  const speechGenBefore = handles.naiRequests.filter((r) => r.kind === 'generate').length;
  const speechJob = await rec('speech.job_create', () => post('/v1/jobs/create', {
    session_id: 'sess_speech',
    character_id: 'char_style',
    character_name: '스타일봇',
    chat_id: 'chat_speech',
    chat_name: '대사 채팅',
    assistant_text: '태양이 소리쳤다.',
    message_index: 1,
    message_role: 'char',
    content_hash: 'hash_speech',
    char_index: 0,
    chat_index: 0,
    recent_messages: [{ role: 'user', content: '멈춰.' }],
  }));
  await rec('speech.job_wait', () => waitForJob(speechJob?.job_id));
  await rec('speech.bubble_on_caption', () => {
    const sent = handles.naiRequests.filter((r) => r.kind === 'generate').slice(speechGenBefore);
    const caption = sent[sent.length - 1]?.body?.parameters?.v4_prompt?.caption ?? {};
    const charCaptions = (caption.char_captions ?? []).map((c) => String(c?.char_caption || ''));
    return {
      sent: sent.length,
      main_has_bubble: String(caption.base_caption || '').includes('speechbubble'),
      char1_ends_with_bubble: /speechbubble, korean text:안돼!!$/.test(charCaptions[0] || ''),
      bubbles: charCaptions.filter((c) => c.includes('speechbubble')).length,
    };
  });
  handles.setLlmReply?.(DEFAULT_LLM_REPLY);
  await rec('speech.off', () => put('/v1/settings', {
    card: { nai5_speech: false, nai5_only: false },
  }));

  // ── comic cuts (2.0-only shape: 1.x never knew cut_kind) ──────────────
  // The mock host answers every LLM call with the same reply, so one object
  // serves both roles: `scenes` for the main tagger, `pages` for the comic
  // LLM. Steps are NEW_ONLY — legacy comparison is skipped, the new side is
  // asserted instead.
  // NOTE: the job folds session_id into the character unified scope, and the
  // roster the generator sees comes from tagged `new_characters` — so the
  // cast looks must ride in the reply itself (a plain /v1/characters post to
  // sess_comic is invisible to the job).
  const COMIC_NEW_CHARACTERS = [
    { name: '테아', aliases: ['테아'], appearance: 'girl, black hair', attire: 'coat', gender: 'girl' },
    { name: '카엘', aliases: ['카엘'], appearance: 'boy, brown hair', attire: 'shirt', gender: 'boy' },
  ];
  const COMIC_CUTS = [
    {
      cut_kind: 'normal',
      base: 'wooden hallway, afternoon light, cowboy shot',
      characters: [
        { name: '테아', action: 'grabbing arm, blush', source: 'grab', costume: 'coat', bubble: 'speech', text: '놔!' },
        { name: '카엘', action: 'surprised', target: 'grab', costume: 'shirt', bubble: 'speech', text: '뭐야' },
      ],
    },
    {
      cut_kind: 'closeup',
      base: '2::close-up::, woman, eyes, teary',
      characters: [
        { name: '테아', action: 'close-up, teary eyes', bubble: 'thought', text: '미안' },
      ],
    },
    {
      cut_kind: 'cross_section',
      base: '2::cross-section::, womb, fetus',
      characters: [
        { name: '카엘', action: 'cross-section, silhouette', bubble: 'narration', text: '그날 밤' },
      ],
    },
  ];
  const comicShot = (extra) => ({
    paragraph: 0,
    y_percent: 50,
    line: 1,
    comic_line_end: 2,
    kind: 'comic',
    aspect: 'portrait',
    camera: 'cowboy shot',
    characters: [{ name: '테아' }, { name: '카엘' }],
    ...extra,
  });
  const assertComicWire = (jobResult, genBefore) => {
    const sent = handles.naiRequests.filter((r) => r.kind === 'generate').slice(genBefore);
    const wire = JSON.stringify(sent[sent.length - 1]?.body ?? {});
    return {
      cards: jobResult?.result?.cards?.length ?? -1,
      sent: sent.length,
      koma3: wire.includes('3::3koma::'),
      layout: wire.includes('cut 1 is scene.') && wire.includes('cut 2 is close-up scene.'),
      closeup: wire.includes('2::close-up::'),
      xray: wire.includes('2::cross-section::'),
      sourceTag: wire.includes('source#grab'),
      targetTag: wire.includes('target#grab'),
      // Repeated depictions of each character must count once across the page.
      person: /\b1girl, 1boy\b/.test(wire) && !/\b[2-6]\+?(?:girls?|boys?)\b/.test(wire),
      speech: wire.includes('korean text'),
    };
  };
  // Jobs must target a fixture chat (see host.mjs): reuse char_style/chat_style.
  const comicJob = (suffix) => post('/v1/jobs/create', {
    session_id: 'sess_comic',
    character_id: 'char_style',
    character_name: '테아',
    chat_id: 'chat_style',
    chat_name: '만화 채팅',
    assistant_text: '테아가 팔을 잡았다.\n카엘이 놀랐다.',
    message_index: 1,
    message_role: 'char',
    content_hash: `hash_comic_${suffix}`,
    char_index: 0,
    chat_index: 0,
    recent_messages: [{ role: 'user', content: '그래서?' }],
  });
  await rec('comic.cuts_once', async () => {
    await put('/v1/settings', { card: { comic_gen: 'on', comic_llm_batch: 'once', comic_gen_ratio: 100, comic_max_pages: 2, person_tag_mode: 'gender', person_tag_solo: false } });
    handles.setLlmReply?.(JSON.stringify({
      new_characters: COMIC_NEW_CHARACTERS,
      scenes: [{ place: 'hallway', shots: [comicShot()] }],
      pages: [{ shot_index: 0, location: 'tatami, paper lantern, indoor', aspect: 'portrait', coords: 'ai_choice', cuts: COMIC_CUTS }],
    }));
    const genBefore = handles.naiRequests.filter((r) => r.kind === 'generate').length;
    const job = await comicJob('once');
    const res = await waitForJob(job?.job_id);
    const out = assertComicWire(res, genBefore);
    handles.setLlmReply?.(DEFAULT_LLM_REPLY);
    return out;
  });
  await rec('comic.with_main', async () => {
    await put('/v1/settings', { card: { comic_gen: 'on', comic_llm_batch: 'with_main', comic_gen_ratio: 100, comic_max_pages: 2 } });
    handles.setLlmReply?.(JSON.stringify({
      new_characters: COMIC_NEW_CHARACTERS,
      scenes: [{
        place: 'hallway',
        shots: [comicShot({
          comic_page: { location: 'tatami, paper lantern, indoor', aspect: 'portrait', coords: 'ai_choice', cuts: COMIC_CUTS },
        })],
      }],
    }));
    const genBefore = handles.naiRequests.filter((r) => r.kind === 'generate').length;
    const job = await comicJob('main');
    const res = await waitForJob(job?.job_id);
    const out = assertComicWire(res, genBefore);
    handles.setLlmReply?.(DEFAULT_LLM_REPLY);
    await put('/v1/settings', { card: { comic_gen: 'off', comic_llm_batch: 'once', comic_gen_ratio: 50 } });
    return out;
  });

  // ── character delete cascade ──────────────────────────────────────────
  await rec('comic.natural_supplement', async () => {
    // The legacy backend retains unknown settings but cannot generate this new field.
    // Exercise persistence on both; assert the complete NAI wire on the new backend.
    for (const batch of ['once', 'per_shot', 'with_main']) {
      for (const enabled of [true, false]) {
        await put('/v1/settings', { card: { comic_gen: 'on', comic_llm_batch: batch, comic_gen_ratio: 100, comic_natural_supplement: enabled } });
        if ((await get('/v1/settings')).settings.card.comic_natural_supplement !== enabled) throw new Error('comic natural setting did not persist');
        if (!supportsComicNatural) continue;
        const cuts = COMIC_CUTS.map((cut, i) => ({ ...cut, natural: `Exact panel description number ${i + 1}.` }));
        const page = { shot_index: 0, aspect: 'portrait', coords: 'ai_choice', cuts };
        handles.setLlmReply?.(JSON.stringify({
          scenes: [{ place: 'hallway', shots: [comicShot(batch === 'with_main' ? { comic_page: page } : {})] }],
          pages: [page],
        }));
        const before = handles.naiRequests.filter((r) => r.kind === 'generate').length;
        const job = await comicJob(`natural_${batch}_${enabled}`);
        const result = await waitForJob(job?.job_id);
        const sent = handles.naiRequests.filter((r) => r.kind === 'generate').slice(before);
        if (result?.state !== 'done' || !sent.length) throw new Error('comic natural generation failed');
        const wire = JSON.stringify(sent.at(-1).body);
        for (let i = 1; i <= cuts.length; i++) {
          if (wire.includes(`Exact panel description number ${i}.`) !== enabled) throw new Error(`comic natural wire mismatch: ${batch}/${enabled}/${i}`);
        }
      }
    }
    handles.setLlmReply?.(DEFAULT_LLM_REPLY);
    await put('/v1/settings', { card: { comic_gen: 'off', comic_llm_batch: 'once', comic_gen_ratio: 50, comic_natural_supplement: false } });
    return { persistence: true, batches: ['once', 'per_shot', 'with_main'] };
  });

  await rec('chars.delete_cascade', () => post('/v1/characters', {
    session_id: 'sess_chat_a',
    root_session_ids: ['sess_chat_a', 'sess_chat_b'],
    root_delete: [{ id: 'chat-a-nim', name: '니메리엘', aliases: ['니메리엘', 'Nimeriel'] }],
    characters: [],
  }));
  await rec('chars.chat_a_after_delete', () => get('/v1/characters?session_id=sess_chat_a'));
  await rec('chars.chat_b_after_delete', () => get('/v1/characters?session_id=sess_chat_b'));

  // ── error paths ───────────────────────────────────────────────────────
  await rec('error.unknown_get', () => get('/v1/does-not-exist'));
  await rec('error.unknown_post', () => post('/v1/nope', {}));
  await rec('error.bad_method', () => N.fetch('/v1/settings', { method: 'DELETE' }));
  await rec('error.missing_prompt', () => get('/v1/prompts/not_a_prompt'));
  await rec('error.missing_job', () => get('/v1/jobs/nonexistent-job-id'));
  await rec('error.missing_card_tags', () => post('/v1/cards/nonexistent/tags', { main_prompt: 'x' }));

  // ── debug surface ─────────────────────────────────────────────────────
  await rec('debug.snapshot_shape', async () => {
    const d = await get('/v1/debug');
    // Only the stable shape is asserted here. `by_stage` is derived from the last
    // 80 events, and the old backend filled that window with storage writes, so
    // which stages appear is an artefact of persistence volume rather than
    // behaviour. Stage coverage is asserted instead by the comparer's event-log
    // summary, which requires every stage the old run logged to still be logged.
    return {
      hasEvents: Array.isArray(d?.events) && d.events.length > 0,
      hasStages: Object.keys(d?.by_stage ?? {}).length > 0,
      env: d?.env ?? null,
      countKeys: Object.keys(d?.counts ?? {}).sort(),
    };
  });
  await rec('debug.bridge_shape', () => {
    const d = N.debug?.();
    return { hasEvents: Array.isArray(d?.events) && d.events.length > 0 };
  });
  await rec('debug.clear', () => post('/v1/debug/clear', {}));
  await rec('debug.after_clear', async () => {
    const d = await get('/v1/debug');
    return { events: Array.isArray(d?.events) ? d.events.length <= 2 : null };
  });

  // ── 2.5 storage migration ─────────────────────────────────────────────
  // Last, because it runs the retention passes and stamps the store — both of
  // which would change what the steps above see.
  //
  // In this run there is nothing to move: every shot the scenario generated
  // already went straight to the gallery module, so `total` is 0. What this
  // asserts is the route plumbing and that a run with no failures stamps and
  // stops offering itself. Moving actual bytes is covered by the unit tests,
  // which can seed a legacy row directly.
  await rec('storage.migrate_before', async () => {
    const info = await get('/v1/storage/migrate/status');
    return { ok: info?.ok, running: info?.status?.running, phase: info?.status?.phase };
  });
  await rec('storage.migrate_run', async () => {
    const started = await post('/v1/storage/migrate', {});
    let status = started?.status;
    for (let i = 0; i < 200 && status?.running; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      status = (await get('/v1/storage/migrate/status'))?.status;
    }
    return {
      started: started?.started === true,
      total: started?.total ?? null,
      phase: status?.phase ?? null,
      failed: status?.failed ?? null,
      running: status?.running ?? null,
    };
  });
  await rec('storage.migrate_after', async () => {
    const info = await get('/v1/storage/migrate/status');
    return { migrated_version: info?.migrated_version ?? null, pending_images: info?.pending_images ?? null };
  });
  await rec('storage.migrate_cancel_idle', () => post('/v1/storage/migrate/cancel', {}));

  // ── outbound traffic assertions ───────────────────────────────────────
  // 2.x JSON lives in pluginStorage (`legacyStorage` here). 1.x used device IDB.
  const liveKv = handles.legacyStorage.size ? handles.legacyStorage : handles.storage;
  transcript.push({
    step: step + 1,
    name: 'host.traffic',
    ok: true,
    value: {
      llmRequestCount: handles.llmRequests.length > 0,
      naiGenerateCount: handles.naiRequests.filter((r) => r.kind === 'generate').length > 0,
      unmocked: handles.unmocked,
      storageKeys: [...liveKv.keys()].map((k) => k.replace(/^onx_nximg_.*/, 'onx_nximg_*')).sort()
        .filter((k, i, a) => a.indexOf(k) === i),
    },
  });
  transcript.push({
    step: step + 2,
    name: 'host.gallery_pixels',
    ok: true,
    value: [...handles.storage.keys(), ...handles.legacyStorage.keys()].some((k) => /^onx_nximg_/.test(k))
      ? 'plugin'
      : 'module',
  });
  // Cards and image metadata are stored one character-chat at a time, so
  // opening a chat reads that room and nothing else. `storageKeys` above folds
  // the whole group into one token; the counts here are the actual assertion.
  {
    const keys = [...liveKv.keys()];
    const packs = keys.filter((k) => /^onx_nxcards_/.test(k));
    const packed = packs.reduce((n, k) => {
      const raw = liveKv.get(k);
      const pack = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return n + Object.keys(pack?.cards || {}).length;
    }, 0);
    const monolith = liveKv.get('onx_nxstore_cards');
    const monolithRows = typeof monolith === 'string' ? JSON.parse(monolith) : monolith;
    transcript.push({
      step: step + 3,
      name: 'host.room_packs',
      ok: true,
      value: {
        packs: packs.length,
        has_index: keys.includes('onx_nxrooms'),
        packed_cards: packed,
        monolith_cards: Object.keys(monolithRows || {}).length,
        persisted_jobs:keys.includes('onx_nxstore_jobs'),
      },
    });
  }

  await rec('settings.vertex_credentials', async () => {
    const credential = JSON.stringify({ project_id: 'parity-only', client_email: 'fake@example.invalid', private_key: 'fake' });
    const saved = (await put('/v1/settings', {
      llm: { service_account_json: credential },
      llm_roles: { autotag: { service_account_json: credential }, asset_char: { service_account_json: credential } },
    }))?.settings;
    const cleared = (await put('/v1/settings', {
      llm: { clearServiceAccount: true }, llm_roles: { autotag: { clearServiceAccount: true } },
    }))?.settings;
    return {
      saved: saved?.llm?.service_account_configured === true && saved?.llm_roles?.autotag?.service_account_configured === true,
      redacted: saved?.llm?.service_account_json === '' && saved?.llm_roles?.autotag?.service_account_json === '',
      cleared: cleared?.llm?.service_account_configured === false && cleared?.llm_roles?.autotag?.service_account_configured === false,
      otherKept: cleared?.llm_roles?.asset_char?.service_account_configured === true,
      clearFlagGone: !('clearServiceAccount' in (cleared?.llm || {})) && !('clearServiceAccount' in (cleared?.llm_roles?.autotag || {})),
    };
  });
  // Saving uses given-name spellings only; trigger aliases remain for text matching.
  await rec('chars.given_name_save_contract', async () => {
    const session_id = 'char_parity';
    const previous = await get('/v1/characters?session_id=' + session_id);
    const make = (id, given_name, given_name_variants) => ({ id, name: id, given_name, given_name_variants, surname: '김', aliases: ['shared'], appearance: 'blue eyes' });
    try {
      await post('/v1/characters', { session_id, characters: [
        make('name-a', '', ['Yuna']), make('name-c', '', ['Yoona']),
        make('name-b', '', ['YU NA, YOONA']),
        make('trigger-a', '', []), make('trigger-b', '', []),
      ] });
      const result = await get('/v1/characters?session_id=' + session_id);
      const rows = result.characters || [];
      const merged = rows.filter(row => row.given_name_variants?.length);
      const words = (merged[0]?.given_name_variants || []).map(x => x.toLowerCase().replace(/\s/g, '')).sort();
      return { count: rows.length, merged: merged.length, words, triggersSeparate: rows.filter(row => row.id.startsWith('trigger-')).length === 2 };
    } finally {
      await post('/v1/characters', { session_id, characters: previous.characters || [] });
    }
  });
  return transcript;
}
