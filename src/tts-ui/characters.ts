import type { TtsCharacter, TtsSettings, TtsVoice } from '../core/tts-types';
import { ttsData, saveTtsData, updateTtsSettings, ttsCandidateVoices } from '../storage/tts-store';
import { blankTtsCharacter, deleteTtsCharacters, voiceEmbedding } from '../services/tts-characters';
import { currentTtsContext, ttsCharacterSources, type TtsChatContext } from '../services/tts-context';
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
import { el, input, val, set, text, list, characterGender, genderLabel, esc, on, run, dialog, button, persist, listenButton, auditionButton } from './common';
import type { TtsLibrary } from './library';
import { uuid } from '../core/util/text';
import { sleep } from '../core/util/async';
import { characterAvatar, roleAvatar } from './character-avatar';
import { currentEmotionBot, spriteCostumes } from '../services/emotion-assets';

/**
 * 코스튬에 따라 음성 변경, at the top of the voice page: a costume of the card's illustration character (past the
 * default one) may have a voice of its own, heard on the lines naming it (`이름_2`). Left empty, the card's voice.
 */
const COSTUME_VOICE = '<div id="c-costume-voice-wrap" class="costume-voice"><div class="row"><div class="copy"><b>코스튬에 따라 음성 변경</b><small>대사에 코스튬 번호(이름_2)가 붙은 줄만 그 코스튬의 음성으로 읽습니다. 비워 둔 코스튬은 기본 음성입니다.</small></div><label class="switch"><input type="checkbox" id="c-costume-voice" aria-label="코스튬에 따라 음성 변경"></label></div><div id="c-costume-voice-list" hidden></div></div>';

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
  private openView='';
  /** The card the sheet opened on and the view it opened in, as its 감정 에셋 view was told. */
  private opened = { id: '', view: '' };
  private anchor='';
  private selected = new Set<string>();
  private references: CharacterRecord[] = [];
  private visibility?: IntersectionObserver;
  private imageRoot?: HTMLElement;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saveRevision = 0;
  /** The costume list being read for the card on show: an older read lands on nothing. */
  private costumeEpoch = 0;
  /** The card's costumes on show (past the default): their names and notes go with a costume's voice recommendation. */
  private costumes: Array<{ index: number; name: string; note: string }> = [];
  /** Told when the sheet 옴니 뷰어 opened closes for good; 목소리 고르기 closes it only to come back to it. */
  private sheetDone?: () => void;
  private choosingVoice = false;
  constructor(private library: TtsLibrary, private tab: (name: string) => void) {}
  dispose(): void { this.visibility?.disconnect(); void this.flushSave(); }
  /** Role cards lead the list (this bot's pair, then the global pair); everyone else keeps roster order. */
  visible(): TtsCharacter[] { const rank = (c: TtsCharacter) => c.role ? (c.scope === 'global' ? 2 : 0) + (c.role === 'monologue' ? 1 : 0) : 4; return this.matching().map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(r => r.c); }
  // "하린, 세라": anyone either word names (옴니 뷰어's 👨‍👩‍👧‍👦 searches a reply's people so).
  private matching(): TtsCharacter[] { const terms = val('char-search').split(',').map(t => t.trim().toLocaleLowerCase()).filter(Boolean); return ttsData().characters.filter(c => !(c.role && c.scope === 'global' && this.context && val('char-scope-filter') === 'all') && (c.scope === 'global' || c.scope === this.context?.rosterScope) && (val('char-scope-filter') === 'all' || c.scope === (val('char-scope-filter') === 'global' ? 'global' : this.context?.rosterScope)) && (!terms.length || [c.name, ...c.triggers, ...c.tags].some(s => { const low = s.toLocaleLowerCase(); return terms.some(t => low.includes(t)); }))); }
  /**
   * Opened for some people: they are searched, in every scope (the filter is left as saved).
   * Typed in as by a hand (an input event): the list follows, and so does the × beside the
   * box, which stayed disabled for a value set quietly and cleared nothing.
   */
  showOnly(search: string): void {
    if (search) set('char-scope-filter', 'all');
    const box = input('char-search');
    if (!box) { this.render(); return; }
    box.value = search;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /**
   * 옴니 뷰어: one person's sheet, from their name over a line: their card, else a new one in
   * their name (made only once something on it is set). `done` once it closes for good.
   */
  openSheet(who: { id: string; name: string }, done?: () => void): void {
    const card = ttsData().characters.find(c => c.id === who.id);
    this.choosingVoice = false;
    this.edit(card);
    if (!card) set('c-name', who.name);
    this.sheetDone = done;
  }
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
    const refRoster = this.referenceRoster();
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
      const reference = this.referenceOf(c, refRoster);
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
  /** The illustration characters as TTS cards, matched by their names. */
  private referenceRoster(): TtsCharacter[] {
    return this.references.map(r => ({...blankTtsCharacter('global',r.name), id:r.id, surname:r.surname,givenName:r.given_name,surnameAliases:r.surname_variants,givenAliases:r.given_name_variants,triggers:r.aliases}));
  }
  /** The illustration character a card is (its tile's picture is theirs); none for a role card. */
  private referenceOf(c: TtsCharacter, roster = this.referenceRoster()): CharacterRecord | undefined {
    const match = c.role ? null : resolveTtsSpeaker(c.name,roster,'global') || c.triggers.map(t => resolveTtsSpeaker(t,roster,'global')).find(Boolean);
    return match ? this.references.find(r=>r.id===match.id) : undefined;
  }
  /**
   * 연결된 삽화, beside 음성 | 감정 에셋: pressed, the card's illustration character opens in the settings' 캐릭터 tab
   * (its tag sheet). Greyed when the card is no one there.
   */
  private fillReferenceLink(c: TtsCharacter): void {
    const form = el('character-form'), scroll = form?.querySelector('.editor-scroll');
    if (!form || !scroll) return;
    let link = document.getElementById('c-illustration-link') as HTMLButtonElement | null;
    if (!link) {
      link = document.createElement('button'); link.type = 'button'; link.id = 'c-illustration-link'; link.textContent = '연결된 삽화';
      link.addEventListener('click', () => run(() => this.openReference()));
    }
    // By 감정 에셋 in its row; before that row exists (its page not yet opened), in one of its own.
    const sheetSwitch = scroll.querySelector('.emo-sheet-switch');
    if (sheetSwitch && link.parentElement !== sheetSwitch) { const row = link.closest('[data-sheet-links]'); sheetSwitch.append(link); row?.remove(); }
    else if (!sheetSwitch && !link.isConnected) { const row = document.createElement('div'); row.className = 'actions'; row.dataset.sheetLinks = '1'; row.append(link); scroll.prepend(row); }
    const reference = this.referenceOf(c);
    link.disabled = !reference;
    link.title = reference ? `${reference.name} · 삽화 캐릭터 태그 열기` : '이 캐릭터와 이어진 삽화 캐릭터가 없습니다';
  }
  private async openReference(): Promise<void> {
    const reference = this.draft && this.referenceOf(this.draft);
    if (!reference) return;
    // The frozen UI's own opener: it loads the 캐릭터 tab's roster first when there is none yet.
    const openCast = Reflect.get(globalThis, '__OMNI_OPEN_CAST_EDITOR__'), openTab = Reflect.get(globalThis, '__OMNI_OPEN_SETTINGS__');
    if (typeof openCast !== 'function' && typeof openTab !== 'function') throw new Error('설정 창의 캐릭터 탭을 열 수 없습니다.');
    // Going there, not coming back: a sheet 옴니 뷰어 opened does not take the reader back to the viewer.
    this.sheetDone = undefined;
    dialog('character-dialog', false);
    const target = { id: reference.id, name: reference.name, scope: reference.scope };
    if (typeof openCast === 'function') { await openCast({ ...target, roster: target }); return; }
    await openTab('characters');
    // Its tiles are drawn once the tab is up: looked for a few times.
    for (let i = 0; i < 20; i++) {
      const ux = Reflect.get(globalThis, '__INLAY_SETTINGS_UX__') as { openCharacterEditor?: (target: object) => boolean } | undefined;
      if (ux?.openCharacterEditor?.(target)) return;
      await sleep(150);
    }
    throw new Error(`캐릭터 탭에서 ${reference.name}을(를) 찾지 못했습니다.`);
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
    void this.fillCostumeVoices(c);
    this.fillReferenceLink(c);
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
    this.opened = { id: character?.id || '', view: this.openView }; this.openView = '';
    this.announce();
    text('character-save-status',character ? '수정하면 자동 저장됩니다.' : '이름을 입력하면 자동 저장됩니다.');
  }
  /**
   * The sheet's 감정 에셋 view (emotion-ui) follows the card it is open on. Told again once that view is bound: a sheet
   * 옴니 뷰어 opens is up before it, and its 감정 에셋 showed nobody.
   */
  announce(): void {
    if (el<HTMLDialogElement>('character-dialog')?.open) document.dispatchEvent(new CustomEvent('omnitts-character-open', { detail: this.opened }));
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
  /** 코스튬에 따라 음성 변경: its switch now, the costumes when the illustration character is read (a role card has none). */
  private async fillCostumeVoices(c: TtsCharacter): Promise<void> {
    const wrap = document.getElementById('c-costume-voice-wrap'), list = document.getElementById('c-costume-voice-list'), box = document.getElementById('c-costume-voice') as HTMLInputElement | null;
    if (!wrap || !list || !box) return;
    const mine = ++this.costumeEpoch;
    wrap.hidden = !!c.role; box.checked = c.costumeVoice === true; list.hidden = !box.checked; list.innerHTML = '';
    if (c.role) return;
    const bot = await currentEmotionBot().catch(() => null);
    const costumes = bot ? (await spriteCostumes(c, bot).catch(() => [])).filter(x => x.index > 0) : [];
    if (mine !== this.costumeEpoch) return;
    this.costumes = costumes;
    // Each picked like the card's own voice: by JEV, the LLM or embedding, from the voice list, or emptied (✕).
    const picks = (index: number) => [['jev', 'JEV', 'JEV로 고르기'], ['llm', 'LLM', 'LLM으로 고르기'], ['embedding', 'E.B', '임베딩으로 고르기'], ['list', 'LIST', '음성 목록에서 고르기'], ['clear', '✕', '비우기 · 기본 음성']]
      .map(([how, label, title]) => `<button type="button" data-costume-pick="${how}" data-costume="${index}" title="${title}" aria-label="${index}번 코스튬 음성 ${title}">${label}</button>`).join('');
    list.innerHTML = costumes.length
      ? `<div class="fields">${costumes.map(x => { const fish = c.costumeFish?.[String(x.index)] || ''; return `<div class="field full costume-voice-row"><span>${x.index}번 · ${esc(x.name)}</span><div class="costume-voice-line"><input data-costume-fish="${x.index}" maxlength="128" placeholder="비우면 기본 음성 · Fish ID 또는 링크" aria-label="${x.index}번 코스튬 음성" value="${esc(fish)}">${picks(x.index)}</div><small data-costume-voice-name="${x.index}">${esc(fish ? ttsData().voices.find(v => v.fishId === fish)?.name || '' : '')}</small></div>`; }).join('')}</div>`
      : '<small>삽화 캐릭터 탭에서 이 캐릭터에 코스튬을 더하면, 코스튬마다 음성을 넣을 수 있습니다.</small>';
  }
  /**
   * The switch and each costume's voice, over what the card had: a costume not listed now (its list still being
   * read, or gone from the illustration character) keeps its voice. null: a voice that is no Fish ID or link.
   */
  private readCostumeVoices(): Pick<TtsCharacter, 'costumeVoice' | 'costumeFish'> | null {
    const fish: Record<string, string> = { ...(this.draft?.costumeFish || {}) };
    for (const field of document.querySelectorAll<HTMLInputElement>('#c-costume-voice-list [data-costume-fish]')) {
      const raw = field.value.trim(), id = fishVoiceId(raw), costume = field.dataset.costumeFish || '';
      if (raw && !id) return null;
      if (id) fish[costume] = id; else delete fish[costume];
    }
    return { costumeVoice: (document.getElementById('c-costume-voice') as HTMLInputElement | null)?.checked || undefined, costumeFish: Object.keys(fish).length ? fish : undefined };
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
    return { ...this.draft, ...this.readCostumeVoices(), name:val('c-name').trim(), surname:val('c-surname').trim(), givenName:val('c-given_name').trim(), surnameAliases:list(val('c-surname_variants')), givenAliases:list(val('c-given_name_variants')), triggers:list([val('c-name'),val('c-triggers')].join(',')), tags:list(val('c-tags')), gender:characterGender(val('c-gender')), fishId,voiceKey:voice?.key||'', scope:val('c-scope') === 'global' ? 'global' : this.context?.rosterScope || 'global', gain:Number(val('c-gain')), fixed:val('c-lock') === 'true', autoGain:!input('c-gain-manual').checked, language, rate, ...this.readToneModel() };
  }
  private save(commitIdentity = false): boolean {
    if (!this.draft || !ttsData().settings.enabled) return false;
    const c = this.read(), raw = val('c-id').trim();
    if (!c.name) { text('character-save-status','이름을 입력해 주세요.'); return false; }
    if (raw && !c.fishId) { text('character-save-status','Fish ID 또는 링크를 확인해 주세요.'); return false; }
    if (!c.role && !this.readCostumeVoices()) { text('character-save-status','코스튬 음성의 Fish ID 또는 링크를 확인해 주세요.'); return false; }
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
  /** A costume's voice set (or emptied back to the card's): its field, the voice's name under it, saved. */
  private chooseCostume(index: number, voice: TtsVoice | null, note = voice?.name || ''): void {
    const field = document.querySelector<HTMLInputElement>(`#c-costume-voice-list [data-costume-fish="${index}"]`), named = document.querySelector(`#c-costume-voice-list [data-costume-voice-name="${index}"]`);
    if (named) named.textContent = note;
    if (!field || !voice && note) return;
    field.value = voice?.fishId || ''; this.save();
  }
  /** The chat's author's notes for a pick from this window. Just those: a batch repeats them in every question to JEV. */
  private jevNotes(engine: string): Promise<Record<string, unknown>> | undefined {
    return engine === 'jev' && this.context ? ttsCharacterSources(this.context, { lore: false, persona: false, illustration: false, note: true }) : undefined;
  }
  /** Recommended the way the card's own voice is, with the costume's name and note asked along with the card's. */
  private async recommendCostume(index: number, engine: 'jev' | 'llm' | 'embedding'): Promise<void> {
    const c = this.read(), costume = this.costumes.find(x => x.index === index);
    if (!costume) return;
    this.chooseCostume(index, null, '음성 추천 중…');
    const asked: TtsCharacter = { ...c, id: `${c.id}#costume${index}`, name: `${c.name} (${costume.name})`, tags: [...new Set([...c.tags, costume.name, costume.note].filter(Boolean))] };
    try {
      const voices = (await selectTtsVoices([asked], ttsCandidateVoices(), ttsData().settings, engine, await this.jevNotes(engine), engine === 'embedding' ? await voiceEmbedding() : null)).get(asked.id) || [];
      if (voices[0]) this.chooseCostume(index, voices[0]); else this.chooseCostume(index, null, '');
    } catch (error) { this.chooseCostume(index, null, ''); throw error; }
  }
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
    // 감정 에셋 page → this card's sheet, opened on its faces.
    document.addEventListener('omnitts-open-character', event => { const detail = (event as CustomEvent<{ id?: string; view?: string }>).detail || {}; const c = ttsData().characters.find(x => x.id === detail.id); if (c) { this.openView = detail.view || ''; this.edit(c); } });
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
    // 코스튬에 따라 음성 변경 heads the voice page, under 음성 | 감정 에셋 when that switch is already there.
    const scroll = el('character-form').querySelector('.editor-scroll'), sheetSwitch = scroll?.querySelector('.emo-sheet-switch');
    if (scroll && !el('c-costume-voice-wrap')) { if (sheetSwitch) sheetSwitch.insertAdjacentHTML('afterend', COSTUME_VOICE); else scroll.insertAdjacentHTML('afterbegin', COSTUME_VOICE); }
    el('c-costume-voice')?.addEventListener('change', () => { el('c-costume-voice-list').hidden = !input('c-costume-voice').checked; });
    // Its costume fields come and go with the card: listened to where they are put.
    el('c-costume-voice-list')?.addEventListener('input', event => { if ((event.target as Element).matches('[data-costume-fish]') && ttsData().characters.some(c => c.id === this.draft?.id)) this.save(); });
    el('c-costume-voice-list')?.addEventListener('change', event => { if ((event.target as Element).matches('[data-costume-fish]')) this.save(); });
    el('c-costume-voice-list')?.addEventListener('click', event => {
      const pick = (event.target as Element).closest<HTMLButtonElement>('[data-costume-pick]');
      if (!pick || !this.draft) return;
      event.preventDefault();
      const index = Number(pick.dataset.costume), how = pick.dataset.costumePick;
      if (how === 'clear') { this.chooseCostume(index, null); return; }
      // As the card's own 음성 목록에서 선택: the sheet steps aside for the voice list and comes back to it.
      if (how === 'list') { this.draft = this.read(); this.choosingVoice = true; dialog('character-dialog',false); this.library.pickVoice(voice => { this.choosingVoice = false; this.tab('tts-characters'); dialog('character-dialog'); this.chooseCostume(index, voice); }); return; }
      if (how === 'jev' || how === 'llm' || how === 'embedding') run(() => this.recommendCostume(index, how));
    });
    for (const field of el('character-form').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')) {
      field.addEventListener('input',()=>{if(ttsData().characters.some(c=>c.id===this.draft?.id))this.save();});
      field.addEventListener('change',()=>{this.save(['c-name','c-surname','c-given_name','c-surname_variants','c-given_name_variants'].includes(field.id));});
    }
    const done = () => { if (this.save(true)) { dialog('character-dialog',false); void this.flushSave(); } };
    on('character-form',done,'submit'); on('character-done',done);
    el('character-dialog').addEventListener('close',()=>{
      void this.flushSave();
      if (this.choosingVoice) return;
      const done = this.sheetDone; this.sheetDone = undefined; done?.();
    });
    on('delete-character', async () => { if (!this.draft || !confirm(`${this.draft.name} 캐릭터를 삭제할까요?`)) return; clearTimeout(this.saveTimer); this.saveTimer = undefined; deleteTtsCharacters([this.draft]); this.draft = undefined; await persist(); dialog('character-dialog',false); this.render(); });
    auditionButton(el<HTMLButtonElement>('test-character-editor'), () => {
      // A card that follows another character is heard with that character's voice and loudness.
      const lead = this.draft?.role ? this.followed(val('c-follow-char') || undefined) : undefined;
      // The unsaved base delivery and model are heard too.
      if (lead) return { fishId: lead.fishId || characterVoice(lead)?.fishId || '', gain: ttsCharacterGain(lead), ...this.readToneModel() };
      return { fishId: fishVoiceId(val('c-id')), gain: input('c-gain-manual').checked ? Number(val('c-gain')) : 0, ...this.readToneModel() };
    });
    on('c-fetch', async () => { const info = await fetchFishVoice(val('c-id'),ttsData().settings); set('c-id',info.fishId); set('c-gender',genderLabel(info.gender)); set('c-tags',list([val('c-tags'), ...info.tags].join(',')).join(', ')); text('c-metadata',info.name); this.save(); });
    on('choose-character-voice', () => { this.draft = this.read(); this.choosingVoice = true; dialog('character-dialog',false); this.library.pickVoice(voice => { this.choosingVoice = false; this.tab('tts-characters'); dialog('character-dialog');this.choose(voice); }); });
    for (const engine of ['llm','jev','embedding'] as const) on(`recommend-${engine}`, async () => {
      const c = this.read(); text('character-voice-choice','음성 추천 중…');
      const voices = (await selectTtsVoices([c],ttsCandidateVoices(),ttsData().settings,engine,await this.jevNotes(engine),engine === 'embedding' ? await voiceEmbedding() : null)).get(c.id)!;
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
      const result = await selectTtsVoices(chars,ttsCandidateVoices(),ttsData().settings,'jev',await this.jevNotes('jev'));
      if (JSON.stringify(ttsData().characters.filter(c => this.selected.has(c.id))) !== before) throw new Error('선택 캐릭터가 바뀌었습니다. 다시 요청해 주세요.');
      for (const c of chars) { const voice = result.get(c.id)![0]; c.voiceKey = voice.key; c.fishId = voice.fishId; adoptVoiceTags(c, voice); } await persist(); this.batch = false; this.render();
    });
    this.render();
  }
}
