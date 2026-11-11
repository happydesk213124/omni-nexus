import { dbg } from '../core/debug';
import { sleep } from '../core/util/async';
import { estimateTokens, JEV_OPENROUTER, planQuickSetup, QUALITY_PRESET_ID, quickComicShareOf, quickImagesOf, quickStepSkipped, type QuickAnswers, type QuickFeature, type QuickKey, type QuickPlan, type QuickStep } from '../domain/quick-setup';
import { authorNotePresetExamples } from '../domain/tagging/author-note-presets';
import { comicGenOn } from '../domain/comic/kind';
import { soundDefaults } from '../config/sound-defaults';
import { defaultEndpointForProvider, llmModelPlaceholder } from '../providers/llm/providers';
import { getNaiQuotaDetail } from '../providers/nai/client';
import { objectValue, ttsFetch, ttsJson } from '../providers/tts/http';
import { psGet, psSet } from '../storage/device-store';
import { loadEmotionData, updateEmotionSettings } from '../storage/emotion-store';
import { settingsWereNew } from '../storage/settings-store';
import { loadSoundData, updateSoundSettings } from '../storage/sound-store';
import { loadTtsData, updateTtsSettings } from '../storage/tts-store';
import { loadViewerPrefs, saveViewerPrefs } from '../storage/viewer-prefs';
import { activeSteps, keyCardState, QUICK_PRESETS, QUICK_SETUP_CSS, railHtml, sheetHtml, type QuickCheck, type QuickPane, type QuickView } from './quick-setup-view';

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
const KEY_IDS: readonly QuickKey[] = ['naiKey', 'routerKey', 'fishKey'];

/** The settings as they are, read as answers, and the keys already saved (kept here only to check them, never shown). */
async function currentAnswers(actions: Actions): Promise<{ answers: QuickAnswers; savedKeys: Record<QuickKey, string>; saved: Record<QuickKey, boolean> }> {
  const [tts, sound, emotion, viewer] = await Promise.all([loadTtsData(), loadSoundData(), loadEmotionData(), loadViewerPrefs()]);
  const config = loose(actions.config()), card = loose(config.card), llm = loose(config.llm), nai = loose(config.nai), fresh = settingsWereNew();
  const features: QuickFeature[] = [];
  const comic = comicGenOn(card), power = card.power !== false;
  if (power && !(comic && Number(card.comic_gen_ratio) >= 100)) features.push('image');
  if (power && comic) features.push('comic');
  if (tts.settings.enabled) features.push('tts');
  if (sound.settings.bgmEnabled) features.push('bgm');
  if (sound.settings.sfxEnabled) features.push('sfx');
  if (emotion.settings.enabled) features.push('viewer');
  const selector = tts.settings.selector, matcher = sound.settings.sfxMatcher;
  const listing = await notes(actions);
  // A key the window only reports as set (never sends back) cannot be checked from here: '' with saved true.
  const naiKey = String(nai.api_key || '').trim(), routerKey = tts.settings.jev.key.trim() || sound.settings.embed.key.trim() || (llm.source === 'custom' ? String(llm.api_key || '').trim() : '');
  const savedKeys = { naiKey: /^\*+$|^•+$/.test(naiKey) ? '' : naiKey, routerKey, fishKey: tts.settings.fish.key.trim() };
  return {
    answers: {
      features, naiKey: '', fishKey: '', routerKey: '',
      tagMode: card.stream_inline_tags === true || fresh ? 'stream' : 'tagger',
      helper: llm.source === 'main' || llm.source === 'custom' ? llm.source : 'aux',
      helperModel: llm.source === 'custom' ? String(llm.model || '') : '',
      picker: selector === 'jev' || selector === 'embedding' ? selector : viewer.bgPick === 'jev' || viewer.bgPick === 'embedding' ? viewer.bgPick : 'off',
      images: quickImagesOf(Number(card.image_min), Number(card.image_max)),
      comicShare: quickComicShareOf(Number(card.comic_gen_ratio)),
      speech: card.nai5_speech !== false,
      quality: listing?.selected === QUALITY_PRESET_ID,
      ttsAuto: tts.settings.autoReply === true,
      narration: tts.settings.narration !== false,
      sfxMatcher: matcher === 'embedding-only' || matcher === 'tag' ? matcher : 'auto',
    },
    savedKeys,
    saved: {
      naiKey: !!(nai.api_key_configured || naiKey),
      routerKey: !!(routerKey || (llm.source === 'custom' && llm.api_key_configured)),
      fishKey: !!savedKeys.fishKey,
    },
  };
}

