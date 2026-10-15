import type { SfxRule, SoundSettings } from '../core/sound-types';
import { soundData, updateSoundSettings } from '../storage/sound-store';
import { sfxHits, sfxMarksProblem } from '../domain/sound/audio';
import { exactSfx, pickSfx } from '../domain/sound/match';
import { sfxParts } from '../domain/sound/combo';
import { soundTags } from '../domain/sound/tags';
import { el, input, val, set, text, esc, run } from '../tts-ui/common';
import { uuid } from '../core/util/text';
import type { CueAudit } from '../services/cue-audit';

const percent = (id: string, value: number) => { set(id, Math.round(value * 100)); text(`${id}-value`, `${Math.round(value * 100)}%`); };

function renderRules(): void {
  const host = el('snd-rules'); if (!host) return;
  host.replaceChildren();
  for (const rule of soundData().settings.sfxRules) {
    const line = document.createElement('div'); line.className = 'row snd-rule';
    // Only the marks: the matching itself is built in (sfxRuleSource), like the dialogue controls.
    const mark = (cls: string, value: string, label: string) => `<input class="${cls}" value="${esc(value)}" aria-label="${label}" placeholder="${label.slice(0, 1)}" maxlength="8" style="width:56px;text-align:center">`;
    line.innerHTML = `<label class="switch"><input type="checkbox" ${rule.enabled ? 'checked' : ''} aria-label="${esc(rule.name)} 사용"></label>`
      + `<input class="snd-rule-name" value="${esc(rule.name)}" aria-label="규칙 이름" style="width:110px">`
      + mark('snd-rule-open', rule.open, '앞 글자') + `<span class="snd-rule-word" aria-hidden="true">효과음</span>` + mark('snd-rule-close', rule.close, '뒤 글자')
      + `<button type="button" class="danger" aria-label="규칙 삭제">삭제</button><small class="snd-rule-error" role="alert"></small>`;
    const [on, name, open, close] = [...line.querySelectorAll('input')] as HTMLInputElement[];
    const save = () => run(async () => {
      const problem = sfxMarksProblem(open!.value, close!.value);
      (line.querySelector('.snd-rule-error') as HTMLElement).textContent = problem;
      if (problem) return;
      const rules = soundData().settings.sfxRules.map(r => r.id === rule.id ? { ...r, enabled: on!.checked, name: name!.value.trim() || '규칙', open: open!.value, close: close!.value } : r);
      await updateSoundSettings({ sfxRules: rules }); renderTest();
    });
    for (const field of [on, name, open, close]) field!.addEventListener('change', save);
    line.querySelector('button')!.addEventListener('click', () => run(async () => {
      await updateSoundSettings({ sfxRules: soundData().settings.sfxRules.filter(r => r.id !== rule.id) }); renderRules(); renderTest();
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
/** Shows which words the rules catch in the example and which effect each would play. */
/** What a word would play: one effect, or a compound's parts joined (unknown parts are asked for when it plays). */
function effectsFor(word: string): string {
  const { glossary, sfx } = soundData(), exact = exactSfx(word, glossary, sfx), parts = sfxParts(word);
  if (exact || parts.length <= 1) return (exact || pickSfx(word, glossary, sfx))?.name || '미등록';
  return parts.map(part => pickSfx(part, glossary, sfx)?.name || '미등록').join(' + ');
}
function renderTest(): void {
  const hits = sfxHits(val('snd-rule-test'), soundData().settings.sfxRules);
  text('snd-rule-result', !val('snd-rule-test') ? '' : hits.length
    ? hits.map(hit => `「${hit.word}」 → ${effectsFor(hit.word)}`).join(' · ')
    : '걸리는 말이 없습니다.');
}

export function bindSoundSettings(): void {
  const s = soundData().settings;
  for (const [id, key] of [['snd-bgm-enabled', 'bgmEnabled'], ['snd-sfx-enabled', 'sfxEnabled'], ['snd-bgm-prompt', 'bgmPrompt'], ['snd-sfx-cue', 'sfxCue'], ['snd-list-bgm', 'listBgm'], ['snd-list-sfx', 'listSfx'], ['snd-sfx-normalize', 'sfxNormalize'], ['snd-sfx-trim', 'sfxTrim'], ['snd-sfx-first', 'sfxFirst']] as const) {
    input(id).checked = s[key];
    el(id).addEventListener('change', () => run(() => updateSoundSettings({ [key]: input(id).checked } as Partial<SoundSettings>)));
  }
  for (const [id, key] of [['snd-bgm-volume', 'bgmVolume'], ['snd-sfx-volume', 'sfxVolume'], ['snd-duck', 'duck']] as const) {
    percent(id, s[key]);
    // The percentage follows the slider while it moves; the value is saved on release.
    el(id).addEventListener('input', () => text(`${id}-value`, `${val(id)}%`));
    el(id).addEventListener('change', () => run(() => updateSoundSettings({ [key]: Number(val(id)) / 100 } as Partial<SoundSettings>)));
  }
  set('snd-crossfade', s.crossfadeMs / 1000);
  el('snd-crossfade').addEventListener('change', () => run(() => updateSoundSettings({ crossfadeMs: Number(val('snd-crossfade')) * 1000 })));
  set('snd-sfx-max', s.sfxMaxSec);
  el('snd-sfx-max').addEventListener('change', () => run(async () => { await updateSoundSettings({ sfxMaxSec: Number(val('snd-sfx-max')) }); set('snd-sfx-max', soundData().settings.sfxMaxSec); }));
  set('snd-max-mb', s.maxFileMb);
  el('snd-max-mb').addEventListener('change', () => run(() => updateSoundSettings({ maxFileMb: Number(val('snd-max-mb')) })));
  for (const [id, key] of [['snd-bgm-matcher', 'bgmMatcher'], ['snd-bgm-basis', 'bgmBasis'], ['snd-sfx-matcher', 'sfxMatcher'], ['snd-sfx-auto', 'sfxAutoPlay']] as const) {
    set(id, s[key]);
    el(id).addEventListener('change', () => run(() => updateSoundSettings({ [key]: val(id) } as Partial<SoundSettings>)));
  }
  input('snd-sfx-autocreate').checked = s.sfxAutoCreate;
  el('snd-sfx-autocreate').addEventListener('change', () => run(() => updateSoundSettings({ sfxAutoCreate: input('snd-sfx-autocreate').checked })));
  set('snd-sfx-prompt', s.sfxPrompt); el('snd-sfx-prompt').addEventListener('change', () => run(() => updateSoundSettings({ sfxPrompt: val('snd-sfx-prompt') })));
  set('snd-sfx-duration', s.sfxDuration); el('snd-sfx-duration').addEventListener('change', () => run(() => updateSoundSettings({ sfxDuration: Number(val('snd-sfx-duration')) || 0 })));
  set('snd-eleven-key', s.elevenKey); el('snd-eleven-key')?.addEventListener('change', () => run(() => updateSoundSettings({ elevenKey: val('snd-eleven-key').trim() })));
  set('snd-bgm-tags', s.bgmTags.join(', '));
  el('snd-bgm-tags').addEventListener('change', () => run(async () => { await updateSoundSettings({ bgmTags: soundTags(val('snd-bgm-tags')) }); set('snd-bgm-tags', soundData().settings.bgmTags.join(', ')); }));
  el('snd-rule-add').addEventListener('click', () => run(async () => {
    const rule: SfxRule = { id: uuid(), name: '새 규칙', open: '*', close: '*', enabled: false };
    await updateSoundSettings({ sfxRules: [...soundData().settings.sfxRules, rule] }); renderRules();
  }));
  el('snd-rule-test').addEventListener('input', renderTest);
  renderRules();
  clearInterval(cueTimer); cueTimer = setInterval(renderCueStatus, 2000); renderCueStatus();
}
