import type { TtsCharacter, TtsSettings, TtsVoice } from '../core/tts-types';
import { ttsData, saveTtsData, updateTtsSettings, ttsCandidateVoices } from '../storage/tts-store';
import { blankTtsCharacter, deleteTtsCharacters } from '../services/tts-characters';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { mergeTtsCharacter, ensureTtsRoleCards, resolveTtsRole, TTS_ROLE_NAMES } from '../domain/tts/identity';
import { fishVoiceId, adoptVoiceTags } from '../domain/tts/library';
import { fetchFishVoice } from '../providers/tts/fish';
import { selectTtsVoices } from '../providers/tts/selection';
import { listCharacters } from '../services/characters';
import { GLOBAL_SCOPE } from '../core/constants';
import { unifiedSessionIdForCharacter } from '../core/util/text';
import { getCharRefAssetPreviewUrl } from '../services/char-ref-module';
import { resolveTtsSpeaker, ttsCharacterGain } from '../domain/tts/identity';
import type { CharacterRecord } from '../core/types';
import { el, input, val, set, text, list, characterGender, genderLabel, esc, on, dialog, button, persist, listenButton, auditionButton } from './common';
import type { TtsLibrary } from './library';
import { uuid } from '../core/util/text';
import { characterAvatar, roleAvatar } from './character-avatar';

/** The popup's model list: '' follows the model settings; anything else is typed under 직접 입력. */
const MODEL_CHOICES = ['', 's2.1-pro', 's2.1-pro-free', 's2-pro', 's1', 'drama-3'];

function characterVoice(character: Pick<TtsCharacter, 'voiceKey' | 'fishId'>): TtsVoice | undefined {
  const id = fishVoiceId(character.fishId);
  const voices = ttsData().voices;
  return voices.find(v => v.key === character.voiceKey && (!id || fishVoiceId(v.fishId) === id))
    || (id ? voices.find(v => fishVoiceId(v.fishId) === id) : undefined);
}