/** A failed request in words: a refused key says so, anything else says what came back. */
function failure(error: unknown): string {
  const status = Number((error as { status?: unknown })?.status), message = String((error as Error)?.message || error).slice(0, 140);
  return status === 401 || status === 403 || /\b40[13]\b|unauthor|invalid.*(key|token)/i.test(message) ? '키가 맞지 않습니다. 다시 복사해 붙여 넣어 주세요.'
    : status === 402 ? '키는 맞지만 잔액(크레딧)이 없습니다.' : `연결 실패 · ${message}`;
}
/** Asks the service itself whether a key works, and says what the key has (Anlas, credit). */
async function checkKey(key: QuickKey, value: string): Promise<string> {
  const headers = { Authorization: `Bearer ${value}` };
  if (key === 'naiKey') { const quota = await getNaiQuotaDetail(value); return `연결됨 · ${quota.opus ? 'Opus ✓' : 'Opus 아님'} · Anlas ${quota.total.toLocaleString('ko-KR')}`; }
  if (key === 'routerKey') {
    const data = objectValue(objectValue(await ttsJson(await ttsFetch('https://openrouter.ai/api/v1/key', { method: 'GET', headers }))).data);
    const used = Number(data.usage), limit = Number(data.limit);
    return `연결됨${Number.isFinite(used) ? ` · 사용 $${used.toFixed(2)}` : ''}${data.limit != null && Number.isFinite(limit) ? ` / 한도 $${limit.toFixed(2)}` : ''}${data.is_free_tier === true ? ' · 무료 등급' : ''}`;
  }
  const data = objectValue(await ttsJson(await ttsFetch('https://api.fish.audio/wallet/self/api-credit', { method: 'GET', headers })));
  const credit = Number(data.credit);
  return `연결됨${Number.isFinite(credit) ? ` · 크레딧 ${credit.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` : ''}`;
}

/** Writes the plan: Omni's own settings through the window's save (it repaints them), the rest into their stores. */
async function apply(actions: Actions, a: QuickAnswers, opened: QuickAnswers): Promise<QuickPlan> {
  const plan = planQuickSetup(a, helperDefaults(), opened);
  await actions.save(plan.settings);
  const tts = (await loadTtsData()).settings, sound = (await loadSoundData()).settings;
  await updateTtsSettings({ enabled: plan.tts.enabled, selector: plan.tts.selector,
    ...(plan.tts.autoReply === undefined ? {} : { autoReply: plan.tts.autoReply }), ...(plan.tts.narration === undefined ? {} : { narration: plan.tts.narration }),
    ...(plan.tts.fishKey ? { fish: { ...tts.fish, key: plan.tts.fishKey } } : {}),
    ...(plan.tts.jevKey ? { jev: { ...tts.jev, ...JEV_OPENROUTER, key: plan.tts.jevKey } } : {}) });
  await updateSoundSettings({ bgmEnabled: plan.sound.bgmEnabled, sfxEnabled: plan.sound.sfxEnabled,
    ...(plan.sound.sfxMatcher ? { sfxMatcher: plan.sound.sfxMatcher } : {}),
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
  const { answers, saved, savedKeys } = await currentAnswers(actions);
  const opened: QuickAnswers = { ...answers, features: [...answers.features] };
  const root = document.createElement('div');
  root.className = 'nx-qs'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'nx-qs-title');
  const style = document.createElement('style'); style.textContent = QUICK_SETUP_CSS;
  const card = document.createElement('div');
  card.style.display = 'contents';
  root.append(style, card);
  document.body.append(root); openSheet = root;

  let step: QuickPane = 'features', busy = false;
  const idle = (): QuickCheck => ({ state: 'idle', text: '' });
  const checks: Record<QuickKey, QuickCheck> = { naiKey: idle(), routerKey: idle(), fishKey: idle() };
  const shown: Record<QuickKey, boolean> = { naiKey: false, routerKey: false, fishKey: false };
  const view = (): QuickView => ({ step, answers, initial: opened, saved, checks, shown, qualityTokens: estimateTokens(QUALITY_TEXT), helperDefault: helperDefaults().model });
  const body = () => card.querySelector<HTMLElement>('.nx-qs-body');

  /** Draws the window again. The window itself never changes size; the same step keeps its scroll, a new one starts at the top. */
  let painted: QuickPane | '' = '';
  const paint = () => {
    const scroll = painted === step ? body()?.scrollTop ?? 0 : 0, moved = painted !== step, open = !!card.querySelector<HTMLDetailsElement>('.nx-qs-more')?.open;
    card.innerHTML = sheetHtml(view());
    painted = step;
    // Typed text is not in the markup (a key never is): the fields are drawn empty and filled from the answers.
    for (const field of card.querySelectorAll<HTMLInputElement>('[data-qs-key]')) field.value = answers[field.dataset.qsKey as QuickKey];
    const more = card.querySelector<HTMLDetailsElement>('.nx-qs-more');
    if (more && (open || KEY_IDS.some(key => !!more.querySelector(`[data-qs-key="${key}"]`) && !!answers[key].trim()))) more.open = true;
    const pane = body();
    if (pane) { pane.scrollTop = scroll; if (moved) pane.focus({ preventScroll: true }); }
    // On a phone the rail is a strip: the step being asked stays in sight.
    if (moved) card.querySelector<HTMLElement>('.nx-qs-step[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };
  /** One key's card and the rail, in place: the field being typed in (and a button being pressed) is never replaced. */
  const refreshKey = (key: QuickKey) => {
    const box = card.querySelector<HTMLElement>(`[data-qs-keycard="${key}"]`), state = keyCardState(key, view());
    if (box) {
      box.dataset.state = state.state;
      const chip = box.querySelector('.nx-qs-chip'), status = box.querySelector<HTMLElement>('.nx-qs-status'), button = box.querySelector<HTMLButtonElement>('[data-qs="check"]');
      if (chip) chip.textContent = state.chip;
      if (status) { status.textContent = state.status; status.dataset.check = state.check; }
      if (button) { button.disabled = state.busy; button.textContent = state.busy ? '확인 중…' : '확인'; }
    }
    const rail = card.querySelector('.nx-qs-rail');
    if (rail) rail.innerHTML = railHtml(view());
  };
  const close = () => { root.remove(); openSheet = null; document.removeEventListener('keydown', onKey, true); void psSet(QUICK_SETUP_KEY, { at: Date.now() }).catch(() => {}); };
  const go = (to: QuickPane) => { if (to !== 'done' && quickStepSkipped(to as QuickStep, answers)) return; step = to; paint(); };
  const move = (by: number) => { const list = activeSteps(answers), at = list.indexOf(step as QuickStep); go(list[Math.max(0, Math.min(list.length - 1, at + by))]!); };
  const runCheck = (key: QuickKey) => {
    const typed = answers[key].trim(), value = typed || savedKeys[key];
    if (!value) { checks[key] = { state: 'bad', text: saved[key] ? '저장된 키는 여기서 볼 수 없어요. 새 키를 붙여 넣으면 확인할 수 있습니다.' : '키를 먼저 붙여 넣어 주세요.' }; refreshKey(key); return; }
    checks[key] = { state: 'busy', text: '확인하는 중…' }; refreshKey(key);
    void checkKey(key, value).then(text => `${typed ? '' : '저장된 키 · '}${text}`, error => { throw new Error(failure(error)); })
      .then(text => { if (answers[key].trim() === typed) checks[key] = { state: 'ok', text }; }, error => { if (answers[key].trim() === typed) checks[key] = { state: 'bad', text: String((error as Error).message) }; })
      .finally(() => { if (checks[key].state === 'busy') checks[key] = idle(); if (root.isConnected) refreshKey(key); });
  };
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) return;
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); close(); }
    else if (event.key === 'Enter' && (event.target as Element | null)?.matches?.('[data-qs-key]')) { event.preventDefault(); runCheck((event.target as HTMLElement).dataset.qsKey as QuickKey); }
  }
  document.addEventListener('keydown', onKey, true);

  root.addEventListener('input', event => {
    const target = event.target as HTMLInputElement, key = target.dataset?.qsKey as QuickKey | undefined;
    if (key) {
      // A pasted key often carries a space or a line break: none belongs in one.
      const clean = target.value.replace(/\s+/g, '');
      if (clean !== target.value) target.value = clean;
      answers[key] = clean; checks[key] = idle(); refreshKey(key);
    } else if (target.dataset?.qsText === 'helperModel') answers.helperModel = target.value;
  });
  root.addEventListener('click', event => {
    const target = event.target as Element;
    if (target === root) return;
    const preset = target.closest<HTMLElement>('[data-qs-preset]')?.dataset.qsPreset;
    if (preset) { answers.features = [...(QUICK_PRESETS.find(row => row[0] === preset)?.[2] ?? [])]; paint(); return; }
    const feature = target.closest<HTMLElement>('[data-qs-feature]')?.dataset.qsFeature as QuickFeature | undefined;
    if (feature) { answers.features = answers.features.includes(feature) ? answers.features.filter(f => f !== feature) : [...answers.features, feature]; paint(); return; }
    const choice = target.closest<HTMLElement>('[data-qs-choice]');
    if (choice) {
      const raw = choice.dataset.value ?? '', value = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
      (answers as unknown as Record<string, unknown>)[choice.dataset.qsChoice!] = value; paint(); return;
    }
    const jump = target.closest<HTMLElement>('[data-qs-step]')?.dataset.qsStep as QuickStep | undefined;
    if (jump) { if (step !== 'done') go(jump); return; }
    const button = target.closest<HTMLElement>('[data-qs]'), act = button?.dataset.qs, key = button?.dataset.for as QuickKey | undefined;
    if (act === 'close') { if (!busy) close(); }
    else if (act === 'back') move(-1);
    else if (act === 'next') move(1);
    else if (act === 'reveal' && key) {
      shown[key] = !shown[key];
      const field = card.querySelector<HTMLInputElement>(`[data-qs-key="${key}"]`);
      if (field) field.type = shown[key] ? 'text' : 'password';
      button!.setAttribute('aria-pressed', String(shown[key]));
    } else if (act === 'check' && key) runCheck(key);
    else if (act === 'apply' && !busy) {
      busy = true;
      const press = button as HTMLButtonElement;
      press.disabled = true; press.textContent = '적용하는 중…';
      void apply(actions, answers, opened).then(() => { step = 'done'; paint(); })
        .catch(error => { press.disabled = false; press.textContent = '적용'; alert(`적용하지 못했습니다 · ${String((error as Error)?.message || error)}`); })
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
