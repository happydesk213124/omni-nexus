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
import { matchTtsAnchors, ttsAnchorTexts } from '../domain/tts/anchors';
import { TTS_NARRATION_OFF_CSS } from '../domain/tts/module';
import { illustrationTtsRequests } from '../services/tts-illustration';
import { safeArray, hitHost, hostAttributes, releaseHost, disconnectHost, type HostPoint } from './host-utils';
import { withTtsAudio } from './activation';
import { installTtsViewer } from './host-viewer';

interface Binding { node: SafeElement; play:()=>Promise<void>; chips: {node:SafeElement;play:()=>Promise<void>}[]; message: number; messageId: string; line: string; source: string; illustration: boolean; narration: boolean; dead?: boolean; hidden?: boolean; styled?: boolean; state?: string; sound?: boolean; effect?: boolean }
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
  return parseTtsMessage(source,ttsExcludeTerms(ttsData().settings.excludeText),ttsData().settings.skipChars,ttsData().settings.skipSymbolOnly,soundCues()).map(segment => ({ context, messageId:String(message.chatId || message.id || `${index}:${compactHash(source)}`), sourceKey:cueLineKey(source.slice(segment.start,segment.end)), segment }));
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
  const bindSound = async (node: SafeElement, request: TtsRequest | undefined, message: number): Promise<string> => {
    let key = await node.getAttribute('x-omnitts-bound');
    if (!key || !bindings.has(key)) { key = uuid(); await node.setAttribute('x-omnitts-bound',key); bindings.set(key,{node,play:async()=>{},chips:[],message:-1,messageId:'',line:'',source:'',illustration:false,narration:false,sound:true}); }
    else await releaseHost(node);
    const b = bindings.get(key)!;
    b.message = message; b.messageId = request?.messageId || ''; b.line = request?.segment.id || ''; b.dead = !request; b.effect = request?.segment.kind === 'sfx';
    b.play = async () => {
      const segment = request?.segment; if (!segment) return;
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
  const scanOnce = async () => {
    try {
      if (disposed || !active()) return;
      // A remounted chat screen (another bot or chat) gets its own watcher.
      await watchChat();
      await refreshViewer();
      const context = await currentTtsContext().catch(()=>null); if(!context){bootstrap();return;} omniTts.setContext(context);
      if (context.scope !== lastScope) { lastScope = context.scope; lastPrefetch = ''; }
      const live = new Set<string>(), nearby: {distance:number;request:TtsRequest}[] = [];
      const height = await doc.clientHeight();
      const perMessage = new Map<number,TtsRequest[]>();
      anchored.clear();
      let lines = 0;
      for (const chat of await safeArray(await doc.querySelectorAll('.risu-chat'))) {
        try {
          const nodes = ttsData().settings.enabled ? await safeArray(await chat.querySelectorAll('[data-omnitts-kind]')) : [];
          const sounds = soundOn() ? await safeArray(await chat.querySelectorAll('[data-omni-bgm],[data-omni-sfx]')) : [];
          if (!nodes.length && !sounds.length) continue;
          lines += nodes.length;
          // One read per message: the rendered line text identifies each control,
          // so the module never has to stamp ids into another module's input.
          const html = await chat.getOuterHTML();
          const index = Number(/\bdata-chat-index="(-?\d+)"/.exec(html.slice(0, html.indexOf('>') + 1))?.[1] ?? NaN);
          const list = Number.isInteger(index) ? perMessage.get(index) ?? requests(context,index) : [];
          if (Number.isInteger(index)) perMessage.set(index,list);
          // Sound buttons pair with the message's cues in order, each kind on its own.
          const cuesOf = (kind: 'bgm' | 'sfx') => list.filter(r => r.segment.kind === kind);
          const order = { bgm: 0, sfx: 0 };
          for (const node of sounds) {
            const kind = await node.matches('[data-omni-bgm]') ? 'bgm' : 'sfx';
            live.add(await bindSound(node, cuesOf(kind)[order[kind]++], index));
          }
          if (!nodes.length) continue;
          const matches = matchTtsAnchors(ttsAnchorTexts(html), list.map(r => r.segment));
          const shown: TtsRequest[] = [];
          for (let j=0;j<nodes.length;j++) {
            const key = await bind(nodes[j]!, false), b = bindings.get(key)!, request = list[matches[j] ?? -1];
            live.add(key);
            b.message = index; b.messageId = request?.messageId || ''; b.line = request?.segment.id || ''; b.source = request?.sourceKey || ''; b.narration = request?.segment.kind === 'narration';
            b.dead = !request;
            await syncVisibility(b);
            if (!request || b.hidden) continue;
            // A line inside a folded <details> is not on screen and stays out of
            // the list. Our absolutely placed control still reports a box there,
            // so ask about the fold itself; a zero box covers other hidden panes.
            if (await b.node.matches('details:not([open]) > :not(summary), details:not([open]) > :not(summary) *')) continue;
            const rect = await b.node.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            shown.push(request);
            nearby.push({distance:Math.abs(rect.top+rect.height/2-height/2),request});
          }
          // Cues keep their place among the lines that are on screen.
          const visible = new Set(shown);
          if (shown.length) anchored.set(index, list.filter(r => visible.has(r) || isSoundSegment(r.segment)));
        } finally { await releaseHost(chat); }
      }
      // The effects on screen are matched and cut ahead, all unknown parts in one request.
      const effects = [...perMessage.values()].flat().filter(r => r.segment.kind === 'sfx');
      if (effects.length) void omniSound.prepareEffects(effects.map(r => ({ text: r.segment.text, context: r.segment.context || '' }))).catch(error => console.warn('OmniSound prepare', error));
      // The tracks the [[bgm:…]] cues on screen would play are fetched before reading reaches them.
      const cues = [...perMessage.values()].flat().filter(r => r.segment.kind === 'bgm' && r.segment.tags?.length);
      if (cues.length) omniSound.prefetchBgmForTags(cues.map(r => r.segment.tags!));
      for (const node of await safeArray(await doc.querySelectorAll('[data-omnitts-image] [data-omnitts-play],[x-omnitts-image] [x-omnitts-play]'))) live.add(await bind(node, true));
      for (const [key,b] of bindings) if (!live.has(key)) { await releaseHost(b.node);for (const chip of b.chips) await releaseHost(chip.node); bindings.delete(key); }
      nearby.sort((a,b)=>a.distance-b.distance);
      const reading=nearby[0]?.request;
      let readingList=reading?anchored.get([...anchored.entries()].find(([,list])=>list.includes(reading))?.[0] ?? -1)||[]:[];
      if(!lines){
        // A freshly installed display module may not have re-rendered Risu's
        // existing messages yet. The viewer can still read the original reply.
        const chat=await doc.querySelector('.default-chat-screen');
        try{if(chat&&await chat.clientHeight()>0){let index=context.messages.length-1;while(index>=0&&context.messages[index].role!=='char')index--;readingList=requests(context,index);}}finally{await releaseHost(chat);}
        bootstrap();
      }else bootAttempts=8;
      if (ttsData().settings.enabled) omniTts.reading(readingList);
      await syncState();
      const selected = nearby.slice(0,ttsData().settings.prefetch).map(row=>row.request);
      const fingerprint=JSON.stringify([context.scope,selected.map(r=>[r.messageId,r.segment.id,r.segment.text])]);
      if (fingerprint !== lastPrefetch) { lastPrefetch=fingerprint; void omniTts.prefetch(selected); }
    } catch (error) { if (ttsData().settings.enabled) console.warn('OmniTTS chat scan',error); }
  };
  const requestScan = (): Promise<void> => {
    if (scanTask) { again = true; return scanTask; }
    scanTask = (async () => { try { do { again = false; await scanOnce(); } while (again && !disposed); } finally { scanTask = undefined; } })();
    return scanTask;
  };
  // While either floating viewer is dragged no scan runs; it waits for the drop.
  const dragging = () => Reflect.get(globalThis,'__OMNI_VIEWER_DRAGGING__') === true;
  const schedule = (delay=400) => { if (disposed || timer || !active()) return; timer=setTimeout(()=>{timer=undefined;if(dragging()){schedule(250);return;}void requestScan();},delay); };
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
  const findHit=async(e:HostPoint,hover:boolean)=>{
    if(!allowed())return;
    const viewer=await doc.querySelector('[x-omnitts-viewer]');
    try{if(viewer&&await hitHost(viewer,e))return;}finally{await releaseHost(viewer);}
    const rows=[...bindings.entries()].filter(([,b])=>!hidden(b)&&!b.dead&&(!hover||!b.sound)&&(b.sound||ttsData().settings.enabled)).flatMap(([key,b])=>[
      ...(!hover||!b.illustration?[{key,node:b.node,play:b.play,illustration:b.illustration||!!b.sound}]:[]),
      ...(!hover?b.chips.map((c,i)=>({key:key+':'+i,node:c.node,play:c.play,illustration:true})):[])
    ]);
    const hits=await Promise.all(rows.map(r=>hitHost(r.node,e)));return rows[hits.indexOf(true)];
  };
  await listen('click',e=>{
    // Opening or folding a <details> changes no DOM nodes, so no mutation
    // arrives. A chat click may have done it: re-check which lines are on screen.
    void (async()=>{const viewer=await doc.querySelector('[x-omnitts-viewer]');try{if(!viewer||!await hitHost(viewer,e))schedule(150);}finally{await releaseHost(viewer);}})().catch(()=>{});
    const epoch=++inputEpoch;
    void findHit(e,false).then(row=>{if(epoch===inputEpoch&&row&&(row.illustration||ttsData().settings.clickPlay))return row.play();}).catch(report);
  });
  await listen('mouseover',e=>{
    if(!ttsData().settings.hoverPlay)return;const epoch=++inputEpoch;
    void findHit(e,true).then(row=>{if(epoch!==inputEpoch)return;if(!row){hovered='';return;}if(hovered!==row.key){hovered=row.key;return row.play();}}).catch(report);
  });
  await listen('scroll',()=>schedule(),{capture:true,passive:true});
  const unsubscribe=subscribeTts(()=>{void syncVisibility().catch(error=>console.warn('OmniTTS button visibility',error));lastPrefetch='';bootAttempts=0;schedule();});
  const unsubscribeSound=subscribeSound(()=>{bootAttempts=0;schedule();});
  const unsubscribeState=omniTts.subscribe(()=>{void syncState().catch(error=>console.warn('OmniTTS playing state',error));});
  const seen = new Map<string,string>();
  const output: (arg:ChatOutputListenerArg)=>Promise<void> = async arg=>{
    if (disposed || !active()) return;
    try { const context=await currentTtsContext(); if (String(arg.char?.chaId)!==context.characterId || String(arg.chat?.id)!==context.chatId) return;
      const index=arg.messageIndex; let list=requests(context,index); if (!list.length) return;
      const key=JSON.stringify([context.scope,index]), signature=compactHash(String(context.messages[index]?.data || '')); if (seen.get(key)===signature) return; seen.set(key,signature); if (seen.size>100) seen.delete(seen.keys().next().value!);
      const s=ttsData().settings, reads=s.enabled&&s.autoReply;
      // The reply's music starts now, unless continuous reading reaches its cue itself.
      // With no [[bgm:…]] tag (or with 「메시지 문장 전체」) the reply's text picks the track.
      const bgm=list.find(r=>r.segment.kind==='bgm');
      if (soundReady() && !(bgm && reads&&s.continuous&&soundData().settings.listBgm)) void omniSound.playBgmForReply(String(context.messages[index]?.data||''),bgm?.segment.tags).catch(report);
      if (!reads) { schedule(); return; }
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
  if(host.onUnload)await host.onUnload(async()=>{disposed=true;await syncNarrationRule().catch(()=>{});inputEpoch++;installed=false;clearTimeout(timer);unsubscribe();unsubscribeSound();unsubscribeState();omniTts.stop();for(const watcher of watchers.splice(0))await disconnectHost(watcher);for(const e of events)await doc.removeEventListener(e.type,e.id,e.options);await host.removeRisuChatListener?.('output',output);for(const b of bindings.values()){await releaseHost(b.node);for(const c of b.chips)await releaseHost(c.node);}bindings.clear();await viewer.dispose();await releaseHost(doc);});
}
