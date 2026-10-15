import type { SfxRule, SoundSettings } from '../core/sound-types';
import { soundData, updateSoundSettings } from '../storage/sound-store';
import { sfxHits, sfxRuleError } from '../domain/sound/audio';
import { pickSfx } from '../domain/sound/match';
import { soundTags } from '../domain/sound/tags';
import { el, input, val, set, text, esc, run } from '../tts-ui/common';
import { uuid } from '../core/util/text';

const percent = (id: string, value: number) => { set(id, Math.round(value * 100)); text(`${id}-value`, `${Math.round(value * 100)}%`); };

function renderRules(): void {
  const host = el('snd-rules'); if (!host) return;
  host.replaceChildren();
  for (const rule of soundData().settings.sfxRules) {
    const line = document.createElement('div'); line.className = 'row snd-rule';
    line.innerHTML = `<label class="switch"><input type="checkbox" ${rule.enabled ? 'checked' : ''} aria-label="${esc(rule.name)} 사용"></label>`
      + `<input class="snd-rule-name" value="${esc(rule.name)}" aria-label="규칙 이름" style="width:110px">`
      + `<input class="snd-rule-pattern" value="${esc(rule.pattern)}" aria-label="정규식" style="flex:1;min-width:0;font-family:monospace">`
      + `<input class="snd-rule-flags" value="${esc(rule.flags)}" aria-label="플래그 (i m s u)" style="width:44px" maxlength="4">`
      + `<button type="button" class="danger" aria-label="규칙 삭제">삭제</button><small class="snd-rule-error" role="alert"></small>`;
    const [on, name, pattern, flags] = [...line.querySelectorAll('input')] as HTMLInputElement[];
    const save = () => run(async () => {
      const error = sfxRuleError(pattern!.value, flags!.value);
      (line.querySelector('.snd-rule-error') as HTMLElement).textContent = error ? `정규식 오류: ${error}` : '';
      if (error) return;
      const rules = soundData().settings.sfxRules.map(r => r.id === rule.id ? { ...r, enabled: on!.checked, name: name!.value.trim() || '규칙', pattern: pattern!.value, flags: flags!.value } : r);
      await updateSoundSettings({ sfxRules: rules }); renderTest();
    });
    for (const field of [on, name, pattern, flags]) field!.addEventListener('change', save);
    line.querySelector('button')!.addEventListener('click', () => run(async () => {
      await updateSoundSettings({ sfxRules: soundData().settings.sfxRules.filter(r => r.id !== rule.id) }); renderRules(); renderTest();
    }));
    host.append(line);
  }
}
/** Shows which words the rules catch in the example and which effect each would play. */
function renderTest(): void {
  const hits = sfxHits(val('snd-rule-test'), soundData().settings.sfxRules);
  text('snd-rule-result', !val('snd-rule-test') ? '' : hits.length
    ? hits.map(hit => `「${hit.word}」 → ${pickSfx(hit.word, soundData().glossary, soundData().sfx)?.name || '미등록'}`).join(' · ')
    : '걸리는 말이 없습니다.');
}

export function bindSoundSettings(): void {
  const s = soundData().settings;
  for (const [id, key] of [['snd-bgm-enabled', 'bgmEnabled'], ['snd-sfx-enabled', 'sfxEnabled'], ['snd-bgm-prompt', 'bgmPrompt']] as const) {
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
  set('snd-max-mb', s.maxFileMb);
  el('snd-max-mb').addEventListener('change', () => run(() => updateSoundSettings({ maxFileMb: Number(val('snd-max-mb')) })));
  for (const [id, key] of [['snd-bgm-matcher', 'bgmMatcher'], ['snd-sfx-matcher', 'sfxMatcher'], ['snd-sfx-auto', 'sfxAutoPlay']] as const) {
    set(id, s[key]);
    el(id).addEventListener('change', () => run(() => updateSoundSettings({ [key]: val(id) } as Partial<SoundSettings>)));
  }
  set('snd-bgm-tags', s.bgmTags.join(', '));
  el('snd-bgm-tags').addEventListener('change', () => run(async () => { await updateSoundSettings({ bgmTags: soundTags(val('snd-bgm-tags')) }); set('snd-bgm-tags', soundData().settings.bgmTags.join(', ')); }));
  el('snd-rule-add').addEventListener('click', () => run(async () => {
    const rule: SfxRule = { id: uuid(), name: '새 규칙', pattern: '\\*([^*\\n]{1,40})\\*', flags: '', enabled: false };
    await updateSoundSettings({ sfxRules: [...soundData().settings.sfxRules, rule] }); renderRules();
  }));
  el('snd-rule-test').addEventListener('input', renderTest);
  renderRules();
}
