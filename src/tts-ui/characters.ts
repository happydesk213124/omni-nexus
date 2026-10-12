import type { TtsCharacter, TtsVoice } from '../core/tts-types';
import { ttsData } from '../storage/tts-store';
import { blankTtsCharacter } from '../services/tts-characters';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { mergeTtsCharacter } from '../domain/tts/identity';
import { fishVoiceId } from '../domain/tts/library';
import { fetchFishVoice } from '../providers/tts/fish';
import { selectTtsVoices } from '../providers/tts/selection';
import { listCharacters } from '../services/characters';
import { GLOBAL_SCOPE } from '../core/constants';
import { unifiedSessionIdForCharacter } from '../core/util/text';
import { getCharRefAssetPreviewUrl } from '../services/char-ref-module';
import { resolveTtsSpeaker } from '../domain/tts/identity';
import type { CharacterRecord } from '../core/types';
import { el, input, val, set, text, list, gender, genderLabel, esc, on, dialog, button, persist, audition } from './common';
import type { TtsLibrary } from './library';

export class TtsCharacters {
  context?: TtsChatContext;
  private draft?: TtsCharacter;
  private batch = false;
  private selected = new Set<string>();
  private references: CharacterRecord[] = [];
  private visibility?: IntersectionObserver;
  constructor(private library: TtsLibrary, private tab: (name: string) => void) {}
  visible(): TtsCharacter[] { const q = val('char-search').toLocaleLowerCase(); return ttsData().characters.filter(c => (c.scope === 'global' || c.scope === this.context?.scope) && (val('char-scope-filter') === 'all' || c.scope === (val('char-scope-filter') === 'global' ? 'global' : this.context?.scope)) && [c.name, ...c.triggers, ...c.tags].some(s => s.toLocaleLowerCase().includes(q))); }
  render(): void {
    const root = el('character-list'); if (!root) return; root.replaceChildren();
    this.visibility?.disconnect();
    this.visibility = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { this.visibility?.unobserve(entry.target); const tile = entry.target as HTMLElement, hash = tile.dataset.ref; if (hash) void getCharRefAssetPreviewUrl(hash).then(url => { if (tile.isConnected && url) tile.style.backgroundImage = `linear-gradient(transparent 40%,rgba(12,16,26,.85)),url(${JSON.stringify(url)})`; }).catch(() => {}); } }, {root,rootMargin:'150px'});
    const refRoster = this.references.map(r => ({...blankTtsCharacter('global',r.name), id:r.id, surname:r.surname,givenName:r.given_name,surnameAliases:r.surname_variants,givenAliases:r.given_name_variants,triggers:r.aliases}));
    for (const c of this.visible()) {
      const voice = ttsData().voices.find(v => v.key === c.voiceKey);
      const tile = document.createElement('div'); tile.className = 'char-card' + (this.selected.has(c.id) ? ' tile-selected' : ''); tile.tabIndex = 0; tile.setAttribute('role','button');
      tile.innerHTML = `<div class="char-triggers">${c.triggers.slice(0,3).map(t => `<span>${esc(t)}</span>`).join('')}</div><div class="char-head"><div><b>${esc(c.name)}</b><span class="char-voice-label">${esc(voice?.name || (c.fishId ? '직접 지정 음성' : '음성 미지정'))}</span></div></div>`;
      const listen = button('▶ 듣기', () => audition(c.fishId || voice?.fishId || '', c.gain)); listen.className = 'tile-audition'; tile.append(listen);
      const match = resolveTtsSpeaker(c.name,refRoster,'global') || c.triggers.map(t => resolveTtsSpeaker(t,refRoster,'global')).find(Boolean);
      const reference = match && this.references.find(r=>r.id===match.id);
      if (reference) { tile.dataset.ref = reference.example_hash || reference.ref_hash || ''; tile.style.backgroundSize='cover'; tile.style.backgroundPosition='center'; this.visibility.observe(tile); }
      const act = () => { if (!ttsData().settings.enabled) return; if (this.batch) { if (this.selected.has(c.id)) this.selected.delete(c.id); else this.selected.add(c.id); this.render(); } else this.edit(c); };
      tile.addEventListener('click', event => { if (!(event.target as Element).closest('.tile-audition')) act(); }); tile.addEventListener('keydown', event => { if (event.key === 'Enter') act(); }); root.append(tile);
    }
    el('character-jev-bar').hidden = !this.batch; text('character-jev-count',`선택 중 · ${this.selected.size}명`); input('character-jev-apply').disabled = !this.selected.size;
  }
  edit(character?: TtsCharacter): void {
    this.draft = structuredClone(character || blankTtsCharacter(this.context?.scope || 'global'));
    const c = this.draft;
    for (const [id, value] of Object.entries({ 'c-name':c.name, 'c-gender':genderLabel(c.gender), 'c-triggers':c.triggers.join(', '), 'c-tags':c.tags.join(', '), 'c-surname':c.surname, 'c-given_name':c.givenName, 'c-surname_variants':c.surnameAliases.join(', '), 'c-given_name_variants':c.givenAliases.join(', '), 'c-id':c.fishId, 'c-scope':c.scope === 'global' ? 'global' : 'chat', 'c-gain':c.gain, 'c-lock':String(c.fixed) })) set(id,value);
    text('c-gain-value',`${c.gain} dB`); el('character-voice-suggestions').replaceChildren(); el('character-voice-suggestions').hidden = true;
    text('character-voice-choice',ttsData().voices.find(v => v.key === c.voiceKey)?.name || '직접 지정');
    el('delete-character').hidden = !character; dialog('character-dialog');
  }
  private read(): TtsCharacter {
    if (!this.draft) throw new Error('편집할 캐릭터가 없습니다.');
    return { ...this.draft, name:val('c-name').trim(), surname:val('c-surname').trim(), givenName:val('c-given_name').trim(), surnameAliases:list(val('c-surname_variants')), givenAliases:list(val('c-given_name_variants')), triggers:list(val('c-triggers')), tags:list(val('c-tags')), gender:gender(val('c-gender')), fishId:fishVoiceId(val('c-id')), scope:val('c-scope') === 'global' ? 'global' : this.context?.scope || 'global', gain:Number(val('c-gain')), fixed:val('c-lock') === 'true' };
  }
  private choose(voice: TtsVoice): void { if (!this.draft) return; this.draft.voiceKey = voice.key; set('c-id',voice.fishId); text('character-voice-choice',voice.name); }
  async bind(): Promise<void> {
    try { this.context = await currentTtsContext(); } catch { /* Global library remains usable outside a chat. */ }
    try { this.references = [...await listCharacters(GLOBAL_SCOPE), ...(this.context ? await listCharacters(unifiedSessionIdForCharacter(this.context.characterId)) : [])]; } catch { /* An absent illustration roster doesn't disable independent TTS. */ }
    on('add-character', () => this.edit());
    for (const id of ['char-search','char-scope-filter']) on(id, () => this.render(), id === 'char-search' ? 'input' : 'change');
    on('c-gain', () => text('c-gain-value', `${val('c-gain')} dB`), 'input');
    on('character-form', async () => { const c = this.read(); if (!c.name || !c.fishId) throw new Error('이름과 음성을 지정해 주세요.'); ttsData().characters = mergeTtsCharacter(ttsData().characters,c); await persist(); dialog('character-dialog',false); this.render(); }, 'submit');
    on('delete-character', async () => { if (!this.draft || !confirm(`${this.draft.name} 캐릭터를 삭제할까요?`)) return; ttsData().characters = ttsData().characters.filter(c => c.id !== this.draft!.id); await persist(); dialog('character-dialog',false); this.render(); });
    on('test-character-editor', () => audition(fishVoiceId(val('c-id')),Number(val('c-gain'))));
    on('c-fetch', async () => { const info = await fetchFishVoice(val('c-id'),ttsData().settings); set('c-id',info.fishId); set('c-gender',genderLabel(info.gender)); set('c-tags',list([val('c-tags'), ...info.tags].join(',')).join(', ')); text('c-metadata',info.name); });
    on('choose-character-voice', () => { this.draft = this.read(); dialog('character-dialog',false); this.library.pickVoice(voice => { this.tab('tts-characters'); dialog('character-dialog'); this.choose(voice); }); });
    for (const engine of ['llm','jev'] as const) on(`recommend-${engine}`, async () => {
      const c = this.read(); text('character-voice-choice','음성 추천 중…');
      const voices = (await selectTtsVoices([c],ttsData().voices,ttsData().settings,engine)).get(c.id)!;
      this.choose(voices[0]); const target = el('character-voice-suggestions'); target.hidden = false; target.replaceChildren();
      for (const voice of voices) { const b = button(voice.name, () => { this.choose(voice); for (const item of target.children) item.setAttribute('aria-pressed',String(item === b)); }); b.setAttribute('aria-pressed',String(voice === voices[0])); target.append(b); }
    });
    on('batch-jev-characters', () => { this.batch = !this.batch; this.selected.clear(); el('character-jev-folder').innerHTML = `<option value="*">전체 폴더</option><option value="">미분류</option>${ttsData().folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}`; this.render(); });
    on('character-jev-all', () => { this.visible().forEach(c => this.selected.add(c.id)); this.render(); });
    on('character-jev-clear', () => { this.selected.clear(); this.render(); });
    on('character-jev-cancel', () => { this.batch = false; this.selected.clear(); this.render(); });
    on('character-jev-apply', async () => { const chars = ttsData().characters.filter(c => this.selected.has(c.id)), before = JSON.stringify(chars), folder = val('character-jev-folder');
      text('character-jev-count',`${chars.length}명 추천 중…`);
      const result = await selectTtsVoices(chars,ttsData().voices.filter(v => folder === '*' || v.folder === folder),ttsData().settings,'jev');
      if (JSON.stringify(ttsData().characters.filter(c => this.selected.has(c.id))) !== before) throw new Error('선택 캐릭터가 바뀌었습니다. 다시 요청해 주세요.');
      for (const c of chars) { const voice = result.get(c.id)![0]; c.voiceKey = voice.key; c.fishId = voice.fishId; } await persist(); this.batch = false; this.render();
    });
    this.render();
  }
}
