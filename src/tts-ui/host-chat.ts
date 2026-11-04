import { risuHost } from '../core/host';
import { uuid } from '../core/util/text';
import { sleep } from '../core/util/async';
import { ttsData, subscribeTts } from '../storage/tts-store';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { parseTtsMessage, compactHash, cueLineKey, isSoundSegment, type TtsSoundCues } from '../domain/tts/segment';
import { soundData, soundReady, subscribeSound } from '../storage/sound-store';
import { omniSound } from '../services/sound-runtime';
import { ttsExcludeTerms } from '../domain/tts/filter';
import { matchTtsAnchors, ttsAnchorTexts, type TtsAnchorText } from '../domain/tts/anchors';
import { settledWhileStreaming } from '../domain/tts/streaming';
import { revealSegments } from '../domain/tts/base64-words';
import { namedCostumes } from '../domain/tts/costume-cue';
import { costumesOf, onCostumeNames, refreshCostumeNames } from '../services/costume-names';
import { loadViewerPrefs, subscribeViewerPrefs, viewerPrefs } from '../storage/viewer-prefs';
import { TTS_NARRATION_OFF_CSS } from '../domain/tts/module';
import { illustrationTtsRequests } from '../services/tts-illustration';
import { chatCovered, onViewerUncovered, viewerCovering } from '../services/viewer-presence';
import { safeArray, itemsOf, hitHost, hostAttributes, releaseHost, disconnectHost, openingTag, htmlWithoutPictures, chatIndexOf, type HostPoint } from './host-utils';
import { withTtsAudio } from './activation';
import { installTtsViewer } from './host-viewer';