export class TtsCharacters {
  context?: TtsChatContext;
  private draft?: TtsCharacter;
  private batch = false;
  private picked='';
  private anchor='';
  private selected = new Set<string>();
  private references: CharacterRecord[] = [];
  private visibility?: IntersectionObserver;
  private imageRoot?: HTMLElement;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saveRevision = 0;
  constructor(private library: TtsLibrary, private tab: (name: string) => void) {}
  dispose(): void { this.visibility?.disconnect(); void this.flushSave(); }
  /** Role cards lead the list (this bot's pair, then the global pair); everyone else keeps roster order. */
  visible(): TtsCharacter[] { const rank = (c: TtsCharacter) => c.role ? (c.scope === 'global' ? 2 : 0) + (c.role === 'monologue' ? 1 : 0) : 4; return this.matching().map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(r => r.c); }
  private matching(): TtsCharacter[] { const q = val('char-search').toLocaleLowerCase(); return ttsData().characters.filter(c => !(c.role && c.scope === 'global' && this.context && val('char-scope-filter') === 'all') && (c.scope === 'global' || c.scope === this.context?.rosterScope) && (val('char-scope-filter') === 'all' || c.scope === (val('char-scope-filter') === 'global' ? 'global' : this.context?.rosterScope)) && [c.name, ...c.triggers, ...c.tags].some(s => s.toLocaleLowerCase().includes(q))); }
  render(): void {
    const root = el('character-list'); if (!root) return;
    if (this.imageRoot !== root) {
      this.visibility?.disconnect(); this.imageRoot = root;
      this.visibility = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) {
        this.visibility?.unobserve(entry.target); const tile = entry.target as HTMLElement, hash = tile.dataset.ref;
        if (hash) void getCharRefAssetPreviewUrl(hash).then(url => {
          if (tile.isConnected && tile.dataset.ref === hash && url) { tile.dataset.imageRef = hash; tile.style.backgroundImage = `linear-gradient(transparent 40%,rgba(12,16,26,.85)),url(${JSON.stringify(url)})`; }
        }).catch(() => {});
      } }, {root,rootMargin:'150px'});
    }
    const refRoster = this.references.map(r => ({...blankTtsCharacter('global',r.name), id:r.id, surname:r.surname,givenName:r.given_name,surnameAliases:r.surname_variants,givenAliases:r.given_name_variants,triggers:r.aliases}));
    const visible=this.visible();
    const ids = new Set(visible.map(c => c.id)), tiles = new Map<string, HTMLElement>();
    for (const node of [...root.children] as HTMLElement[]) {
      if (node.dataset.characterId && ids.has(node.dataset.characterId)) tiles.set(node.dataset.characterId,node);
      else { this.visibility?.unobserve(node); node.remove(); }
    }
    if(!visible.length){const empty=document.createElement('p');empty.className='char-empty';empty.textContent=ttsData().characters.length?'현재 검색·범위에 일치하는 캐릭터가 없습니다.':'등록된 캐릭터가 없습니다. + 캐릭터 또는 LLM한테 시키기로 추가하세요.';root.append(empty);}
    let cursor = root.firstElementChild;
    for (const c of visible) {
      const voiceOwner = this.effective(c), voice = characterVoice(voiceOwner);
      const selected=this.batch?this.selected.has(c.id):this.picked===c.id;
      const tile = tiles.get(c.id) || this.createTile(c.id);
      tile.className = 'char-card' + (selected ? ' tile-selected' : '');tile.setAttribute('aria-pressed',String(selected));tile.setAttribute('aria-label',`${c.name} · ${this.batch?'음성 배정 대상 선택':'선택 후 다시 누르면 편집'}`);
      const voiceName=voice?.name || (voiceOwner.fishId ? '직접 지정 음성' : '음성 미지정');
      const check = tile.querySelector<HTMLElement>('.char-batch-check')!; check.hidden = !this.batch; check.textContent = selected ? '✓' : '';
      const triggers = JSON.stringify(c.triggers); if (tile.dataset.triggers !== triggers) { tile.dataset.triggers = triggers; tile.querySelector('.char-triggers')!.innerHTML = c.triggers.map(t => `<span>${esc(t)}</span>`).join(''); }
      const scopeLabel = tile.querySelector<HTMLElement>('.scope-label')!; scopeLabel.hidden = c.scope !== 'global' && !c.role;
      const scopeText = c.role ? (c.scope === 'global' ? '글로벌 · 기본 카드' : c.followGlobal !== false ? '현재 봇 · 글로벌 따라감' : '현재 봇 · 별도 설정') : '글로벌';
      if (scopeLabel.textContent !== scopeText) scopeLabel.textContent = scopeText;
      const name = tile.querySelector('b')!; if (name.textContent !== c.name) name.textContent = c.name;
      const label = tile.querySelector<HTMLElement>('.char-voice-label')!; if (label.textContent !== voiceName) label.textContent = voiceName; label.title = voiceName;
      const match = c.role ? null : resolveTtsSpeaker(c.name,refRoster,'global') || c.triggers.map(t => resolveTtsSpeaker(t,refRoster,'global')).find(Boolean);
      const reference = match && this.references.find(r=>r.id===match.id);
      // The reference image identifies the character best; an example look is the fallback.
      const hash = reference?.ref_hash || reference?.example_hash || '';
      if (tile.dataset.ref !== hash) { this.visibility?.unobserve(tile); tile.dataset.ref = hash; tile.dataset.imageRef = ''; tile.dataset.avatarGender = ''; if (hash) this.visibility?.observe(tile); }
      const avatarKey = c.role || c.gender;
      if (!tile.dataset.imageRef && tile.dataset.avatarGender !== avatarKey) { tile.dataset.avatarGender = avatarKey; tile.style.backgroundImage = c.role ? roleAvatar(c.role) : characterAvatar(c.gender === 'other' ? 'unknown' : c.gender); }
      // Keep the existing image node connected when only text or selection changes.
      if (tile !== cursor) root.insertBefore(tile,cursor);
      cursor = tile.nextElementSibling;
    }
    const folderSelect = el<HTMLSelectElement>('character-jev-folder');
    if (folderSelect) {
      const folders = JSON.stringify(ttsData().folders);
      if (folderSelect.dataset.folders !== folders) { folderSelect.dataset.folders = folders; folderSelect.innerHTML = `<option value="*">전체 폴더</option><option value="">미분류</option>${ttsData().folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}`; }
      folderSelect.value = ttsData().settings.characterFolder; if (folderSelect.value !== ttsData().settings.characterFolder) folderSelect.value = '*';
    }
    el('character-batch-tools').hidden = !this.batch;
    text('character-jev-count',this.batch?`선택 ${this.selected.size}명`:`캐릭터 ${visible.length}명`);
    text('batch-jev-characters',this.batch?'선택 끝내기':'선택 모드');
    for (const id of ['character-jev-apply','character-delete-selected','character-jev-clear']) input(id).disabled = !this.selected.size;
    el('batch-jev-characters').setAttribute('aria-pressed',String(this.batch));
    const targets = this.targets();
    input('character-toolbar-delete').disabled = !targets.some(c => !c.role); input('character-toolbar-copy').disabled = !targets.some(c => !c.role);
  }
  /** Toolbar actions act on the selection while selecting, otherwise on the picked tile. */
  private targets(): TtsCharacter[] { return ttsData().characters.filter(c => this.batch ? this.selected.has(c.id) : c.id === this.picked); }
  private createTile(id: string): HTMLElement {
    const tile = document.createElement('div'); tile.dataset.characterId = id; tile.tabIndex = 0; tile.setAttribute('role','button');
    tile.style.backgroundSize = 'cover'; tile.style.backgroundPosition = 'center';
    tile.innerHTML = '<span class="char-batch-check" hidden></span><div class="char-triggers"></div><div class="char-head"><div><small class="scope-label">글로벌</small><b></b><span class="char-voice-label"></span></div></div>';
    const current = () => ttsData().characters.find(c => c.id === id);
    const listen = listenButton(() => { const own = current(), c = own && this.effective(own); return { fishId: c ? c.fishId || characterVoice(c)?.fishId || '' : '', gain: c ? ttsCharacterGain(c) : 0 }; }); listen.classList.add('tile-audition'); tile.append(listen);
    const act = (event: MouseEvent | KeyboardEvent) => {
      const c = current(); if (!c || !ttsData().settings.enabled) return;
      if (this.batch) {
        const visible = this.visible(), from = visible.findIndex(c => c.id === this.anchor), to = visible.findIndex(c => c.id === id);
        if (event.shiftKey && from >= 0 && to >= 0) visible.slice(Math.min(from,to),Math.max(from,to)+1).forEach(c => this.selected.add(c.id));
        else { if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); this.anchor = id; }
        this.render();
      } else if (this.picked === id) this.edit(c); else { this.picked = id; this.render(); }
    };
    tile.addEventListener('click',event => { if (!(event.target as Element).closest('.tile-audition')) act(event); });
    tile.addEventListener('keydown',event => { if (event.target === tile && ['Enter',' '].includes(event.key)) { event.preventDefault(); act(event); } });
    return tile;
  }
  edit(character?: TtsCharacter): void {
    this.draft = structuredClone(character || blankTtsCharacter(this.context?.rosterScope || 'global'));
    const c = this.draft, voice = characterVoice(c);
    if (voice) { c.voiceKey = voice.key; c.fishId = voice.fishId; }
    for (const [id, value] of Object.entries({ 'c-name':c.name, 'c-gender':genderLabel(c.gender), 'c-triggers':c.triggers.join(', '), 'c-tags':c.tags.join(', '), 'c-surname':c.surname, 'c-given_name':c.givenName, 'c-surname_variants':c.surnameAliases.join(', '), 'c-given_name_variants':c.givenAliases.join(', '), 'c-id':c.fishId, 'c-scope':c.scope === 'global' ? 'global' : 'chat', 'c-gain':c.gain, 'c-lock':String(c.fixed) })) set(id,value);
    const language = c.language || '';
    set('c-language', ['', 'original', 'en', 'ja', 'ko'].includes(language) ? language : 'custom'); set('c-language-custom', ['', 'original', 'en', 'ja', 'ko'].includes(language) ? '' : language);
    el('c-language-custom-wrap').hidden = val('c-language') !== 'custom';
    this.fillToneModel(c);
    const autoGain = c.autoGain ?? c.gain === 0;
    input('c-gain-manual').checked = !autoGain; input('c-gain').disabled = autoGain;
    text('c-gain-value', autoGain ? '자동' : `${c.gain} dB`); el('character-voice-suggestions').replaceChildren(); el('character-voice-suggestions').hidden = true;
    text('character-voice-choice',voice?.name || '직접 지정');
    const role = c.role, form = el('character-form');
    form.dataset.role = role || '';
    // A role card is only a voice: its name, triggers, scope and lock are fixed.
    for (const node of [el('c-name').closest('label'), el('c-triggers').closest('label'), form.querySelector('.identity-fields'), el('c-scope').closest('label'), el('c-lock').closest('label')]) if (node) (node as HTMLElement).hidden = !!role;
    el('c-follow-global-wrap').hidden = !role || c.scope === 'global'; el('c-follow-char-wrap').hidden = !role;
    input('c-follow-global').checked = c.followGlobal !== false;
    el('c-follow-char').innerHTML = '<option value="">따라가지 않음 · 이 카드의 음성</option>' + ttsData().characters.filter(x => !x.role && (x.scope === 'global' || x.scope === c.scope)).map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    set('c-follow-char', c.followId || '');
    const rateValue = c.rate ?? ttsData().settings.rate;
    el('c-rate').innerHTML = [...new Set([...ttsData().settings.rates, rateValue])].sort((a, b) => a - b).map(r => `<option value="${r}">${r}×</option>`).join('');
    set('c-rate', String(rateValue)); input('c-rate-on').checked = c.rate !== undefined; input('c-rate').disabled = c.rate === undefined;
    // A bot card that follows the global one shows the global settings, greyed out and inert.
    const following = !!role && c.scope !== 'global' && c.followGlobal !== false, global = this.globalCard(c);
    if (following && global) this.fillVoiceFields(global);
    this.lockFollowing(following);
    // Role cards show only gender and tags up top, so the pair shares the row instead of squeezing into the 4-column grid.
    const main = form.querySelector<HTMLElement>('.character-main-fields'); if (main) main.style.gridTemplateColumns = role ? '1fr 1fr' : '';
    text('character-dialog-title', role ? `${TTS_ROLE_NAMES[role]} 카드 설정` : '캐릭터 음성 설정');
    el('delete-character').hidden = !character || !!role; dialog('character-dialog');
    text('character-save-status',character ? '수정하면 자동 저장됩니다.' : '이름을 입력하면 자동 저장됩니다.');
  }
  /** The card whose voice is actually heard: a following bot role card sounds like the global one. */
  private effective(c: TtsCharacter): TtsCharacter { return (c.role && resolveTtsRole(c.role, ttsData().characters, c.scope)) || c; }
  private followed(id: string | undefined): TtsCharacter | undefined { return id ? ttsData().characters.find(x => x.id === id && !x.role) : undefined; }
  private voiceLabel(c: TtsCharacter): string {
    const lead = this.followed(c.followId);
    return lead ? `${lead.name} 따라가는 중 · ${characterVoice(lead)?.name || (lead.fishId ? '직접 지정' : '음성 미지정')}` : characterVoice(c)?.name || (c.fishId ? '직접 지정' : '음성 미지정');
  }
  private globalCard(c: TtsCharacter): TtsCharacter | undefined { return c.role ? ttsData().characters.find(x => x.role === c.role && x.scope === 'global') : undefined; }
  /** Writes a card's voice, tags, gain, language and speed into the popup controls. */
  private fillVoiceFields(src: TtsCharacter): void {
    set('c-id', src.fishId); set('c-tags', src.tags.join(', ')); set('c-gender', genderLabel(src.gender));
    const language = src.language || '', known = ['', 'original', 'en', 'ja', 'ko'].includes(language);
    set('c-language', known ? language : 'custom'); set('c-language-custom', known ? '' : language); el('c-language-custom-wrap').hidden = val('c-language') !== 'custom';
    const auto = src.autoGain ?? src.gain === 0;
    input('c-gain-manual').checked = !auto; input('c-gain').disabled = auto; set('c-gain', src.gain); text('c-gain-value', auto ? '자동' : `${src.gain} dB`);
    const rate = src.rate ?? ttsData().settings.rate, rates = el<HTMLSelectElement>('c-rate');
    if (![...rates.options].some(o => Number(o.value) === rate)) rates.add(new Option(`${rate}×`, String(rate)));
    set('c-rate', String(rate)); input('c-rate-on').checked = src.rate !== undefined; rates.disabled = src.rate === undefined;
    set('c-follow-char', src.followId || ''); text('character-voice-choice', this.voiceLabel(src)); this.fillToneModel(src);
  }
  /** The card's own base delivery and model; a model not in the list shows as typed. */
  private fillToneModel(src: TtsCharacter): void {
    const model = (src.model || '').trim(), known = MODEL_CHOICES.includes(model);
    set('c-tone', src.tone || ''); set('c-model', known ? model : 'custom'); set('c-model-custom', known ? '' : model);
    el('c-model-custom-wrap').hidden = val('c-model') !== 'custom';
  }
  private readToneModel(): { tone?: string; model?: string } {
    const tone = val('c-tone').trim(), model = (val('c-model') === 'custom' ? val('c-model-custom') : val('c-model')).trim();
    return { tone: tone || undefined, model: model || undefined };
  }
  private lockFollowing(locked: boolean): void {
    for (const node of el('character-form').querySelectorAll<HTMLElement>('.fields > *')) { if (node.id === 'c-follow-global-wrap') continue; node.inert = locked; node.style.opacity = locked ? '.45' : ''; }
  }
  private read(): TtsCharacter {
    if (!this.draft) throw new Error('편집할 캐릭터가 없습니다.');
    if (this.draft.role && this.draft.scope !== 'global' && input('c-follow-global').checked) return { ...this.draft, followGlobal: true };
    const fishId=fishVoiceId(val('c-id')),voice=fishId ? characterVoice({voiceKey:this.draft.voiceKey,fishId}) : undefined;
    const language = val('c-language') === 'custom' ? val('c-language-custom').trim() : val('c-language'), rate = input('c-rate-on').checked ? Number(val('c-rate')) : undefined;
    if (this.draft.role) return { ...this.draft, tags: list(val('c-tags')), gender: characterGender(val('c-gender')), fishId, voiceKey: voice?.key || '', gain: Number(val('c-gain')), autoGain: !input('c-gain-manual').checked, language, rate, ...this.readToneModel(), followGlobal: this.draft.scope === 'global' ? undefined : input('c-follow-global').checked, followId: val('c-follow-char') || undefined };
    return { ...this.draft, name:val('c-name').trim(), surname:val('c-surname').trim(), givenName:val('c-given_name').trim(), surnameAliases:list(val('c-surname_variants')), givenAliases:list(val('c-given_name_variants')), triggers:list([val('c-name'),val('c-triggers')].join(',')), tags:list(val('c-tags')), gender:characterGender(val('c-gender')), fishId,voiceKey:voice?.key||'', scope:val('c-scope') === 'global' ? 'global' : this.context?.rosterScope || 'global', gain:Number(val('c-gain')), fixed:val('c-lock') === 'true', autoGain:!input('c-gain-manual').checked, language, rate, ...this.readToneModel() };
  }
  private save(commitIdentity = false): boolean {
    if (!this.draft || !ttsData().settings.enabled) return false;
    const c = this.read(), raw = val('c-id').trim();
    if (!c.name) { text('character-save-status','이름을 입력해 주세요.'); return false; }
    if (raw && !c.fishId) { text('character-save-status','Fish ID 또는 링크를 확인해 주세요.'); return false; }
    text('character-voice-choice',this.voiceLabel(c));
    try {
      // Typing a temporary name must not merge away another person's record.
      const original = ttsData().characters.some(row=>row.id===c.id);
      const roster = original && (!commitIdentity || c.role) ? ttsData().characters.map(row=>row.id===c.id?c:row) : mergeTtsCharacter(ttsData().characters,c);
      const saved = roster.find(row=>row.id===c.id) || resolveTtsSpeaker(c.name,roster,c.scope);
      if (JSON.stringify(roster) === JSON.stringify(ttsData().characters)) return true;
      ttsData().characters = roster; this.draft = structuredClone(saved || c);
      el('delete-character').hidden = !!c.role;
      this.render(); text('character-save-status','저장 중…');
      this.saveRevision++; clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(()=>{void this.flushSave();},200);
      return true;
    } catch(error) { text('character-save-status',String((error as Error).message)); return false; }
  }
  private async flushSave(): Promise<void> {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    const revision = this.saveRevision, status = el('character-save-status');
    const feedback = (message: string) => { if (revision === this.saveRevision && status?.isConnected && status === el('character-save-status')) status.textContent = message; };
    try { await saveTtsData(); feedback('저장됨'); }
    catch(error) { feedback(`저장 실패: ${String((error as Error).message)}`); }
  }
  private choose(voice: TtsVoice): void { if (!this.draft) return; this.draft.voiceKey = voice.key; set('c-id',voice.fishId); text('character-voice-choice',voice.name); this.save(); }
  async bind(live:()=>boolean=()=>true): Promise<void> {
    try { this.context = await currentTtsContext(); } catch { /* Global library remains usable outside a chat. */ }
    if(!live())return;
    // Narrator and monologue cards always exist: the global pair, and this bot's own pair (following the global one until switched off).
    if (this.context) { const roster = ensureTtsRoleCards(ttsData().characters, this.context.rosterScope, ttsData().voices, '', ttsData().settings.translation.narrationLanguage); if (roster !== ttsData().characters) { ttsData().characters = roster; await persist(); } }
    try { this.references = [...await listCharacters(GLOBAL_SCOPE), ...(this.context ? await listCharacters(unifiedSessionIdForCharacter(this.context.characterId)) : [])]; } catch { /* An absent illustration roster doesn't disable independent TTS. */ }
    if(!live())return;
    const add = el('add-character');
    if (add && !el('character-toolbar-delete')) {
      // Same buttons as the selection bar, next to + 캐릭터 so they are always in reach.
      for (const [id, label, cls] of [['character-toolbar-copy', '복제', ''], ['character-toolbar-delete', '삭제', 'danger']]) { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.textContent = label; if (cls) b.className = cls; b.disabled = true; add.before(b); }
    }
    on('character-toolbar-delete', async () => {
      const doomed = this.targets().filter(c => !c.role);
      if (!doomed.length || !confirm(`캐릭터 ${doomed.length}명을 삭제할까요?\n${doomed.map(c => c.name).join(', ')}`)) return;
      deleteTtsCharacters(doomed); this.selected.clear(); this.picked = ''; this.batch = false; await persist(); this.render();
    });
    on('character-toolbar-copy', async () => {
      const sources = this.targets().filter(c => !c.role); if (!sources.length) return;
      const copies = sources.map(c => { const name = `${c.name} 복제`; return { ...structuredClone(c), id: uuid(), name, triggers: [name] }; });
      // Copies get their own name and trigger word, so they never merge back into the original.
      ttsData().characters.push(...copies); this.selected.clear(); this.batch = false; this.picked = copies.at(-1)!.id;
      await persist(); this.render();
      if (copies.length === 1) this.edit(copies[0]);
    });
    on('add-character', () => this.edit());
    set('char-scope-filter', ttsData().settings.characterFilter);
    on('char-search', () => this.render(), 'input');
    on('char-scope-filter', async () => { this.render(); await updateTtsSettings({ characterFilter: val('char-scope-filter') as TtsSettings['characterFilter'] }); }, 'change');
    on('c-gain', () => text('c-gain-value', `${val('c-gain')} dB`), 'input');
    // Automatic loudness owns the volume until it is switched off here.
    el('c-gain-manual')?.addEventListener('change', () => { const auto = !input('c-gain-manual').checked; input('c-gain').disabled = auto; text('c-gain-value', auto ? '자동' : `${val('c-gain')} dB`); });
    // Switching following off starts from the global voice (unless the card already has its own); on shows the global one again.
    el('c-follow-global')?.addEventListener('change', () => {
      const draft = this.draft; if (!draft?.role) return;
      const global = this.globalCard(draft), on = input('c-follow-global').checked;
      if (global && (on || !draft.fishId)) this.fillVoiceFields(global);
      this.lockFollowing(on);
    });
    el('c-follow-char')?.addEventListener('change', () => { if (this.draft) text('character-voice-choice', this.voiceLabel({ ...this.draft, followId: val('c-follow-char') || undefined, fishId: fishVoiceId(val('c-id')) })); });
    el('c-rate-on')?.addEventListener('change', () => { input('c-rate').disabled = !input('c-rate-on').checked; });
    on('character-jev-folder', async () => { await updateTtsSettings({ characterFolder: val('character-jev-folder') }); }, 'change');
    el('c-language')?.addEventListener('change', () => { el('c-language-custom-wrap').hidden = val('c-language') !== 'custom'; });
    el('c-model')?.addEventListener('change', () => { el('c-model-custom-wrap').hidden = val('c-model') !== 'custom'; });
    for (const field of el('character-form').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')) {
      field.addEventListener('input',()=>{if(ttsData().characters.some(c=>c.id===this.draft?.id))this.save();});
      field.addEventListener('change',()=>{this.save(['c-name','c-surname','c-given_name','c-surname_variants','c-given_name_variants'].includes(field.id));});
    }
    const done = () => { if (this.save(true)) { dialog('character-dialog',false); void this.flushSave(); } };
    on('character-form',done,'submit'); on('character-done',done);
    el('character-dialog').addEventListener('close',()=>{void this.flushSave();});
    on('delete-character', async () => { if (!this.draft || !confirm(`${this.draft.name} 캐릭터를 삭제할까요?`)) return; clearTimeout(this.saveTimer); this.saveTimer = undefined; deleteTtsCharacters([this.draft]); this.draft = undefined; await persist(); dialog('character-dialog',false); this.render(); });
    auditionButton(el<HTMLButtonElement>('test-character-editor'), () => {
      // A card that follows another character is heard with that character's voice and loudness.
      const lead = this.draft?.role ? this.followed(val('c-follow-char') || undefined) : undefined;
      // The unsaved base delivery and model are heard too.
      if (lead) return { fishId: lead.fishId || characterVoice(lead)?.fishId || '', gain: ttsCharacterGain(lead), ...this.readToneModel() };
      return { fishId: fishVoiceId(val('c-id')), gain: input('c-gain-manual').checked ? Number(val('c-gain')) : 0, ...this.readToneModel() };
    });
    on('c-fetch', async () => { const info = await fetchFishVoice(val('c-id'),ttsData().settings); set('c-id',info.fishId); set('c-gender',genderLabel(info.gender)); set('c-tags',list([val('c-tags'), ...info.tags].join(',')).join(', ')); text('c-metadata',info.name); this.save(); });
    on('choose-character-voice', () => { this.draft = this.read(); dialog('character-dialog',false); this.library.pickVoice(voice => { this.tab('tts-characters'); dialog('character-dialog'); this.choose(voice); }); });
    for (const engine of ['llm','jev'] as const) on(`recommend-${engine}`, async () => {
      const c = this.read(); text('character-voice-choice','음성 추천 중…');
      const voices = (await selectTtsVoices([c],ttsCandidateVoices(),ttsData().settings,engine)).get(c.id)!;
      if (!list(val('c-tags')).length && voices[0]?.tags.length) set('c-tags', voices[0].tags.join(', '));
      if (characterGender(val('c-gender')) === 'unknown' && voices[0] && voices[0].gender !== 'unknown') set('c-gender', genderLabel(voices[0].gender));
      this.choose(voices[0]); const target = el('character-voice-suggestions'); target.hidden = false; target.replaceChildren();
      for (const voice of voices) { const b = button(voice.name, () => { this.choose(voice); for (const item of target.children) item.setAttribute('aria-pressed',String(item === b)); }); b.setAttribute('aria-pressed',String(voice === voices[0])); target.append(b); }
    });
    on('batch-jev-characters', () => { this.batch = !this.batch; this.selected.clear(); this.render(); });
    on('character-jev-all', () => { this.visible().forEach(c => this.selected.add(c.id)); this.render(); });
    on('character-jev-clear', () => { this.selected.clear(); this.render(); });
    on('character-delete-selected', async () => {
      const doomed = ttsData().characters.filter(c => this.selected.has(c.id) && !c.role);
      if (!doomed.length || !confirm(`선택한 캐릭터 ${doomed.length}명을 삭제할까요?\n${doomed.map(c => c.name).join(', ')}`)) return;
      deleteTtsCharacters(doomed);
      this.selected.clear(); this.batch = false; await persist(); this.render();
    });
    on('character-jev-apply', async () => { const chars = ttsData().characters.filter(c => this.selected.has(c.id)), before = JSON.stringify(chars);
      text('character-jev-count',`${chars.length}명 추천 중…`);
      const result = await selectTtsVoices(chars,ttsCandidateVoices(),ttsData().settings,'jev');
      if (JSON.stringify(ttsData().characters.filter(c => this.selected.has(c.id))) !== before) throw new Error('선택 캐릭터가 바뀌었습니다. 다시 요청해 주세요.');
      for (const c of chars) { const voice = result.get(c.id)![0]; c.voiceKey = voice.key; c.fishId = voice.fishId; adoptVoiceTags(c, voice); } await persist(); this.batch = false; this.render();
    });
    this.render();
  }
}
