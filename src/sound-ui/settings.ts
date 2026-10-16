import type { SfxRule, SoundSettings } from '../core/sound-types';
import { soundData, subscribeSound, updateSoundSettings } from '../storage/sound-store';
import { sfxMarksProblem } from '../domain/sound/audio';
import { soundTags } from '../domain/sound/tags';
import { el, input, val, set, text, esc, run, download, readJson, notify } from '../tts-ui/common';
import { SOUND_SETTINGS_FILE, exportableSoundSettings, importSoundSettings } from './settings-transfer';
import { defaultEndpointForEmbedding, defaultModelForEmbedding, shouldAutoReplaceEmbeddingModel, testEmbedding } from '../providers/embedding/client';
import { soundEmbedSettings } from '../providers/sound/embed';
import { ttsData } from '../storage/tts-store';
import { omniSound } from '../services/sound-runtime';
import { uuid } from '../core/util/text';
import type { CueAudit } from '../services/cue-audit';

const percent = (id: string, value: number) => { set(id, Math.round(value * 100)); text(`${id}-value`, `${Math.round(value * 100)}%`); };

/**
 * One card per rule: switch, name, the two marks around 「효과음」 as one unit,
 * and what a word looks like with them (예 §쾅§), so no test sentence is needed.
 */
function renderRules(): void {
  const host = el('snd-rules'); if (!host) return;
  host.replaceChildren();
  const rules = soundData().settings.sfxRules;
  if (!rules.length) { host.innerHTML = '<p class="snd-rules-empty">규칙이 없습니다. 「+ 규칙」으로 만드세요.</p>'; return; }
  for (const rule of rules) {
    const line = document.createElement('div'); line.className = 'snd-rule'; line.classList.toggle('off', !rule.enabled);
    // Only the marks: the matching itself is built in (sfxRuleSource), like the dialogue controls.
    const mark = (cls: string, value: string, label: string) => `<input class="${cls}" value="${esc(value)}" aria-label="${label}" placeholder="${label.slice(0, 1)}" maxlength="8">`;
    line.innerHTML = `<label class="switch"><input type="checkbox" ${rule.enabled ? 'checked' : ''} aria-label="${esc(rule.name)} 사용"></label>`
      + `<input class="snd-rule-name" value="${esc(rule.name)}" aria-label="규칙 이름" maxlength="40">`
      + `<span class="snd-rule-marks">${mark('snd-rule-open', rule.open, '앞 글자')}<span class="snd-rule-word" aria-hidden="true">효과음</span>${mark('snd-rule-close', rule.close, '뒤 글자')}</span>`
      + `<span class="snd-rule-sample" aria-label="예"></span>`
      + `<button type="button" class="snd-rule-del danger" aria-label="규칙 삭제" title="규칙 삭제">삭제</button><small class="snd-rule-error" role="alert"></small>`;
    const [on, name, open, close] = [...line.querySelectorAll('input')] as HTMLInputElement[];
    const sample = line.querySelector<HTMLElement>('.snd-rule-sample')!;
    const paintSample = () => { sample.textContent = open!.value && close!.value ? `예 ${open!.value}쾅${close!.value}` : ''; };
    paintSample();
    for (const field of [open, close]) field!.addEventListener('input', paintSample);
    const save = () => run(async () => {
      const problem = sfxMarksProblem(open!.value, close!.value);
      (line.querySelector('.snd-rule-error') as HTMLElement).textContent = problem;
      line.classList.toggle('bad', !!problem);
      if (problem) return;
      line.classList.toggle('off', !on!.checked);
      const rules = soundData().settings.sfxRules.map(r => r.id === rule.id ? { ...r, enabled: on!.checked, name: name!.value.trim() || '규칙', open: open!.value, close: close!.value } : r);
      await updateSoundSettings({ sfxRules: rules });
    });
    for (const field of [on, name, open, close]) field!.addEventListener('change', save);
    line.querySelector('.snd-rule-del')!.addEventListener('click', () => run(async () => {
      if (!confirm(`「${rule.name}」 규칙을 지울까요?`)) return;
      await updateSoundSettings({ sfxRules: soundData().settings.sfxRules.filter(r => r.id !== rule.id) }); renderRules();
    }));
    host.append(line);
  }
}
/**
 * Under the instruction switch: did the chat model's last request carry it? No
 * ▶ in the chat is then either a dropped instruction (lorebook budget) or a model
 * that ignored it, and only this tells the two apart.
 */
