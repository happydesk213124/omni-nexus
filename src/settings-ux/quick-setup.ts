import { dbg } from '../core/debug';
import { sleep } from '../core/util/async';
import { estimateTokens, JEV_OPENROUTER, planQuickSetup, QUALITY_PRESET_ID, type QuickAnswers, type QuickFeature, type QuickPlan } from '../domain/quick-setup';
import { authorNotePresetExamples } from '../domain/tagging/author-note-presets';
import { comicGenOn } from '../domain/comic/kind';
import { soundDefaults } from '../config/sound-defaults';
import { defaultEndpointForProvider, llmModelPlaceholder } from '../providers/llm/providers';
import { getNaiQuotaDetail } from '../providers/nai/client';
import { psGet, psSet } from '../storage/device-store';
import { loadEmotionData, updateEmotionSettings } from '../storage/emotion-store';
import { settingsWereNew } from '../storage/settings-store';
import { loadSoundData, updateSoundSettings } from '../storage/sound-store';
import { loadTtsData, updateTtsSettings } from '../storage/tts-store';
import { loadViewerPrefs, saveViewerPrefs } from '../storage/viewer-prefs';
import { QUICK_SETUP_CSS, sheetHtml, type QuickStep, type QuickView } from './quick-setup-view';

/**
 * ⚡ 빠른 설정: a few questions over the settings window (full screen on a phone), from the button left of
 * 🔍, and on its own once for a first install. It starts from the settings as they are, so opening it again
 * shows what is set, and writes only what it asked about.
 */
export const QUICK_SETUP_KEY = 'onx_quick_setup';

type Loose = Record<string, unknown>;
interface Actions {
  config: () => Loose | null | undefined;
  save: (patch: Loose) => Promise<void>;
  request: (path: string, body?: Loose) => Promise<unknown>;
  reload: () => Promise<void>;
}
/** The author's note presets as the window lists them: the pick, 직접 입력, and every preset's text. */
interface NoteListing { selected?: string; custom?: string; items?: Array<{ id: string; text: string }> }
const notes = (actions: Actions): Promise<NoteListing | null> => actions.request('/v1/author-note-presets').then(value => value && typeof value === 'object' ? value as NoteListing : null, () => null);
const loose = (value: unknown): Loose => value && typeof value === 'object' ? value as Loose : {};
const settingsActions = (): Actions | undefined => Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
const QUALITY_TEXT = authorNotePresetExamples().find(row => row.id === QUALITY_PRESET_ID)?.text || '';
const helperDefaults = () => ({ endpoint: defaultEndpointForProvider('openrouter'), model: llmModelPlaceholder('openrouter') });

/** The settings as they are, read as answers. A first install starts from the recommended ones. */
async function currentAnswers(actions: Actions): Promise<{ answers: QuickAnswers; saved: QuickView['saved'] }> {
  const [tts, sound, emotion, viewer] = await Promise.all([loadTtsData(), loadSoundData(), loadEmotionData(), loadViewerPrefs()]);
  const config = loose(actions.config()), card = loose(config.card), llm = loose(config.llm), nai = loose(config.nai), fresh = settingsWereNew();
  const features: QuickFeature[] = [];
  const comic = comicGenOn(card), power = card.power !== false;
  if (power && !(comic && Number(card.comic_gen_ratio) >= 100)) features.push('image');
  if (power && comic) features.push('comic');
  if (tts.settings.enabled) features.push('tts');
  if (sound.settings.bgmEnabled || sound.settings.sfxEnabled) features.push('sound');
  if (emotion.settings.enabled) features.push('viewer');
  const selector = tts.settings.selector;
  const listing = await notes(actions);
  const max = Number(card.image_max) || 3;
  return {
    answers: {
      features, naiKey: '', fishKey: '', routerKey: '',
      tagMode: card.stream_inline_tags === true || fresh ? 'stream' : 'tagger',
      helper: llm.source === 'main' || llm.source === 'custom' ? llm.source : 'aux',
      helperModel: llm.source === 'custom' ? String(llm.model || '') : '',
      picker: selector === 'jev' || selector === 'embedding' ? selector : viewer.bgPick === 'jev' || viewer.bgPick === 'embedding' ? viewer.bgPick : 'off',
      images: max <= 1 ? 1 : max <= 3 ? 2 : 3,
      comicShare: Number(card.comic_gen_ratio) >= 100 ? 100 : 50,
      speech: card.nai5_speech !== false,
      quality: listing?.selected === QUALITY_PRESET_ID,
    },
    saved: {
      nai: !!(nai.api_key_configured || String(nai.api_key || '').trim()),
      fish: !!tts.settings.fish.key.trim(),
      router: !!(tts.settings.jev.key.trim() || sound.settings.embed.key.trim() || (llm.source === 'custom' && (llm.api_key_configured || String(llm.api_key || '').trim()))),
    },
  };
}

