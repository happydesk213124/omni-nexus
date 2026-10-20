/**
 * 세션 작가의 노트, grown into two tabs. 세션 keeps the window as it was, with the
 * session's image preset on top; 캐릭터 holds the bot's own note and preset, for
 * every session with that bot. Presets are picked from tiles as in 샷 태그 수정;
 * the first tiles follow the bot or Omni instead of adding one.
 */

type Request = (path: string, init?: { method: string; body: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
interface Mount { panel: HTMLElement; title: HTMLElement; content: HTMLElement; footer: HTMLElement; sid: string; characterId: string; request: Request }
interface PresetRow { id: string; name: string; look_preview_url?: string }
interface Effective { id: string; name: string; source: 'session' | 'character' | 'omni' }
interface Bindings { ok?: boolean; character: string; session: string; omni: Effective; character_effective: Effective; effective: Effective; presets: PresetRow[]; error?: { message?: string } }

const FOLLOW_CHARACTER = '', FOLLOW_OMNI = 'omni';
const CSS = `
.onx-tabs{flex:none;display:flex;gap:6px;padding:10px 20px 0;border-bottom:1px solid #394358}
.onx-tab{min-height:38px;padding:6px 16px;border:1px solid #394358;border-bottom:0;border-radius:10px 10px 0 0;background:#141c28;color:#9fb0c3;font:650 13px Segoe UI,sans-serif;cursor:pointer}
.onx-tab[aria-selected="true"]{background:#192230;color:#eef3fa;border-color:#5b6a86}
.onx-preset{margin:0 0 16px}
.onx-preset-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:0 0 8px;font-size:13px;color:#9fb0c3}
.onx-preset-head b{color:#eef3fa;font-weight:650}
.onx-tiles{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px;overscroll-behavior-x:contain;scroll-snap-type:x proximity}
.onx-tile{position:relative;flex:0 0 84px;height:112px;padding:0;border:2px solid #394358;border-radius:12px;overflow:hidden;background:#192230;color:#eef3fa;cursor:pointer;scroll-snap-align:start}
.onx-tile img{width:100%;height:100%;object-fit:cover;display:block}
.onx-tile i{display:grid;place-items:center;height:100%;font-style:normal;font-size:26px;color:#9fb0c3}
.onx-tile span{position:absolute;left:0;right:0;bottom:0;padding:14px 4px 4px;background:linear-gradient(transparent,rgba(5,8,14,.92));font:650 11px/1.25 Segoe UI,sans-serif;text-align:center;word-break:keep-all;overflow-wrap:anywhere}
.onx-tile[aria-pressed="true"]{border-color:#8b7bff;box-shadow:0 0 0 2px rgba(139,123,255,.35)}
.onx-tile:disabled{opacity:.6;cursor:wait}
.onx-char{flex:0 1 auto;min-height:0;overflow-y:auto;padding:20px;overscroll-behavior:contain}
.onx-char-note{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.onx-char-note label{min-width:0;font-size:13px;color:#cfd8e3}
.onx-char-note textarea{display:block;box-sizing:border-box;width:100%;min-height:120px;margin-top:4px;resize:vertical;background:#192230;color:#eee;border:1px solid #394358;border-radius:12px;padding:8px;font:13px/1.45 Segoe UI,sans-serif}
.onx-muted{margin:0 0 12px;font-size:12px;color:#9fb0c3}
@media(max-width:560px){.onx-char-note{grid-template-columns:1fr}.onx-tabs{padding:8px 12px 0}.onx-char{padding:14px}}
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function sourceLabel(source: Effective['source'], choice: string, scope: 'session' | 'character'): string {
  if (scope === 'session' && choice === FOLLOW_CHARACTER) return '캐릭터 따라가기';
  if (source === 'omni') return 'Omni 따라가기';
  return scope === 'session' ? '이 세션' : '이 캐릭터';
}

function presetBar(scope: 'session' | 'character', pick: (choice: string) => Promise<void>) {
  const box = element('div', 'onx-preset'), head = element('div', 'onx-preset-head'), tiles = element('div', 'onx-tiles');
  tiles.setAttribute('role', 'group');
  tiles.setAttribute('aria-label', scope === 'session' ? '세션 이미지 프리셋' : '캐릭터 이미지 프리셋');
  box.append(head, tiles);
  let busy = false;
  const paint = (data: Bindings) => {
    const choice = scope === 'session' ? data.session : data.character;
    const shown = scope === 'session' ? data.effective : data.character_effective;
    head.replaceChildren(element('span', '', '이미지 프리셋'), element('span', '', '지금 적용:'), element('b', '', shown.name || '(없음)'), element('span', '', `(${sourceLabel(shown.source, choice, scope)})`));
    const specials: Array<[string, string, string]> = scope === 'session'
      ? [[FOLLOW_CHARACTER, '👤', '캐릭터 따라가기'], [FOLLOW_OMNI, '⚛️', 'Omni 따라가기']]
      : [[FOLLOW_CHARACTER, '⚛️', 'Omni 따라가기']];
    const tile = (value: string, label: string, image?: string, icon?: string) => {
      const button = element('button', 'onx-tile');
      button.type = 'button';
      button.dataset.presetChoice = value;
      button.title = label;
      button.setAttribute('aria-pressed', String(value === choice));
      if (image) { const img = element('img'); img.src = image; img.alt = ''; img.loading = 'lazy'; button.append(img); }
      else button.append(element('i', '', icon || ''));
      button.append(element('span', '', label));
      button.addEventListener('click', async () => {
        if (busy || value === choice) return;
        busy = true;
        for (const other of tiles.querySelectorAll('button')) (other as HTMLButtonElement).disabled = true;
        try { await pick(value); } finally { busy = false; for (const other of tiles.querySelectorAll('button')) (other as HTMLButtonElement).disabled = false; }
      });
      return button;
    };
    tiles.replaceChildren(
      ...specials.map(([value, icon, label]) => tile(value, label, undefined, icon)),
      ...data.presets.map(p => tile(p.id, p.name, /^(?:data:image\/|blob:|https?:)/.test(p.look_preview_url || '') ? p.look_preview_url : undefined)),
    );
  };
  return { box, paint };
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

  let bindings: Bindings | null = null;
  const status = element('p', 'onx-muted');
  const sessionBar = presetBar('session', choice => save({ session: choice }));
  const characterBar = presetBar('character', choice => save({ character: choice }));
  async function save(change: Record<string, string>): Promise<void> {
    const reply = await request('/v1/preset-bindings', { method: 'POST', body: { character_id: characterId, session_id: sid, ...change } }).catch(() => null) as Bindings | null;
    if (!reply?.ok) { status.textContent = '프리셋을 저장하지 못했습니다' + (reply?.error?.message ? ' · ' + reply.error.message : '.'); return; }
    bindings = reply; sessionBar.paint(reply); characterBar.paint(reply);
  }
  content.prepend(sessionBar.box);

  const charPane = element('div', 'onx-char');
  charPane.hidden = true;
  const noteGrid = element('div', 'onx-char-note');
  const fields: Record<'prefix' | 'suffix', HTMLTextAreaElement> = { prefix: element('textarea'), suffix: element('textarea') };
  for (const [key, label] of [['prefix', '선행'], ['suffix', '후행']] as const) {
    const wrap = element('label', '', label);
    fields[key].maxLength = 8000;
    fields[key].disabled = true;
    wrap.append(fields[key]);
    noteGrid.append(wrap);
  }
  charPane.append(element('p', 'onx-muted', '이 캐릭터(봇)의 모든 세션에 적용돼요. 옷 상태는 세션 탭에서 정해요.'), characterBar.box, noteGrid, status);
  content.after(charPane);

  const saved = { prefix: '', suffix: '' };
  let loaded = false;
  const dirty = () => loaded && (fields.prefix.value !== saved.prefix || fields.suffix.value !== saved.suffix);
  for (const field of Object.values(fields)) field.addEventListener('input', () => { status.textContent = dirty() ? '닫거나 세션 탭으로 가면 저장돼요.' : ''; });
  async function flush(): Promise<boolean> {
    if (!dirty()) return true;
    status.textContent = '캐릭터 노트 저장 중…';
    const reply = await request('/v1/character-author-note', { method: 'POST', body: { character_id: characterId, prefix: fields.prefix.value, suffix: fields.suffix.value } }).catch(error => ({ ok: false, error: { message: String(error?.message || error) } }));
    if (!reply?.ok) { status.textContent = '캐릭터 노트 저장 실패 · ' + String((reply?.error as { message?: string })?.message || '다시 시도하세요.'); return false; }
    saved.prefix = fields.prefix.value; saved.suffix = fields.suffix.value;
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
    sessionTab.setAttribute('aria-selected', String(!character));
    characterTab.setAttribute('aria-selected', String(character));
    content.hidden = character;
    charPane.hidden = !character;
  };
  sessionTab.addEventListener('click', () => void show(false));
  characterTab.addEventListener('click', () => void show(true));
  tabs.append(sessionTab, characterTab);
  if (!characterId) characterTab.hidden = true;
  title.after(tabs);

  void (async () => {
    // Look images are read on demand: tiles show names first and fill in when they land.
    const load = async () => {
      const reply = await request(`/v1/preset-bindings?character_id=${encodeURIComponent(characterId)}&session_id=${encodeURIComponent(sid)}`).catch(() => null) as Bindings | null;
      if (reply?.ok) { bindings = reply; sessionBar.paint(reply); characterBar.paint(reply); }
    };
    await load();
    const native = Reflect.get(globalThis, '__INLAY_NATIVE__') as { hydrateSettingsPreviews?: (tab: string) => Promise<boolean> } | undefined;
    if (await native?.hydrateSettingsPreviews?.('style_presets').catch(() => false) && bindings) await load();
  })();
  if (characterId) void request(`/v1/character-author-note?character_id=${encodeURIComponent(characterId)}`).then(reply => {
    if (!reply?.ok) { status.textContent = '캐릭터 노트를 불러오지 못했습니다.'; return; }
    saved.prefix = fields.prefix.value = String(reply.prefix || '');
    saved.suffix = fields.suffix.value = String(reply.suffix || '');
    loaded = true;
    fields.prefix.disabled = fields.suffix.disabled = false;
  }).catch(() => { status.textContent = '캐릭터 노트를 불러오지 못했습니다.'; });
  return { flush };
}

export function installNoteExtras(): void {
  Reflect.set(globalThis, '__OMNI_NOTE_EXTRAS__', { mount: mountNoteExtras });
}