export function sfxCueStatusText(settings: SoundSettings, audit: CueAudit | null, hook: string | undefined): string {
  if (!settings.sfxEnabled || !settings.sfxCue || !settings.sfxRules.some(rule => rule.enabled && !sfxMarksProblem(rule.open, rule.close))) return '';
  if (hook === 'no') return '요청 확인 불가: Risu가 플러그인 요청 훅을 허용하지 않았습니다.';
  if (!audit) return '아직 확인한 메인 모델 요청이 없습니다.';
  const at = new Date(audit.at).toLocaleTimeString('ko-KR', { hour12: false });
  return audit.sfx ? `마지막 메인 요청(${at})에 효과음 지시가 들어갔습니다.`
    : `마지막 메인 요청(${at})에 효과음 지시가 빠졌습니다. Risu 로어북 토큰 한도에 잘렸을 수 있습니다(캐릭터 로어북 설정의 토큰 한도를 올려 보세요).`;
}
let cueTimer: ReturnType<typeof setInterval> | undefined;
function renderCueStatus(): void {
  const node = document.getElementById('snd-sfx-cue-status');
  if (!node?.isConnected) { clearInterval(cueTimer); cueTimer = undefined; return; }
  // The request hook lives with the streaming tags; its status crosses the same global the generation options read.
  const hook = Reflect.get(globalThis, '__OMNI_INLINE_TAGS__') as { status?: () => { registered?: string }; cues?: () => CueAudit | null } | undefined;
  node.textContent = sfxCueStatusText(soundData().settings, hook?.cues?.() ?? null, hook?.status?.().registered);
}

const SWITCHES = [['snd-bgm-enabled', 'bgmEnabled'], ['snd-sfx-enabled', 'sfxEnabled'], ['snd-bgm-prompt', 'bgmPrompt'], ['snd-sfx-cue', 'sfxCue'], ['snd-list-bgm', 'listBgm'], ['snd-list-sfx', 'listSfx'], ['snd-sfx-normalize', 'sfxNormalize'], ['snd-sfx-trim', 'sfxTrim'], ['snd-sfx-first', 'sfxFirst'], ['snd-sfx-autocreate', 'sfxAutoCreate']] as const;
const RANGES = [['snd-bgm-volume', 'bgmVolume'], ['snd-sfx-volume', 'sfxVolume'], ['snd-duck', 'duck']] as const;
const SELECTS = [['snd-bgm-matcher', 'bgmMatcher'], ['snd-bgm-basis', 'bgmBasis'], ['snd-sfx-matcher', 'sfxMatcher'], ['snd-sfx-auto', 'sfxAutoPlay']] as const;

/**
 * Every control from the stored settings: on mount, after a settings file is
 * loaded, and when something else changes them (⚡ turns BGM on). With its
 * switch off a section's other rows sit in a disabled fieldset, greyed out.
 * Rule rows are rebuilt only when asked: they hold marks still being typed and
 * their own error, which a repaint after an unrelated save would drop.
 */
export function paintSoundSettings(rules = true): void {
  if (!el('snd-bgm-gate')) return;
  const s = soundData().settings, typing = document.activeElement;
  // The field being typed in keeps what is typed; it saves on its own change.
  const put = (id: string, value: unknown) => { if (el(id) !== typing) set(id, value); };
  for (const [id, key] of SWITCHES) input(id).checked = s[key];
  for (const [id, key] of RANGES) if (el(id) !== typing) percent(id, s[key]);
  for (const [id, key] of SELECTS) put(id, s[key]);
  put('snd-bgm-cache', s.bgmCacheMb);
  const usage = omniSound.bgmCacheUsage(); text('snd-bgm-cache-usage', `지금 ${usage.count}곡 · ${(usage.bytes / 1048576).toFixed(1)} MB`);
  put('snd-crossfade', s.crossfadeMs / 1000); put('snd-sfx-max', s.sfxMaxSec); put('snd-max-mb', s.maxFileMb);
  put('snd-sfx-duration', s.sfxDuration); put('snd-eleven-key', s.elevenKey);
  put('snd-bgm-tags', s.bgmTags.join(', '));
  put('snd-embed-provider', s.embed.provider); put('snd-embed-model', s.embed.model); put('snd-embed-key', s.embed.key); put('snd-embed-endpoint', s.embed.endpoint);
  if (input('snd-embed-endpoint')) input('snd-embed-endpoint').placeholder = defaultEndpointForEmbedding(s.embed.provider);
  el<HTMLFieldSetElement>('snd-bgm-gate').disabled = !s.bgmEnabled;
  el<HTMLFieldSetElement>('snd-sfx-gate').disabled = !s.sfxEnabled;
  if (rules) renderRules();
}