/** What will change, in words, for the review step and the last one. */
function summary(a: QuickAnswers, plan: QuickPlan): string[] {
  const has = (f: QuickFeature) => a.features.includes(f), on = (b: boolean) => b ? '켬' : '끔';
  const lines = [`삽화: ${on(has('image'))} · 만화: ${on(has('comic'))}`];
  if (has('image') || has('comic')) {
    lines.push(`그림 태그: ${a.tagMode === 'stream' ? '메인 모델이 답장 쓰면서 (스트리밍 태그)' : '답장 뒤 보조 모델이 따로'}`);
    lines.push(`한 답장에 ${a.images === 1 ? '1장' : a.images === 2 ? '2~3장' : '3~4장'}${has('comic') ? ` · 만화 ${plan.settings.card.comic_gen_ratio}%${a.speech ? ' · 말풍선' : ' · 무대사'}` : ''}`);
    lines.push(`퀄리티 향상 프롬프트: ${on(a.quality)}`);
  }
  lines.push(`보조 모델: ${a.helper === 'aux' ? 'Risu 보조 모델' : a.helper === 'main' ? 'Risu 메인 모델' : `OpenRouter · ${a.helperModel.trim() || helperDefaults().model}`}`);
  lines.push(`TTS: ${on(has('tts'))} · BGM·효과음: ${on(has('sound'))} · 옴니 뷰어 감정 에셋: ${on(has('viewer'))}`);
  if (has('tts') || has('sound') || has('viewer')) lines.push(`자동 고르기: ${a.picker === 'jev' ? 'JEV' : a.picker === 'embedding' ? '임베딩' : '보조 모델'}`);
  const keys = [a.naiKey && 'NovelAI', a.routerKey && 'OpenRouter', a.fishKey && 'Fish Audio'].filter(Boolean);
  if (keys.length) lines.push(`새로 넣은 키: ${keys.join(', ')}`);
  return lines;
}

/** Writes the plan: Omni's own settings through the window's save (it repaints them), the rest into their stores. */
async function apply(actions: Actions, a: QuickAnswers): Promise<QuickPlan> {
  const plan = planQuickSetup(a, helperDefaults());
  await actions.save(plan.settings);
  const tts = (await loadTtsData()).settings, sound = (await loadSoundData()).settings;
  await updateTtsSettings({ enabled: plan.tts.enabled, selector: plan.tts.selector,
    ...(plan.tts.fishKey ? { fish: { ...tts.fish, key: plan.tts.fishKey } } : {}),
    ...(plan.tts.jevKey ? { jev: { ...tts.jev, ...JEV_OPENROUTER, key: plan.tts.jevKey } } : {}) });
  await updateSoundSettings({ bgmEnabled: plan.sound.bgmEnabled, sfxEnabled: plan.sound.sfxEnabled,
    // Another provider's model id means nothing to OpenRouter: switched over, it starts from the default one.
    ...(plan.sound.embedKey ? { embed: { ...sound.embed, provider: 'openrouter', model: sound.embed.provider === 'openrouter' ? sound.embed.model : soundDefaults().embed.model, key: plan.sound.embedKey } } : {}) });
  await updateEmotionSettings({ enabled: plan.emotion.enabled });
  await saveViewerPrefs({ bgPick: plan.viewer.bgPick });
  // 퀄리티 향상 is the tagger's author's note preset: on, its text is the note; off, 직접 입력 comes back as it was.
  const listing = await notes(actions);
  if (plan.quality) {
    await actions.request('/v1/prompts/author_note', { text: listing?.items?.find(row => row.id === QUALITY_PRESET_ID)?.text || QUALITY_TEXT });
    await actions.request('/v1/author-note-presets', { selected: QUALITY_PRESET_ID });
  } else if (listing?.selected === QUALITY_PRESET_ID) {
    await actions.request('/v1/prompts/author_note', { text: String(listing.custom || '') });
    await actions.request('/v1/author-note-presets', { selected: 'custom' });
  }
  await psSet(QUICK_SETUP_KEY, { at: Date.now() });
  await actions.reload();
  return plan;
}

