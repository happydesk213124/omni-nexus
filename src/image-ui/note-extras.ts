/**
 * 세션 작가의 노트, grown into two tabs. 세션 keeps the window as it was, with the
 * session's image preset on top; 캐릭터 holds the bot's own note and preset, for
 * every session with that bot. The image preset reads like 샷 태그 수정: the one in
 * use, and tiles in a popup under it; the first tiles follow the bot or Omni
 * instead of adding one. Both tabs pick note presets from the one shared list.
 */

type Request = (path: string, init?: { method: string; body: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
interface Mount {
  panel: HTMLElement; title: HTMLElement; content: HTMLElement; footer: HTMLElement; sid: string; characterId: string; request: Request;
  /** The session tab re-reads the shared note presets after this tab changed them. */
  notePresetsChanged?: () => unknown;
}
interface PresetRow { id: string; name: string; look_preview_url?: string }
interface Effective { id: string; name: string; source: 'session' | 'character' | 'omni' }
interface Bindings { ok?: boolean; character: string; session: string; omni: Effective; character_effective: Effective; effective: Effective; presets: PresetRow[]; error?: { message?: string } }
interface NotePreset { id: string; name: string; prefix: string; suffix: string }

const FOLLOW_CHARACTER = '', FOLLOW_OMNI = 'omni';
const CSS = `
.onx-tabs{flex:none;display:flex;gap:6px;padding:10px 20px 0;border-bottom:1px solid #394358}
.onx-tab{min-height:38px;padding:6px 16px;border:1px solid #394358;border-bottom:0;border-radius:10px 10px 0 0;background:#141c28;color:#9fb0c3;font:650 13px Segoe UI,sans-serif;cursor:pointer}
.onx-tab[aria-selected="true"]{background:#192230;color:#eef3fa;border-color:#5b6a86}
.onx-preset{margin:0 0 16px}
.onx-preset-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin:0 0 6px;font-size:13px;color:#cfd8e3}
.onx-preset-head small{font-size:12px;color:#9fb0c3}
.onx-combo{display:flex;align-items:stretch;width:100%;height:40px;padding:0;border:0;background:none;color:#eef3fa;cursor:pointer;font:13px Segoe UI,sans-serif}
.onx-combo:disabled{opacity:.6;cursor:wait}
.onx-combo-name{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid #394358;border-right:0;border-radius:9px 0 0 9px;background:#192230;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.onx-combo-name img,.onx-combo-name i{flex:none;width:28px;height:28px;border-radius:6px;object-fit:cover;display:grid;place-items:center;font-style:normal;background:#0e1017}
.onx-combo-name span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.onx-combo-caret{flex:0 0 38px;display:grid;place-items:center;border:1px solid #394358;border-radius:0 9px 9px 0;background:#0e1017;font-weight:700}
.onx-spop{position:fixed;inset:0;z-index:1;background:rgba(8,9,13,.35)}
.onx-spop-card{position:fixed;overflow-y:auto;overscroll-behavior:contain;padding:8px;box-sizing:border-box;background:#12141c;border:1px solid #3b4157;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.5)}
.onx-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px}
.onx-tile{position:relative;aspect-ratio:1/1;padding:0;overflow:hidden;border:1px solid #2b2f3d;border-radius:10px;background:#0e1017;color:#fff;cursor:pointer}
.onx-tile img,.onx-tile i{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.onx-tile i{display:grid;place-items:center;font-style:normal;font-size:22px;color:#9fb0c3;background:linear-gradient(160deg,#1b1f2c,#0c0e14)}
.onx-tile span{position:absolute;left:0;right:0;bottom:0;padding:14px 5px 5px;background:linear-gradient(transparent,rgba(0,0,0,.82));font:600 11px/1.2 Segoe UI,sans-serif;text-align:center;text-shadow:0 1px 2px #000;word-break:keep-all;overflow-wrap:anywhere}
.onx-tile.follow{border-style:dashed}
.onx-tile[aria-pressed="true"]{border-color:#b7a4ff;box-shadow:0 0 0 2px #b7a4ff}
.onx-char{flex:0 1 auto;min-height:0;overflow-y:auto;padding:20px;overscroll-behavior:contain}
.onx-note-presets{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.onx-note-presets select{width:100%;min-height:36px}
.onx-note-presets input{flex:1;min-width:120px}
.onx-char-note{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.onx-char-note label{min-width:0;font-size:13px;color:#cfd8e3}
.onx-char-note textarea{display:block;box-sizing:border-box;width:100%;min-height:120px;margin:8px 0 16px;resize:vertical;background:#192230;color:#eee;border:1px solid #394358;border-radius:12px;padding:10px;font:13px/1.45 Segoe UI,sans-serif}
.onx-muted{margin:0 0 12px;font-size:12px;color:#9fb0c3}
@media(max-width:560px){.onx-char-note{grid-template-columns:1fr}.onx-tabs{padding:8px 12px 0}.onx-char{padding:14px}.onx-tiles{grid-template-columns:repeat(auto-fill,minmax(76px,1fr))}}
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const lookUrl = (p?: PresetRow) => /^(?:data:image\/|blob:|https?:)/.test(p?.look_preview_url || '') ? p?.look_preview_url : undefined;

function sourceLabel(source: Effective['source'], choice: string, scope: 'session' | 'character'): string {
  if (scope === 'session' && choice === FOLLOW_CHARACTER) return '캐릭터 따라가기';
  if (source === 'omni') return 'Omni 따라가기';
  return scope === 'session' ? '이 세션' : '이 캐릭터';
}

function presetBar(scope: 'session' | 'character', layer: () => HTMLElement, pick: (choice: string) => Promise<void>) {
  const box = element('div', 'onx-preset'), head = element('div', 'onx-preset-head');
  const combo = element('button', 'onx-combo');
  combo.type = 'button';
  combo.setAttribute('aria-haspopup', 'dialog');
  combo.setAttribute('aria-label', scope === 'session' ? '세션 이미지 프리셋 고르기' : '캐릭터 이미지 프리셋 고르기');
  const name = element('span', 'onx-combo-name'), caret = element('span', 'onx-combo-caret', '▾');
  combo.append(name, caret);
  box.append(head, combo);
  let data: Bindings | null = null;
  let closePop: (() => void) | null = null;

  const choiceOf = (d: Bindings) => scope === 'session' ? d.session : d.character;
  const tiles = (d: Bindings) => {
    const choice = choiceOf(d);
    const specials: Array<[string, string, string]> = scope === 'session'
      ? [[FOLLOW_CHARACTER, '👤', '캐릭터 따라가기'], [FOLLOW_OMNI, '⚛️', 'Omni 따라가기']]
      : [[FOLLOW_CHARACTER, '⚛️', 'Omni 따라가기']];
    const tile = (value: string, label: string, follow: boolean, image?: string, icon?: string) => {
      const button = element('button', 'onx-tile' + (follow ? ' follow' : ''));
      button.type = 'button';
      button.dataset.presetChoice = value;
      button.title = label;
      button.setAttribute('aria-pressed', String(value === choice));
      if (image) { const img = element('img'); img.src = image; img.alt = ''; img.loading = 'lazy'; button.append(img); }
      else button.append(element('i', '', icon || ''));
      button.append(element('span', '', label));
      button.addEventListener('click', () => {
        closePop?.();
        if (value === choice) return;
        combo.disabled = true;
        void pick(value).finally(() => { combo.disabled = false; });
      });
      return button;
    };
    const grid = element('div', 'onx-tiles');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', scope === 'session' ? '세션 이미지 프리셋' : '캐릭터 이미지 프리셋');
    grid.append(
      ...specials.map(([value, icon, label]) => tile(value, label, true, undefined, icon)),
      ...d.presets.map(p => tile(p.id, p.name || '이름 없음', false, lookUrl(p))),
    );
    return grid;
  };

  /** Opens under the box, like 샷 태그 수정's. Picking, the backdrop or Esc closes it. */
  function openPop(): void {
    if (!data || closePop) return;
    const pop = element('div', 'onx-spop'), card = element('div', 'onx-spop-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '이미지 프리셋');
    card.append(tiles(data));
    pop.append(card);
    layer().append(pop);
    const r = combo.getBoundingClientRect();
    const width = Math.min(innerWidth - 16, Math.max(r.width, 380));
    const below = innerHeight - r.bottom - 18;
    card.style.width = width + 'px';
    card.style.left = Math.max(8, Math.min(r.left, innerWidth - width - 8)) + 'px';
    // Too little room below (a phone with the box low on screen): open above instead.
    if (below >= 220 || below >= r.top - 18) { card.style.top = r.bottom + 6 + 'px'; card.style.maxHeight = Math.max(160, below) + 'px'; }
    else { card.style.bottom = innerHeight - r.top + 6 + 'px'; card.style.maxHeight = Math.max(160, r.top - 18) + 'px'; }
    card.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    // PocketRisu puts listeners on document; removal must match the capture flag.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closePop?.(); } };
    document.addEventListener('keydown', onKey, true);
    pop.addEventListener('click', e => { if (e.target === pop) closePop?.(); });
    closePop = () => { document.removeEventListener('keydown', onKey, true); pop.remove(); closePop = null; };
  }
  combo.addEventListener('click', openPop);

  const paint = (next: Bindings) => {
    data = next;
    const shown = scope === 'session' ? next.effective : next.character_effective;
    head.replaceChildren(element('span', '', scope === 'session' ? '세션 이미지 프리셋' : '캐릭터 이미지 프리셋'), element('small', '', sourceLabel(shown.source, choiceOf(next), scope)));
    const image = lookUrl(next.presets.find(p => p.id === shown.id));
    const thumb = image ? Object.assign(element('img'), { src: image, alt: '' }) : element('i', '', '🎨');
    name.replaceChildren(thumb, element('span', '', shown.name || '(없음)'));
    name.title = shown.name || '';
    // An open popup follows the latest list (look images landing late).
    if (closePop) { const card = layer().querySelector('.onx-spop-card'); card?.replaceChildren(tiles(next)); }
  };
  return { box, paint, close: () => closePop?.() };
}

export function mountNoteExtras(ctx: Mount): { flush: () => Promise<boolean> } {
  const { panel, title, content, sid, characterId, request } = ctx;
  if (!document.getElementById('onx-note-extras-css')) {
    const style = element('style'); style.id = 'onx-note-extras-css'; style.textContent = CSS; document.head.append(style);
  }
  // Taller and fixed while tabs switch, so the window does not jump.
  panel.style.height = 'min(960px, 95vh)';
  if (panel.parentElement && innerWidth < 600) panel.parentElement.style.padding = '8px';
  content.style.flex = '1 1 auto';
  const layer = () => panel.parentElement || document.body;

  const status = element('p', 'onx-muted');
  const sessionBar = presetBar('session', layer, choice => save({ session: choice }));
  const characterBar = presetBar('character', layer, choice => save({ character: choice }));
  async function save(change: Record<string, string>): Promise<void> {
    const reply = await request('/v1/preset-bindings', { method: 'POST', body: { character_id: characterId, session_id: sid, ...change } }).catch(() => null) as Bindings | null;
    if (!reply?.ok) { status.textContent = '프리셋을 저장하지 못했습니다' + (reply?.error?.message ? ' · ' + reply.error.message : '.'); return; }
    sessionBar.paint(reply); characterBar.paint(reply);
  }
  content.prepend(sessionBar.box);

  const charPane = element('div', 'onx-char');
  charPane.hidden = true;

  // The note presets, as on the session tab and from the same list.
  let notePresets: NotePreset[] = [];
  let presetBusy = false;
  const group = element('div', 'onx-note-presets');
  const select = element('select'); select.setAttribute('aria-label', '노트 프리셋');
  const presetName = element('input'); presetName.placeholder = '프리셋 이름'; presetName.maxLength = 80; presetName.setAttribute('aria-label', '프리셋 이름');
  const presetSave = element('button', '', '프리셋 저장'), presetDelete = element('button', '', '프리셋 삭제');
  presetSave.type = presetDelete.type = 'button';
  group.append(select, presetName, presetSave, presetDelete);
  const renderNotePresets = (id: string) => {
    select.replaceChildren(new Option('프리셋 선택', ''));
    for (const p of notePresets) select.add(new Option(p.name, p.id));
    if (id && !notePresets.some(p => p.id === id)) select.add(new Option('사용할 수 없는 프리셋', id));
    select.value = id;
    presetName.value = notePresets.find(p => p.id === id)?.name || '';
    presetDelete.disabled = !notePresets.some(p => p.id === id);
  };
  const readNotePresets = async (): Promise<NotePreset[]> => {
    const reply = await request('/v1/session-author-note-presets');
    if (!reply || reply.ok === false) throw new Error('load failed');
    return (Array.isArray(reply.items) ? reply.items : []).map((p: Record<string, unknown>) => ({ id: String(p.id || ''), name: String(p.name || ''), prefix: String(p.prefix || ''), suffix: String(p.suffix || '') }));
  };

  const noteGrid = element('div', 'onx-char-note');
  const fields: Record<'prefix' | 'suffix', HTMLTextAreaElement> = { prefix: element('textarea'), suffix: element('textarea') };
  for (const [key, label] of [['prefix', '캐릭터 작노 선행'], ['suffix', '캐릭터 작노 후행']] as const) {
    const wrap = element('label', '', label);
    fields[key].maxLength = 8000;
    fields[key].disabled = true;
    wrap.append(fields[key]);
    noteGrid.append(wrap);
  }
  charPane.append(element('p', 'onx-muted', '이 캐릭터(봇)의 모든 세션에 적용돼요. 세션 작노가 더 우선이고, 옷 상태는 세션 탭에서 정해요.'), characterBar.box, group, noteGrid, status);
  content.after(charPane);

  const saved = { prefix: '', suffix: '', preset_id: '' };
  let loaded = false;
  const dirty = () => loaded && (fields.prefix.value !== saved.prefix || fields.suffix.value !== saved.suffix || select.value !== saved.preset_id);
  const hint = () => { status.textContent = dirty() ? '닫거나 세션 탭으로 가면 저장돼요.' : ''; };
  for (const field of Object.values(fields)) field.addEventListener('input', hint);
  select.addEventListener('change', () => {
    const p = notePresets.find(p => p.id === select.value);
    presetName.value = p?.name || '';
    if (p) { fields.prefix.value = p.prefix; fields.suffix.value = p.suffix; }
    presetDelete.disabled = !p;
    hint();
  });
  const setPresetControls = (off: boolean) => { select.disabled = presetName.disabled = presetSave.disabled = off; presetDelete.disabled = off || !notePresets.some(p => p.id === select.value); };
  async function mutateNotePresets(remove: boolean): Promise<void> {
    if (presetBusy) return;
    const label = presetName.value.trim();
    if (!remove && !label) { status.textContent = '프리셋 이름을 입력하세요.'; presetName.focus(); return; }
    const selected = select.value;
    presetBusy = true; setPresetControls(true);
    try {
      // Re-read first: the session tab writes the same list.
      const items = await readNotePresets();
      const existing = items.find(p => p.id === selected);
      const id = remove ? selected : (existing?.id || globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const next = items.filter(p => p.id !== id);
      if (!remove) next.push({ id, name: label, prefix: fields.prefix.value, suffix: fields.suffix.value });
      const result = await request('/v1/session-author-note-presets', { method: 'PUT', body: { items: next } });
      if (!result || result.ok === false) throw new Error('save failed');
      notePresets = Array.isArray(result.items) ? result.items as NotePreset[] : next;
      renderNotePresets(remove ? '' : id);
      hint();
      void Promise.resolve(ctx.notePresetsChanged?.()).catch(() => {});
    } catch { status.textContent = '프리셋 저장/삭제 실패 · 다시 시도하세요.'; }
    finally { presetBusy = false; setPresetControls(false); }
  }
  presetSave.addEventListener('click', () => void mutateNotePresets(false));
  presetDelete.addEventListener('click', () => void mutateNotePresets(true));
  async function loadNotePresets(): Promise<void> {
    try { notePresets = await readNotePresets(); renderNotePresets(select.value || saved.preset_id); }
    catch { status.textContent = '노트 프리셋을 불러오지 못했습니다. 노트 편집은 가능합니다.'; }
  }
  renderNotePresets('');

  async function flush(): Promise<boolean> {
    if (!dirty()) return true;
    status.textContent = '캐릭터 노트 저장 중…';
    const body = { character_id: characterId, prefix: fields.prefix.value, suffix: fields.suffix.value, preset_id: select.value };
    const reply = await request('/v1/character-author-note', { method: 'POST', body }).catch(error => ({ ok: false, error: { message: String(error?.message || error) } }));
    if (!reply?.ok) { status.textContent = '캐릭터 노트 저장 실패 · ' + String((reply?.error as { message?: string })?.message || '다시 시도하세요.'); return false; }
    saved.prefix = body.prefix; saved.suffix = body.suffix; saved.preset_id = body.preset_id;
    status.textContent = '저장됨';
    return true;
  }

  const tabs = element('div', 'onx-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButton = (label: string, on: boolean) => {
    const b = element('button', 'onx-tab', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(on)); return b;
  };
  const sessionTab = tabButton('세션', true), characterTab = tabButton('캐릭터', false);
  const show = async (character: boolean) => {
    if (!character && !await flush()) return;
    sessionBar.close(); characterBar.close();
    sessionTab.setAttribute('aria-selected', String(!character));
    characterTab.setAttribute('aria-selected', String(character));
    content.hidden = character;
    charPane.hidden = !character;
    // The session tab may have saved or removed a note preset meanwhile.
    if (character && !presetBusy) await loadNotePresets();
  };
  sessionTab.addEventListener('click', () => void show(false));
  characterTab.addEventListener('click', () => void show(true));
  tabs.append(sessionTab, characterTab);
  if (!characterId) characterTab.hidden = true;
  title.after(tabs);

  void (async () => {
    // Look images are read on demand: the names come first and pictures fill in when they land.
    let got = false;
    const load = async () => {
      const reply = await request(`/v1/preset-bindings?character_id=${encodeURIComponent(characterId)}&session_id=${encodeURIComponent(sid)}`).catch(() => null) as Bindings | null;
      if (reply?.ok) { got = true; sessionBar.paint(reply); characterBar.paint(reply); }
    };
    await load();
    const native = Reflect.get(globalThis, '__INLAY_NATIVE__') as { hydrateSettingsPreviews?: (tab: string) => Promise<boolean> } | undefined;
    if (await native?.hydrateSettingsPreviews?.('style_presets').catch(() => false) && got) await load();
  })();
  if (characterId) void request(`/v1/character-author-note?character_id=${encodeURIComponent(characterId)}`).then(async reply => {
    if (!reply?.ok) { status.textContent = '캐릭터 노트를 불러오지 못했습니다.'; return; }
    saved.prefix = fields.prefix.value = String(reply.prefix || '');
    saved.suffix = fields.suffix.value = String(reply.suffix || '');
    saved.preset_id = String(reply.preset_id || '');
    renderNotePresets(saved.preset_id);
    loaded = true;
    fields.prefix.disabled = fields.suffix.disabled = false;
    await loadNotePresets();
  }).catch(() => { status.textContent = '캐릭터 노트를 불러오지 못했습니다.'; });
  return { flush };
}

export function installNoteExtras(): void {
  Reflect.set(globalThis, '__OMNI_NOTE_EXTRAS__', { mount: mountNoteExtras });
}