let unsubscribe: (() => void) | undefined;
export function bindSoundSettings(): void {
  for (const [id, key] of SWITCHES) el(id).addEventListener('change', () => run(() => updateSoundSettings({ [key]: input(id).checked } as Partial<SoundSettings>)));
  for (const [id, key] of RANGES) {
    // The percentage follows the slider while it moves; the value is saved on release.
    el(id).addEventListener('input', () => text(`${id}-value`, `${val(id)}%`));
    el(id).addEventListener('change', () => run(() => updateSoundSettings({ [key]: Number(val(id)) / 100 } as Partial<SoundSettings>)));
  }
  for (const [id, key] of SELECTS) el(id).addEventListener('change', () => run(() => updateSoundSettings({ [key]: val(id) } as Partial<SoundSettings>)));
  // A field shows what was saved once it commits (99 s comes back as 60); a repaint leaves the focused field alone.
  const commit = (id: string, patch: () => Partial<SoundSettings>, shown: (s: SoundSettings) => unknown) =>
    el(id).addEventListener('change', () => run(async () => { await updateSoundSettings(patch()); set(id, shown(soundData().settings)); }));
  commit('snd-crossfade', () => ({ crossfadeMs: Number(val('snd-crossfade')) * 1000 }), s => s.crossfadeMs / 1000);
  commit('snd-bgm-cache', () => ({ bgmCacheMb: Number(val('snd-bgm-cache')) }), s => s.bgmCacheMb);
  el('snd-bgm-cache-clear')?.addEventListener('click', () => run(async () => {
    if (!confirm('이 기기에 받아 둔 BGM을 모두 지울까요? 다음에 들을 때 다시 받습니다.')) return;
    await omniSound.clearBgmCache(); paintSoundSettings(false); notify('기기에 받아 둔 BGM을 비웠습니다.');
  }));
  commit('snd-sfx-max', () => ({ sfxMaxSec: Number(val('snd-sfx-max')) }), s => s.sfxMaxSec);
  commit('snd-max-mb', () => ({ maxFileMb: Number(val('snd-max-mb')) }), s => s.maxFileMb);
  commit('snd-sfx-duration', () => ({ sfxDuration: Number(val('snd-sfx-duration')) || 0 }), s => s.sfxDuration);
  el('snd-eleven-key')?.addEventListener('change', () => run(() => updateSoundSettings({ elevenKey: val('snd-eleven-key').trim() })));
  commit('snd-bgm-tags', () => ({ bgmTags: soundTags(val('snd-bgm-tags')) }), s => s.bgmTags.join(', '));
  // A new provider brings its own model unless one was typed in; the address follows its default.
  el('snd-embed-provider')?.addEventListener('change', () => run(async () => {
    const provider = val('snd-embed-provider'), model = shouldAutoReplaceEmbeddingModel(val('snd-embed-model')) ? defaultModelForEmbedding(provider) : val('snd-embed-model');
    await updateSoundSettings({ embed: { ...soundData().settings.embed, provider, model } }); set('snd-embed-model', soundData().settings.embed.model);
  }));
  for (const [id, field] of [['snd-embed-model', 'model'], ['snd-embed-key', 'key'], ['snd-embed-endpoint', 'endpoint']] as const)
    el(id)?.addEventListener('change', () => run(() => updateSoundSettings({ embed: { ...soundData().settings.embed, [field]: val(id).trim() } })));
  el('snd-embed-test')?.addEventListener('click', () => run(async () => {
    const settings = soundEmbedSettings(soundData().settings, ttsData().settings);
    if (!settings) { text('snd-embed-status', 'API 키가 없습니다. 키를 넣거나, OpenRouter라면 JEV 키를 넣어 주세요.'); return; }
    text('snd-embed-status', '확인하는 중…');
    try { const result = await testEmbedding(settings); text('snd-embed-status', `연결됨 · ${result.model} · ${result.dims}차원`); }
    catch (error) { text('snd-embed-status', String((error as Error).message || error)); }
  }));
  el('snd-rule-add').addEventListener('click', () => run(async () => {
    const rule: SfxRule = { id: uuid(), name: '새 규칙', open: '*', close: '*', enabled: false };
    await updateSoundSettings({ sfxRules: [...soundData().settings.sfxRules, rule] }); renderRules();
  }));
  el('snd-settings-export').addEventListener('click', () => download(exportableSoundSettings(soundData().settings), `${SOUND_SETTINGS_FILE}.json`));
  el('snd-settings-import').addEventListener('click', () => input('snd-settings-file').click());
  el('snd-settings-file').addEventListener('change', () => run(async () => {
    const file = input('snd-settings-file').files?.[0]; if (!file) return;
    input('snd-settings-file').value = '';
    await importSoundSettings(await readJson(file));
    notify('BGM·효과음 설정을 불러왔습니다.');
  }));
  // Outside changes show (⚡ turning BGM on, an imported file).
  unsubscribe?.();
  unsubscribe = subscribeSound(() => { if (!el('snd-bgm-gate')?.isConnected) { unsubscribe?.(); unsubscribe = undefined; return; } paintSoundSettings(false); });
  paintSoundSettings();
  clearInterval(cueTimer); cueTimer = setInterval(renderCueStatus, 2000); renderCueStatus();
}