interface Binding { node: SafeElement; play:()=>Promise<void>; chips: {node:SafeElement;play:()=>Promise<void>}[]; message: number; messageId: string; line: string; source: string; illustration: boolean; narration: boolean; dead?: boolean; hidden?: boolean; styled?: boolean; state?: string; sound?: boolean; effect?: boolean; request?: TtsRequest; shown?: boolean }
/** BGM markers and effect words become rows of their own while that sound is on. */
function soundCues(): TtsSoundCues | undefined {
  if (!soundReady()) return undefined;
  const s = soundData().settings;
  return s.bgmEnabled || s.sfxEnabled ? { bgm: s.bgmEnabled, sfxRules: s.sfxEnabled ? s.sfxRules : [] } : undefined;
}
const soundOn = () => !!soundCues();
function requests(context: TtsChatContext, index: number): TtsRequest[] {
  const message = context.messages[index]; if (!message || message.role !== 'char') return [];
  const source = String(message.data || '');
  // A cue that named a costume by its name (하린_melony_form) is that person in that costume: the names are read ahead.
  void refreshCostumeNames(context.characterId, context.rosterScope);
  const segments = namedCostumes(parseTtsMessage(source,ttsExcludeTerms(ttsData().settings.excludeText),ttsData().settings.skipChars,ttsData().settings.skipSymbolOnly,soundCues()), costumesOf(context.rosterScope, context.characterId));
  // risu64 난독 (a switch of 옴니 뷰어's): the hidden words are read as words; the line is still matched as the chat shows it.
  return (viewerPrefs().revealBase64 ? revealSegments(segments) : segments).map(segment => ({ context, messageId:String(message.chatId || message.id || `${index}:${compactHash(source)}`), sourceKey:cueLineKey(source.slice(segment.start,segment.end)), segment }));
}
function findLine(list: TtsRequest[], key: string, line: string): number {
  if (!key) return list.findIndex(r => r.segment.id === line);
  const exactIndex = list.findIndex(r => r.segment.id === line && r.sourceKey === key);
  return exactIndex >= 0 ? exactIndex : list.findIndex(r => r.sourceKey === key);
}
let installed = false;
export async function installTtsHost(): Promise<void> {
  if (installed) return;
  const host = risuHost(); if (!host?.getRootDocument || !host.createMutationObserver) return;
  await omniTts.init(); const doc = await host.getRootDocument(); if (!doc) return;
  installed = true;
  // Read by every reply's lines (risu64 난독), not only once the viewer has opened.
  await loadViewerPrefs().catch(() => null);
  let refreshViewer = async () => {}, flash = (_message: string) => {};
  const bindings = new Map<string,Binding>(); let timer: ReturnType<typeof setTimeout> | undefined, scanTask: Promise<void> | undefined, again = false, lastScope = '', lastPrefetch = '', disposed=false, inputEpoch=0, hovered='', bootAttempts=0;
  // Lines a module control is actually shown for; status panels other modules
  // turned into markup never get a control and so never join the playlist.
  const anchored = new Map<number,TtsRequest[]>();
  let visibilityTail: Promise<void> = Promise.resolve(), stateTail: Promise<void> = Promise.resolve();
  // The plugin owns visibility, never a module rule (switching would rewrite the
  // module and redraw every chat). Narration OFF is one <style> outside the chat:
  // a button Risu redraws for each streamed chunk is hidden from its first frame,
  // where hiding it per node let it flash first. A control with no line to read is
  // only known after a scan, so that one is still hidden on the node itself.
  const hidden = (b: Binding) => !b.illustration && !b.sound && (!!b.dead || (b.narration && !ttsData().settings.narration));
  let narrationRule: SafeElement | null = null;
  const syncNarrationRule = async (): Promise<void> => {
    const off = !disposed && !ttsData().settings.narration;
    if (off === !!narrationRule) return;
    if (!off) {
      const rule = narrationRule; narrationRule = null;
      try { await rule?.remove(); } catch { /* gone with the page */ }
      await releaseHost(rule); return;
    }
    const rule = await doc.createElement('style'); await rule.setTextContent(TTS_NARRATION_OFF_CSS);
    const body = await doc.querySelector('body');
    try { if (body) { await body.appendChild(rule); narrationRule = rule; } else await releaseHost(rule); }
    finally { await releaseHost(body); }
  };
  const syncVisibility = (only?: Binding): Promise<void> => {
    visibilityTail = visibilityTail.catch(() => {}).then(async () => {
      if (!only) await syncNarrationRule();
      for (const b of only ? [only] : bindings.values()) {
        if (disposed) return;
        b.hidden = hidden(b);
        const unbound = !b.illustration && !b.sound && !!b.dead;
        if (!!b.styled === unbound) continue;
        b.styled = unbound; await b.node.setStyle('display', unbound ? 'none' : '');
      }
    });
    return visibilityTail;
  };
  const syncState = (): Promise<void> => {
    // Behind 옴니 뷰어 no button is in sight: their states are painted once it closes.
    if (viewerCovering()) return stateTail;
    stateTail = stateTail.catch(() => {}).then(async () => {
      const current = omniTts.current, status = omniTts.player.status;
      const active = status === 'loading' || status === 'playing' || status === 'paused' ? status : '';
      for (const b of bindings.values()) {
        if (disposed) return;
        // ♪ never plays through the voice player; ▶ does, like a line.
        if (b.sound && !b.effect) continue;
        const mine = !!active && !!current && !!b.messageId && b.messageId === current.messageId && (b.illustration || b.line === current.segment.id);
        const want = mine ? active : '';
        if ((b.state || '') !== want) { b.state = want; await b.node.setAttribute('x-omnitts-state', want); }
      }
    });
    return stateTail;
  };
  const bootstrap=()=>{if(bootAttempts<8)schedule(Math.min(5000,400*2**bootAttempts++));};
  // BGM·효과음 buttons work with TTS switched off, so the chat is watched while either is on.
  const active=()=>ttsData().settings.enabled||soundOn();
  const allowed=()=>{const blocked=Reflect.get(globalThis,'__OMNI_TTS_HOST_BLOCKED__');return !disposed&&active()&&!(typeof blocked==='function'&&blocked());};
  const report = (error: unknown) => { omniTts.report(error); const text = String((error as Error)?.message || error || ''); if (text) flash(text); };
  // User-started playback reports its own failure; background work stays quiet.
  const requestPlay = async (list:TtsRequest[], index:number, reservation=omniTts.reservePlayback()) => {
    await withTtsAudio(()=>omniTts.play(list,index,reservation),reservation);
    if (['error','blocked'].includes(omniTts.player.status) && omniTts.notice) flash(omniTts.notice);
  };
  /**
   * ♪ changes the music and leaves reading alone (BGM plays under the voice). ▶ is
   * a line of the TTS list: it plays through the voice player, takes over from what
   * is playing, shows the same states and continues reading. With TTS off it still
   * plays, on the effect channel.
   */
  // The cue a sound button plays is the binding's own (pairSound): matched again, it plays the new one.
  const pairSound = (b: Binding, request: TtsRequest | undefined, message: number) => {
    b.message = message; b.messageId = request?.messageId || ''; b.line = request?.segment.id || ''; b.dead = !request; b.effect = request?.segment.kind === 'sfx'; b.request = request;
  };
  const bindSound = async (node: SafeElement): Promise<string> => {
    let key = await node.getAttribute('x-omnitts-bound');
    if (key && bindings.has(key)) { await releaseHost(node); return key; }
    key = uuid(); await node.setAttribute('x-omnitts-bound',key);
    const b: Binding = {node,play:async()=>{},chips:[],message:-1,messageId:'',line:'',source:'',illustration:false,narration:false,sound:true};
    bindings.set(key,b);
    b.play = async () => {
      const segment = b.request?.segment; if (!segment) return;
      if (segment.kind === 'bgm') {
        // ♪ spins until the track is fetched and playing.
        await b.node.setAttribute('x-omnitts-state', 'loading');
        try { if (!await omniSound.playBgmForTags(segment.tags || [])) throw new Error(soundData().bgm.length ? '이 태그에 맞는 BGM이 없습니다.' : '등록된 BGM이 없습니다. BGM·효과음에서 추가해 주세요.'); }
        finally { await b.node.setAttribute('x-omnitts-state', ''); }
        return;
      }
      if (ttsData().settings.enabled) {
        const reservation = omniTts.reservePlayback();
        const shown = anchored.get(b.message), list = shown?.some(r => r.segment.id === b.line) ? shown : requests(await currentTtsContext(), b.message);
        const index = list.findIndex(r => r.segment.kind === 'sfx' && r.segment.id === b.line);
        if (index < 0) throw new Error('이 효과음의 원문을 찾지 못했습니다. 메시지가 바뀌었다면 잠시 후 다시 눌러 주세요.');
        await withTtsAudio(async () => { if (!await omniTts.playEffect(list, index)) throw new Error(omniTts.notice || `「${segment.text}」에 맞는 효과음이 없습니다.`); }, reservation);
        return;
      }
      if (!await omniSound.playSfxWord(segment.text, segment.context || '')) throw new Error(`「${segment.text}」에 맞는 효과음이 없습니다. 효과음 용어집에서 지정해 주세요.`);
    };
    return key;
  };
  const bind = async (node: SafeElement, illustration: boolean): Promise<string> => {
    let key = await node.getAttribute('x-omnitts-bound');
    if (key && bindings.has(key)) { await releaseHost(node); return key; }
    key = uuid(); await node.setAttribute('x-omnitts-bound',key);
    const b: Binding = {node,play:async()=>{},chips:[],message:-1,messageId:'',line:'',source:'',illustration,narration:false};
    b.play = async () => {
      if (!ttsData().settings.enabled) return;
      const reservation = omniTts.reservePlayback();
      const current = await currentTtsContext();
      if (b.illustration) {
        if (!ttsData().settings.illustration) return;
        const bar = await b.node.getParent(), image = await bar?.getParent();
        try {
          const attrs=image?await hostAttributes(image):{},id=attrs['data-inlay-inline-shot']||attrs['x-inlay-inline-shot'];
          if (!id) throw new Error('삽화 ID를 찾지 못했습니다. 채팅을 다시 열어 주세요.');
          b.messageId = `illustration:${id}`;
          const list = await illustrationTtsRequests(id,current); const cast = await bar?.querySelector('[data-omnitts-cast]');
          try {
            if (cast) { for (const chip of b.chips.splice(0)) await releaseHost(chip.node); await cast.setTextContent(''); for (let i=0;i<list.length;i++) { const chip = await doc.createElement('button'); await chip.setTextContent(list[i].segment.speaker); await chip.setStyleAttribute('box-sizing:border-box;height:36px;padding:0 12px;display:inline-flex;align-items:center;border:1px solid #5ad49b88;border-radius:8px;background:#137448;color:#e4ffec;line-height:1'); b.chips.push({node:chip,play:()=>requestPlay([list[i]],0,omniTts.reservePlayback())}); await cast.appendChild(chip); } }
          } finally { await releaseHost(cast); }
          await requestPlay(list,0,reservation);
        } finally { await releaseHost(image); await releaseHost(bar); }
      } else {
        // Play within the lines actually on screen: a folded <details> or a
        // panel another module drew never joins the list or continuous reading.
        const full = requests(current,b.message), shown = new Set((anchored.get(b.message) || []).map(r => `${r.segment.id}\t${r.sourceKey}`));
        const visible = full.filter(r => shown.has(`${r.segment.id}\t${r.sourceKey}`));
        const list = findLine(visible,b.source,b.line) >= 0 ? visible : full, index = findLine(list,b.source,b.line);
        if (index < 0) throw new Error('이 줄의 원문을 찾지 못했습니다. 메시지가 바뀌었다면 잠시 후 다시 눌러 주세요.');
        await requestPlay(list,index,reservation);
      }
    };
    bindings.set(key,b);
    return key;
  };
  /**
   * What each message held when it was last gone through: its controls (in the page's order), the text before each
   * line's control, which of those lines were on screen, and the lines matched. None of its HTML is kept: a message's
   * HTML carries its pictures as base64, megabytes, and it was read for every message on every scan (twice for one
   * drawn anew) and kept. The text is enough to match its lines again when a setting or a costume name changes them.
   */
  type Seen = { keys: string[]; lineKeys: string[]; sounds: { key: string; kind: 'bgm' | 'sfx' }[]; anchors: TtsAnchorText[]; visible: (boolean | undefined)[]; lines: number; list: TtsRequest[]; shown?: TtsRequest[]; unsettled: TtsRequest[]; details: boolean; mapped?: number };
  const seen = new Map<number, Seen>();
  const replyStreaming = () => { const live = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__'); return typeof live === 'function' && live() === true; };
  // The messages with controls of ours, by their number: top to bottom on screen. Risu puts the newest first in the
  // page (a column drawn bottom up), so the page's order was the screen's upside down and every halving went astray.
  let rows: { index: number; node: SafeElement }[] = [];
  const putRow = async (index: number, node: SafeElement | null) => {
    const at = rows.findIndex(row => Object.is(row.index, index));
    if (at >= 0) {
      const old = rows[at]!;
      if (old.node !== node) await releaseHost(old.node);
      if (node) rows[at] = { index, node }; else rows.splice(at, 1);
      return;
    }
    if (!node) return;
    let i = 0;
    while (i < rows.length && rows[i]!.index < index) i++;
    rows.splice(i, 0, { index, node });
  };
  /**
   * The message under a point's height, by halving among those boxes; one within a short gap counts (a control at a
   * message's edge). null for none. A box not laid out breaks the order there: each is asked instead.
   */
  const messageAt = async (y: number): Promise<number | null> => {
    if (!Number.isFinite(y) || !rows.length) return null;
    const GAP = 32, off = (r: { top: number; bottom: number }) => Math.max(r.top - y, y - r.bottom, 0);
    let lo = 0, hi = rows.length - 1, best = -1, gap = GAP;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, r = await rows[mid]!.node.getBoundingClientRect().catch(() => null);
      if (!r?.height) {
        best = -1; gap = GAP;
        for (let i = 0; i < rows.length; i++) { const box = await rows[i]!.node.getBoundingClientRect().catch(() => null); if (box?.height && off(box) <= gap) { gap = off(box); best = i; } }
        break;
      }
      if (off(r) <= gap) { gap = off(r); best = mid; }
      if (r.bottom < y) lo = mid + 1; else if (r.top > y) hi = mid - 1; else return rows[mid]!.index;
    }
    return best >= 0 ? rows[best]!.index : null;
  };
  let unsettledNow = new Set<TtsRequest>();
  /**
   * Who is being read and what is voiced ahead: the lines nearest the middle of the screen. The message across the
   * middle is found by halving (a few reads), and only its lines and its neighbours' are measured; further messages,
   * walked out to until there are lines enough to voice ahead, place their lines by where they fall in their box.
   * Every line on screen was measured before, several calls each.
   */
  const nearest = async (): Promise<{ list: TtsRequest[]; ahead: TtsRequest[] }> => {
    if (!rows.length) return { list: [], ahead: [] };
    const middle = (await doc.clientHeight()) / 2;
    const box = (i: number) => rows[i]!.node.getBoundingClientRect().catch(() => null);
    let lo = 0, hi = rows.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, r = await box(mid);
      if (!r?.height || r.bottom < middle) lo = mid + 1;
      else if (r.top > middle) hi = mid - 1;
      else { at = mid; break; }
    }
    if (at < 0) at = Math.min(lo, rows.length - 1);
    const linesOf = (index: number) => [...bindings.values()].filter(b => b.message === index && b.shown && !b.hidden && b.request);
    const near: { distance: number; request: TtsRequest; index: number }[] = [];
    const add = (b: Binding, y: number) => near.push({ distance: Math.abs(y - middle), request: b.request!, index: b.message });
    for (let i = Math.max(0, at - 1); i <= Math.min(rows.length - 1, at + 1); i++) for (const b of linesOf(rows[i]!.index)) {
      const r = await b.node.getBoundingClientRect().catch(() => null);
      if (r?.width && r.height) add(b, r.top + r.height / 2);
    }
    const want = ttsData().settings.prefetch;
    for (let d = 2; near.length < want && (at - d >= 0 || at + d < rows.length); d++) for (const i of [at - d, at + d]) {
      if (i < 0 || i >= rows.length) continue;
      const r = await box(i), lines = linesOf(rows[i]!.index);
      if (r?.height) lines.forEach((b, j) => add(b, r.top + r.height * (j + .5) / lines.length));
    }
    near.sort((a, b) => a.distance - b.distance);
    return { list: near[0] ? anchored.get(near[0].index) || [] : [], ahead: near.filter(row => !unsettledNow.has(row.request)).slice(0, want).map(row => row.request) };
  };
  const voiceAhead = (ahead: TtsRequest[]) => {
    const fingerprint = JSON.stringify([lastScope, ahead.map(r => [r.messageId, r.segment.id, r.segment.text])]);
    // 옴니 뷰어 open over the chat voices what is read there; asking here would cancel that for lines hidden behind it.
    if (viewerCovering()) lastPrefetch = '';
    else if (fingerprint !== lastPrefetch) { lastPrefetch = fingerprint; void omniTts.prefetch(ahead); }
  };
  /**
   * A scroll draws no line and takes none away; only what sits in the middle of the screen changes. So nothing is
   * asked of Risu while the chat scrolls (a full scan every 0.4 s was thousands of calls a second, all on the thread
   * that scrolls), and once it has stopped for a moment the reader is placed again among the last scan's messages.
   */
  const SETTLE_MS = 300;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const settle = async () => {
    if (disposed || !ttsData().settings.enabled || viewerCovering() || !rows.length) return;
    if (dragging() || scrollHeld() || scanTask) { onScroll(); return; }
    const { list, ahead } = await nearest();
    omniTts.reading(list);
    voiceAhead(ahead);
  };
  const onScroll = () => { clearTimeout(settleTimer); settleTimer = setTimeout(() => void settle().catch(() => {}), SETTLE_MS); };
  // A message's controls. One not yet ours has no x-omnitts-bound: the message holding it was drawn anew or grew a line.
  const LINE_CONTROLS = '[data-omnitts-kind]', SOUND_CONTROLS = '[data-omni-bgm],[data-omni-sfx]';
  const PICTURE_PLAY = '[data-omnitts-image] [data-omnitts-play],[x-omnitts-image] [x-omnitts-play]';
  const FOLDED = 'details:not([open]) > :not(summary), details:not([open]) > :not(summary) *';
  const unboundOf = (tts: boolean, sound: boolean) => [...(tts ? [LINE_CONTROLS, '[data-omnitts-image] [data-omnitts-play]', '[x-omnitts-image] [x-omnitts-play]'] : []), ...(sound ? ['[data-omni-bgm]', '[data-omni-sfx]'] : [])].map(s => `${s}:not([x-omnitts-bound])`).join(',');
  /**
   * A message gone through is marked with the round it was gone through in (x-omnitts-msg="round:number"). A scan asks
   * Risu once which messages to go through: unmarked (Risu drew them anew), marked in an older round (a switch that
   * decides which controls are ours changed), holding a control not yet ours, or named (a tap may have opened a
   * <details> in them). A chat as it was costs that one question and a count, whatever its length; a streaming reply
   * is the one message gone through for each chunk.
   */
  const STAMP = 'x-omnitts-msg';
  let round = 1, expected = 0, remapAll = false, hasWorks = true, plainReply: TtsRequest[] | null = null, scans = 0;
  const forced = new Set<number>();
  const freshSelector = (unbound: string, named: number[]) => [`.risu-chat:not([${STAMP}^="${round}:"])`, ...(unbound ? [`.risu-chat:has(${unbound})`] : []), ...named.map(i => `.risu-chat[${STAMP}="${round}:${i}"]`)].join(',');
  // A host whose selectors know no :has(): each message is asked about itself.
  const freshByHand = async (nodes: SafeElement[], unbound: string, named: number[]): Promise<SafeElement[]> => {
    const fresh: SafeElement[] = [];
    for (const node of nodes) {
      const mark = /^(\d+):(-?\d+|NaN)$/.exec(await node.getAttribute(STAMP).catch(() => null) || '');
      let take = !mark || Number(mark[1]) !== round || named.includes(Number(mark[2]));
      if (!take && unbound) { const control = await node.querySelector(unbound).catch(() => null); take = !!control; await releaseHost(control); }
      if (take) fresh.push(node); else await releaseHost(node);
    }
    return fresh;
  };
  const dropBinding = async (key: string) => {
    const b = bindings.get(key); if (!b) return;
    bindings.delete(key); await releaseHost(b.node); for (const chip of b.chips) await releaseHost(chip.node);
  };
  const forget = async (index: number) => {
    const s = seen.get(index); seen.delete(index); anchored.delete(index);
    if (s) for (const key of s.keys) await dropBinding(key);
    await putRow(index, null);
  };
  /** A message's controls matched with its lines as the chat has them now; where a line is, measured once per drawing. */
  const mapMessage = async (index: number, s: Seen, ctx: TtsChatContext): Promise<void> => {
    const list = requests(ctx, index);
    s.list = list; s.unsettled = []; s.mapped = scans;
    // The reply being written: only its finished lines may be voiced ahead.
    if (ctx.chat.isStreaming === true && index === ctx.messages.length - 1) {
      const settled = new Set(settledWhileStreaming(list, String(ctx.messages[index]?.data ?? '')));
      s.unsettled = list.filter(request => !settled.has(request));
    }
    // Sound buttons pair with the message's cues in order, each kind on its own.
    const cues = { bgm: list.filter(r => r.segment.kind === 'bgm'), sfx: list.filter(r => r.segment.kind === 'sfx') }, order = { bgm: 0, sfx: 0 };
    for (const { key, kind } of s.sounds) { const b = bindings.get(key); if (b) pairSound(b, cues[kind][order[kind]++], index); }
    const matches = s.lineKeys.length ? matchTtsAnchors(s.anchors, list.map(r => r.segment)) : [], shown: TtsRequest[] = [];
    for (let j = 0; j < s.lineKeys.length; j++) {
      const b = bindings.get(s.lineKeys[j]!); if (!b) continue;
      const request = list[matches[j] ?? -1];
      b.message = index; b.messageId = request?.messageId || ''; b.line = request?.segment.id || ''; b.source = request?.sourceKey || ''; b.narration = request?.segment.kind === 'narration';
      b.dead = !request; b.request = request; b.shown = false;
      await syncVisibility(b);
      if (!request || b.hidden) continue;
      // A line inside a folded <details> is not on screen and stays out of the list. Our absolutely placed control
      // still reports a box there, so ask about the fold itself; a zero box covers other hidden panes.
      if (s.visible[j] === undefined) s.visible[j] = !await b.node.matches(FOLDED) && await b.node.getBoundingClientRect().then(r => !!(r.width && r.height));
      if (!s.visible[j]) continue;
      b.shown = true; shown.push(request);
    }
    // Cues keep their place among the lines that are on screen.
    const visible = new Set(shown);
    s.shown = shown.length ? list.filter(r => visible.has(r) || isSoundSegment(r.segment)) : undefined;
    if (s.shown) anchored.set(index, s.shown); else anchored.delete(index);
  };
  /**
   * A message drawn anew: its controls made ours, the text before each read off a copy without its pictures, matched
   * with its lines, and marked. Kept as a row when it has controls, else let go. false: the chat could not be read
   * (it is gone through again then).
   */
  const goThrough = async (chat: SafeElement, tts: boolean, sound: boolean, readContext: () => Promise<TtsChatContext | null>): Promise<boolean> => {
    const owned = new Set<SafeElement>();
    let kept = false;
    try {
      const nodes = tts ? await itemsOf(await chat.querySelectorAll(LINE_CONTROLS)) : [];
      const sounds = sound ? await itemsOf(await chat.querySelectorAll(SOUND_CONTROLS)) : [];
      const pictures = tts ? await itemsOf(await chat.querySelectorAll(PICTURE_PLAY)) : [];
      for (const node of [...nodes, ...sounds, ...pictures]) owned.add(node);
      const ctx = nodes.length || sounds.length ? await readContext() : null;
      if ((nodes.length || sounds.length) && !ctx) return false;
      const html = nodes.length ? await htmlWithoutPictures(chat) : await openingTag(chat);
      const index = chatIndexOf(html), old = seen.get(index);
      const s: Seen = { keys: [], lineKeys: [], sounds: [], anchors: nodes.length ? ttsAnchorTexts(html) : [], visible: [], lines: nodes.length, list: [], unsettled: [], details: /<details\b/i.test(html) };
      // Each bind takes its node over: kept in the binding, or let go when it was ours already.
      for (const node of pictures) { owned.delete(node); const key = await bind(node, true); bindings.get(key)!.message = index; s.keys.push(key); }
      for (const node of sounds) { owned.delete(node); const kind = await node.matches('[data-omni-bgm]') ? 'bgm' : 'sfx'; const key = await bindSound(node); s.sounds.push({ key, kind }); s.keys.push(key); }
      for (const node of nodes) { owned.delete(node); const key = await bind(node, false); s.lineKeys.push(key); s.keys.push(key); }
      if (ctx) await mapMessage(index, s, ctx);
      // The controls it held before and holds no longer (Risu drew them anew) go.
      if (old) for (const key of old.keys) if (!s.keys.includes(key)) await dropBinding(key);
      if (!seen.has(index)) expected++;
      seen.set(index, s);
      if (!s.keys.length) anchored.delete(index);
      await chat.setAttribute(STAMP, `${round}:${index}`);
      await putRow(index, s.keys.length ? chat : null);
      kept = s.keys.length > 0;
      return true;
    } finally {
      for (const node of owned) await releaseHost(node);
      if (!kept) await releaseHost(chat);
    }
  };
  const scanOnce = async () => {
    scans++;
    try {
      if (disposed || !active()) return;
      // A remounted chat screen (another bot or chat) gets its own watcher.
      await watchChat();
      await refreshViewer();
      const tts = ttsData().settings.enabled, sound = soundOn();
      // The chat itself is read only when a message must be matched with its lines.
      let context: TtsChatContext | null = null;
      const readContext = async (): Promise<TtsChatContext | null> => {
        if (context) return context;
        context = await currentTtsContext().catch(() => null);
        if (!context) return null;
        omniTts.setContext(context);
        if (context.scope !== lastScope) { lastScope = context.scope; lastPrefetch = ''; }
        return context;
      };
      let changed = false;
      // A setting or a costume name changed what the lines are: each message matched again from what was read of it.
      if (remapAll && seen.size) {
        const ctx = await readContext();
        if (!ctx) { bootstrap(); return; }
        remapAll = false; changed = true;
        for (const [index, s] of seen) await mapMessage(index, s, ctx);
      } else remapAll = false;
      const named = [...forced]; forced.clear();
      const unbound = unboundOf(tts, sound);
      // Both asked at once (one round trip). A host that answers a selector it does not know by throwing, at once or
      // later, is asked message by message from then on.
      const [all, picked] = await Promise.all([
        doc.querySelectorAll('.risu-chat') as Promise<SafeClassArray<SafeElement> | SafeElement[]>,
        hasWorks ? (async () => doc.querySelectorAll(freshSelector(unbound, named)))().catch(() => { hasWorks = false; return null; }) : Promise.resolve(null),
      ]);
      try {
        const count = Array.isArray(all) ? all.length : await all.length();
        const fresh = picked ? await itemsOf(picked) : await freshByHand(await safeArray(all), unbound, named);
        let failed = false, cut = false;
        for (let i = 0; i < fresh.length; i++) {
          // A floating viewer being dragged has the bridge to itself: what is left is gone through after the drop.
          if (failed || dragging()) { cut = !failed; for (const node of fresh.slice(i)) await releaseHost(node); if (cut) schedule(250); break; }
          if (await goThrough(fresh[i]!, tts, sound, readContext)) changed = true; else failed = true;
        }
        if (failed) { for (const index of named) forced.add(index); bootstrap(); return; }
        // A message gone from the page (a long chat's oldest as a new one comes, one deleted, another chat's): what
        // was found in it goes. The count tells; only then is each message's mark read (after a scan cut short, the
        // next one tells).
        if (!cut && count !== expected) {
          const present = new Set<number>();
          for (const node of await safeArray(all)) {
            try { const mark = /^(\d+):(-?\d+|NaN)$/.exec(await node.getAttribute(STAMP) || ''); if (mark && Number(mark[1]) === round) present.add(Number(mark[2])); }
            finally { await releaseHost(node); }
          }
          for (const index of [...seen.keys()]) if (!present.has(index)) { await forget(index); changed = true; }
          expected = count;
        }
      } finally { if (!Array.isArray(all)) await releaseHost(all); }
      // A reply's unfinished lines are held back while it streams, and as the chat said them when matched just now.
      const streamingNow = replyStreaming(), unsettled = new Set<TtsRequest>();
      let lines = 0;
      for (const s of seen.values()) { lines += s.lines; if (streamingNow || s.mapped === scans) for (const request of s.unsettled) unsettled.add(request); }
      if (changed) {
        const listed = [...seen.values()].flatMap(s => s.list);
        // The effects on screen are matched and cut ahead, all unknown parts in one request.
        const effects = listed.filter(r => r.segment.kind === 'sfx');
        if (effects.length) void omniSound.prepareEffects(effects.map(r => ({ text: r.segment.text, context: r.segment.context || '' }))).catch(error => console.warn('OmniSound prepare', error));
        // The tracks the [[bgm:…]] cues on screen would play are fetched before reading reaches them.
        const cues = listed.filter(r => r.segment.kind === 'bgm' && r.segment.tags?.length);
        if (cues.length) omniSound.prefetchBgmForTags(cues.map(r => r.segment.tags!));
      }
      unsettledNow = unsettled;
      let { list: readingList, ahead } = await nearest();
      if(!lines){
        // A freshly installed display module may not have re-rendered Risu's
        // existing messages yet. The viewer can still read the original reply
        // (only with TTS on: BGM·효과음 alone reads no line and needs no chat read for it).
        // Read again only when a message changed or while booting: the chat as it was gives the list it gave.
        if(changed||bootAttempts<8||!plainReply){
          const ctx = tts ? await readContext() : null;
          const chat = ctx ? await doc.querySelector('.default-chat-screen') : null;
          try{if(ctx&&chat&&await chat.clientHeight()>0){let index=ctx.messages.length-1;while(index>=0&&ctx.messages[index].role!=='char')index--;readingList=requests(ctx,index);}}finally{await releaseHost(chat);}
          plainReply=readingList;
          bootstrap();
        }else readingList=plainReply;
      }else{bootAttempts=8;plainReply=null;}
      if (tts) omniTts.reading(readingList);
      await syncState();
      // The line still being written changes with every chunk: it is made once, after the reply ends.
      voiceAhead(ahead);
    } catch (error) { if (ttsData().settings.enabled) console.warn('OmniTTS chat scan',error); }
  };
  const requestScan = (): Promise<void> => {
    if (scanTask) { again = true; return scanTask; }
    scanTask = (async () => { try { do { again = false; await scanOnce(); } while (again && !disposed); } finally { scanTask = undefined; } })();
    return scanTask;
  };
  // While either floating viewer is dragged no scan runs; it waits for the drop.
  const dragging = () => Reflect.get(globalThis,'__OMNI_VIEWER_DRAGGING__') === true;
  // Nor while a scroll hold is putting the view back: a scan reads every message on
  // screen, and those reads would queue in front of the hold's own.
  const scrollHeld = () => { const busy=Reflect.get(globalThis,'__OMNI_SCROLL_BUSY__'); return typeof busy === 'function' && busy() === true; };
  // Behind 옴니 뷰어 the chat is out of sight: no scan (each reads every message and the whole
  // character, and every tap on the viewer asked for one). One runs when it closes.
  let behind = false;
  const schedule = (delay=400) => { if (disposed || timer || !active()) return; if (viewerCovering()) { behind = true; return; } timer=setTimeout(()=>{timer=undefined;if(dragging() || scrollHeld()){schedule(250);return;}void requestScan();},delay); };
  // Like the illustration viewer: watch only the chat screen, and never ask the
  // host about each record. The old whole-page watcher made 2-3 bridge calls per
  // DOM change and then re-read every message, which competed with a drag.
  const watchers: SafeMutationObserver[] = [];
  const onChange = (records: unknown) => { void releaseHost(records).catch(()=>{}); schedule(200); };
  const watchChat = async () => {
    const screen = await doc.querySelector('.default-chat-screen:not([x-omnitts-watched])');
    if (!screen) return;
    try { await screen.setAttribute('x-omnitts-watched','1'); const watcher = await host.createMutationObserver!(onChange); await watcher.observe(screen,{childList:true,subtree:true}); watchers.push(watcher); }
    finally { await releaseHost(screen); }
  };
  await watchChat();
  const events:{type:string;id:string;options?:AddEventListenerOptions}[]=[];
  const listen=async(type:string,fn:(e:HostPoint)=>void,options?:AddEventListenerOptions)=>{events.push({type,id:await doc.addEventListener(type,fn,options),options});};
  // 옴니 뷰어 lies over the chat, and so do the TTS window, the floating viewer and the 플로팅 태그 (their covers,
  // told from rectangles they keep): a tap on any reads no line beneath.
  const underViewer=(e:HostPoint)=>{const covers=Reflect.get(globalThis,'__OMNI_VIEWER_COVERS__');return (typeof covers==='function'&&!!covers(e.clientX,e.clientY))||chatCovered(e.clientX,e.clientY);};
  // Only the controls of the message under the point are asked about, its pictures' too: every control on screen
  // was asked before, hundreds of calls for each tap, more with every line the chat grew by.
  const findHit=async(e:HostPoint,hover:boolean,under?:number|null)=>{
    if(!allowed()||underViewer(e))return;
    const message=under===undefined?await messageAt(e.clientY):under;
    if(message===null)return;
    const rows=[...bindings.entries()].filter(([,b])=>Object.is(b.message,message)&&!hidden(b)&&!b.dead&&(!hover||!b.sound)&&(b.sound||ttsData().settings.enabled)).flatMap(([key,b])=>[
      ...(!hover||!b.illustration?[{key,node:b.node,play:b.play,illustration:b.illustration||!!b.sound}]:[]),
      ...(!hover?b.chips.map((c,i)=>({key:key+':'+i,node:c.node,play:c.play,illustration:true})):[])
    ]);
    const hits=await Promise.all(rows.map(r=>hitHost(r.node,e)));return rows[hits.indexOf(true)];
  };
  await listen('click',e=>{
    // A tap on 옴니 뷰어, the floating viewer or the 플로팅 태그 is theirs: nothing of the chat beneath is looked at.
    if(!allowed()||viewerCovering()||underViewer(e))return;
    const epoch=++inputEpoch;
    void (async()=>{
      const under=await messageAt(e.clientY);
      // Opening or folding a <details> changes no DOM nodes, so no mutation arrives: a tap on a message that has one
      // may have done it, and that message is gone through again. A tap elsewhere changes nothing a scan would find
      // (each tap scanned before: a read of every message, just as a double tap opens a picture full screen).
      if(under!==null&&seen.get(under)?.details){forced.add(under);schedule(400);}
      const row=await findHit(e,false,under);
      if(epoch===inputEpoch&&row&&(row.illustration||ttsData().settings.clickPlay))return row.play();
    })().catch(report);
  });
  await listen('mouseover',e=>{
    if(!ttsData().settings.hoverPlay||viewerCovering())return;const epoch=++inputEpoch;
    void findHit(e,true).then(row=>{if(epoch!==inputEpoch)return;if(!row){hovered='';return;}if(hovered!==row.key){hovered=row.key;return row.play();}}).catch(report);
  });
  // The scroll is listened to only while TTS or BGM·효과음 is on: off, Risu forwarded every scroll event for nothing.
  let scrollId = '', scrollTail: Promise<void> = Promise.resolve();
  const syncScrollWatch = (): Promise<void> => scrollTail = scrollTail.catch(() => {}).then(async () => {
    const want = !disposed && active();
    if (want === !!scrollId) return;
    if (want) { scrollId = await doc.addEventListener('scroll', onScroll, { capture: true, passive: true }); return; }
    const id = scrollId; scrollId = ''; clearTimeout(settleTimer);
    await doc.removeEventListener('scroll', id, { capture: true });
  });
  await syncScrollWatch();
  // Which controls are ours (TTS, BGM·효과음 on or off): every message gone through again, in a new round. What the
  // lines are (나레이션, 제외 문구, 효과음 규칙, risu64 난독, a costume name): matched again from what was read of each,
  // with no read of a message. Anything else a setting holds (the TTS window's place, folded or not, its panel, a
  // volume) changes nothing in the chat: each of those went through every message and every control again before.
  const domKey = () => JSON.stringify([ttsData().settings.enabled, soundOn()]);
  const lineKey = () => { const s = ttsData().settings; return JSON.stringify([s.narration, s.excludeText, s.skipChars, s.skipSymbolOnly, soundCues() ?? null, viewerPrefs().revealBase64 === true]); };
  let lastDomKey = domKey(), lastLineKey = lineKey();
  const settingsChanged = () => {
    const dom = domKey(), line = lineKey();
    if (dom !== lastDomKey) { lastDomKey = dom; lastLineKey = line; round++; bootAttempts = 0; schedule(); return; }
    if (line !== lastLineKey) { lastLineKey = line; remapAll = true; schedule(); }
  };
  // The reader is placed again (a few calls) for what is voiced ahead, which a setting may change.
  const unsubscribe=subscribeTts(()=>{void syncScrollWatch().catch(()=>{});void syncVisibility().catch(error=>console.warn('OmniTTS button visibility',error));lastPrefetch='';settingsChanged();onScroll();});
  const unsubscribeSound=subscribeSound(()=>{void syncScrollWatch().catch(()=>{});settingsChanged();});
  const unsubscribePrefs=subscribeViewerPrefs(()=>settingsChanged());
  const unsubscribeCostumes=onCostumeNames(()=>{remapAll=true;schedule();});
  const unsubscribeState=omniTts.subscribe(()=>{void syncState().catch(error=>console.warn('OmniTTS playing state',error));});
  // The viewer closed: the chat as it is now, and the line playing marked.
  const unsubscribeUncovered=onViewerUncovered(()=>{lastPrefetch='';if(behind){behind=false;schedule(0);}void syncState().catch(error=>console.warn('OmniTTS playing state',error));});
  const replied = new Map<string,string>();
  const output: (arg:ChatOutputListenerArg)=>Promise<void> = async arg=>{
    if (disposed || !active()) return;
    try { const context=await currentTtsContext(); if (String(arg.char?.chaId)!==context.characterId || String(arg.chat?.id)!==context.chatId) return;
      const index=arg.messageIndex; let list=requests(context,index); if (!list.length) return;
      const key=JSON.stringify([context.scope,index]), signature=compactHash(String(context.messages[index]?.data || '')); if (replied.get(key)===signature) return; replied.set(key,signature); if (replied.size>100) replied.delete(replied.keys().next().value!);
      const s=ttsData().settings, reads=s.enabled&&s.autoReply;
      // The reply's music starts now, unless continuous reading reaches its cue itself.
      // With no [[bgm:…]] tag (or with 「메시지 문장 전체」) the reply's text picks the track.
      const bgm=list.find(r=>r.segment.kind==='bgm');
      if (soundReady() && !(bgm && reads&&s.continuous&&soundData().settings.listBgm)) void omniSound.playBgmForReply(String(context.messages[index]?.data||''),bgm?.segment.tags).catch(report);
      // 옴니 뷰어 voices the reply as it is read there (and the chat is behind it): nothing is read from here.
      if (!reads || viewerCovering()) { schedule(); return; }
      // Let Risu render the reply first so panels other modules drew are skipped.
      await sleep(250); await requestScan();
      const shown = anchored.get(index); if (shown?.length) list = shown;
      // Without continuous reading only one row plays: make it a spoken line, not a cue.
      await requestPlay(list, list.findIndex(r=>(s.continuous||!isSoundSegment(r.segment))&&(s.narration || r.segment.kind!=='narration')));
    } catch(error) { report(error); }
  };
  if (host.addRisuChatListener) await host.addRisuChatListener('output',output);
  // ⌖ also centers the line being read in the chat. Near the end of a chat the
  // chat cannot scroll that far, and the browser would push the whole page
  // instead; that shift is detected on the chat screen and undone at once.
  const revealInChat = async () => {
    const current = omniTts.current; if (!current) return;
    const b = [...bindings.values()].find(row => !row.hidden && row.messageId === current.messageId && (row.illustration || row.line === current.segment.id));
    if (!b) return;
    const screen = await doc.querySelector('.default-chat-screen');
    try {
      const page = await doc.getBoundingClientRect(), before = screen ? await screen.getBoundingClientRect() : null;
      await b.node.scrollIntoView({ block: 'center', inline: 'nearest' });
      const after = screen ? await screen.getBoundingClientRect() : null;
      if (!screen || !before || !after || (Math.abs(after.top - before.top) <= 1 && Math.abs(after.left - before.left) <= 1)) return;
      // Risu's page normally sits at 0,0: return it there exactly. Otherwise
      // keep the whole chat screen in view.
      if (Math.abs(page.top) <= 1 && Math.abs(page.left) <= 1) await doc.scrollIntoView({ block: 'start', inline: 'start' });
      else await screen.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } finally { await releaseHost(screen); }
  };
  await syncVisibility().catch(error=>console.warn('OmniTTS button visibility',error));
  const viewer=await installTtsViewer(doc,revealInChat);refreshViewer=viewer.refresh;flash=viewer.flash;await requestScan();
  if(host.onUnload)await host.onUnload(async()=>{disposed=true;await syncNarrationRule().catch(()=>{});inputEpoch++;installed=false;clearTimeout(timer);clearTimeout(settleTimer);await syncScrollWatch().catch(()=>{});for(const row of rows.splice(0))await releaseHost(row.node);seen.clear();unsubscribe();unsubscribeSound();unsubscribePrefs();unsubscribeCostumes();unsubscribeState();unsubscribeUncovered();omniTts.stop();for(const watcher of watchers.splice(0))await disconnectHost(watcher);for(const e of events)await doc.removeEventListener(e.type,e.id,e.options);await host.removeRisuChatListener?.('output',output);for(const b of bindings.values()){await releaseHost(b.node);for(const c of b.chips)await releaseHost(c.node);}bindings.clear();await viewer.dispose();await releaseHost(doc);});
}