let openSheet: HTMLElement | null = null;
export async function openQuickSetup(): Promise<void> {
  const actions = settingsActions();
  if (!actions || openSheet?.isConnected) return;
  const { answers, saved } = await currentAnswers(actions);
  const root = document.createElement('div');
  root.className = 'nx-qs'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'nx-qs-title');
  const style = document.createElement('style'); style.textContent = QUICK_SETUP_CSS;
  const card = document.createElement('div');
  root.append(style, card);
  document.body.append(root); openSheet = root;
  const steps = (): QuickStep[] => [...['features', 'connect'] as QuickStep[], ...(answers.features.some(f => f === 'image' || f === 'comic') ? ['draw' as QuickStep] : []), 'review', 'done'];
  let step: QuickStep = 'features', applied: string[] = [], busy = false;
  const view = (): QuickView => ({ answers, saved, qualityTokens: estimateTokens(QUALITY_TEXT), summary: step === 'done' ? applied : summary(answers, planQuickSetup(answers, helperDefaults())) });
  const paint = () => {
    // Typed keys survive a repaint: the fields are drawn empty and the answers hold what was typed.
    card.innerHTML = sheetHtml(step, steps(), view());
    for (const field of card.querySelectorAll<HTMLInputElement>('[data-qs-key]')) field.value = String(answers[field.dataset.qsKey as 'naiKey'] ?? '');
  };
  const close = () => { root.remove(); openSheet = null; void psSet(QUICK_SETUP_KEY, { at: Date.now() }).catch(() => {}); };
  const move = (by: number) => { const list = steps(), at = list.indexOf(step); step = list[Math.max(0, Math.min(list.length - 1, at + by))]!; paint(); card.querySelector('.nx-qs-body')?.scrollTo(0, 0); };
  root.addEventListener('input', event => {
    const field = (event.target as Element).closest<HTMLInputElement>('[data-qs-key]');
    if (field) (answers as unknown as Record<string, unknown>)[field.dataset.qsKey!] = field.value;
  });
  root.addEventListener('click', event => {
    const target = event.target as Element;
    if (target === root) return;
    const feature = target.closest<HTMLElement>('[data-qs-feature]')?.dataset.qsFeature as QuickFeature | undefined;
    if (feature) { answers.features = answers.features.includes(feature) ? answers.features.filter(f => f !== feature) : [...answers.features, feature]; paint(); return; }
    const choice = target.closest<HTMLElement>('[data-qs-choice]');
    if (choice) {
      const raw = choice.dataset.value ?? '', value = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
      (answers as unknown as Record<string, unknown>)[choice.dataset.qsChoice!] = value; paint(); return;
    }
    const act = target.closest<HTMLElement>('[data-qs]')?.dataset.qs;
    if (act === 'close') close();
    else if (act === 'back') move(-1);
    else if (act === 'next') move(1);
    else if (act === 'check-nai') {
      const status = card.querySelector<HTMLElement>('[data-qs-status="naiKey"]');
      if (!answers.naiKey.trim()) { if (status) status.textContent = '키를 먼저 붙여 넣어 주세요.'; return; }
      if (status) status.textContent = '확인하는 중…';
      void getNaiQuotaDetail(answers.naiKey.trim()).then(quota => { if (status) status.textContent = `연결됨 · ${quota.opus ? 'Opus ✓' : 'Opus 아님'} · Anlas ${quota.total.toLocaleString('ko-KR')}`; })
        .catch(error => { if (status) status.textContent = `연결 실패 · ${String((error as Error)?.message || error).slice(0, 120)}`; });
    } else if (act === 'apply' && !busy) {
      busy = true;
      const button = target.closest<HTMLButtonElement>('button');
      if (button) { button.disabled = true; button.textContent = '적용하는 중…'; }
      void apply(actions, answers).then(plan => { applied = summary(answers, plan); step = 'done'; paint(); })
        .catch(error => { if (button) { button.disabled = false; button.textContent = '적용'; } alert(`적용하지 못했습니다 · ${String((error as Error)?.message || error)}`); })
        .finally(() => { busy = false; });
    }
  });
  paint();
}

/** The button left of 🔍 in the settings header. */
export function bindQuickSetup(): void {
  const button = document.getElementById('nx-quick-setup');
  if (!button || button.dataset.nxQuick === '1') return;
  button.dataset.nxQuick = '1';
  button.addEventListener('click', () => void openQuickSetup().catch(error => dbg('quick-setup.open', { message: String(error) }, 'warn')));
}

/**
 * A first install (no settings saved before this start) gets the settings window with the sheet over it, once:
 * closing it, or applying, marks it seen. Anyone updating never sees it unasked.
 */
export async function installQuickSetup(boot: { ready: () => Promise<unknown> }): Promise<void> {
  await boot.ready();
  // An automated browser (the tests, a script) starts from empty storage too: the sheet would cover what it drives.
  if (navigator.webdriver || !settingsWereNew() || await psGet(QUICK_SETUP_KEY)) return;
  // The window's opener is published once the settings UI has run.
  for (let i = 0; i < 120 && typeof Reflect.get(globalThis, '__OMNI_OPEN_SETTINGS__') !== 'function'; i++) await sleep(500);
  const open = Reflect.get(globalThis, '__OMNI_OPEN_SETTINGS__');
  if (typeof open !== 'function') return;
  await psSet(QUICK_SETUP_KEY, { at: Date.now() });
  await open('dashboard');
  for (let i = 0; i < 40 && !settingsActions(); i++) await sleep(250);
  await openQuickSetup();
}
