import type { SoundKind } from '../core/sound-types';

/**
 * The BGM and effect lists use the voice list's markup, so they also take its
 * rules: every TTS rule that names a voice-list id is copied with the id swapped.
 * Desktop, mobile and full-height rules then stay identical without a second copy.
 */
const IDS: Record<string, (k: SoundKind) => string> = {
  'tts-voices': k => `sound-${k}`, 'voice-list': k => `snd-${k}-list`, 'voice-folder-list': k => `snd-${k}-folders`,
  'voice-folder-toggle': k => `snd-${k}-folder-toggle`, 'new-voice-folder': k => `snd-${k}-folder-add`, 'edit-voice-folder': k => `snd-${k}-folder-edit`,
  'voice-folder-menu': k => `snd-${k}-folder-menu`, 'voice-search': k => `snd-${k}-search`, 'clear-voice-search': k => `snd-${k}-search-clear`,
  'voice-count': k => `snd-${k}-count`, 'voice-total': k => `snd-${k}-total`, 'voice-sort': k => `snd-${k}-sort`, 'gender-filter': k => `snd-${k}-filter`,
  'voice-multiselect': k => `snd-${k}-multi`, 'voice-selected-count': k => `snd-${k}-selected-count`, 'select-visible-voices': k => `snd-${k}-select-all`,
  'clear-voice-selection': k => `snd-${k}-clear`, 'edit-selected-voice': k => `snd-${k}-edit`, 'move-selected-voices': k => `snd-${k}-move`,
  'delete-selected-voices': k => `snd-${k}-delete`, 'add-voice': k => `snd-${k}-add`,
};
const ID_PATTERN = new RegExp(`#(${Object.keys(IDS).sort((a, b) => b.length - a.length).join('|')})(?![\\w-])`, 'g');

/** Splits a selector list at top-level commas (not the ones inside :is(…) / :has(…)). */
function splitSelectors(list: string): string[] {
  const out: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}
function rewrite(selector: string): string[] {
  if (!selector.match(ID_PATTERN)) return [];
  return (['bgm', 'sfx'] as const).map(kind => selector.replace(ID_PATTERN, (_m, id: string) => '#' + IDS[id]!(kind)));
}
export function voiceListCssFor(css: string): string {
  let out = '', i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i); if (open < 0) break;
    const head = css.slice(i, open).trim();
    if (head.startsWith('@')) {
      let depth = 1, j = open + 1;
      while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      const inner = voiceListCssFor(css.slice(open + 1, j - 1));
      if (inner) out += `${head}{${inner}}`;
      i = j; continue;
    }
    const close = css.indexOf('}', open); if (close < 0) break;
    const selectors = splitSelectors(head).flatMap(rewrite);
    if (selectors.length) out += `${selectors.join(',')}{${css.slice(open + 1, close)}}`;
    i = close + 1;
  }
  return out;
}

/** Page rules the voice list has no counterpart for. */
export const SOUND_PAGE_CSS = '#tts-settings-root:is([data-sound-page="sound"],[data-sound-page="models"]) :is(#tts-power-controls,#tts-off-notice,#tts-controls){display:none!important}'
  // The full-height rules give .workspace display:flex; a hidden container must still take no space.
  + '#tts-settings-root :is(#sound-controls,#tts-controls)[hidden]{display:none!important}'
  // The glossary fills the height and scrolls inside, like the lists.
  + '#tts-settings-root:has(#sound-glossary:not([hidden])){display:flex;flex-direction:column;min-height:0;padding-bottom:0}'
  + '#tts-settings-root:has(#sound-glossary:not([hidden])) #sound-controls{flex:1;min-height:0;display:flex;flex-direction:column}'
  + '#tts-settings-root #sound-glossary:not([hidden]){flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}'
  + '#tts-settings-root .snd-rule{display:flex;gap:6px;align-items:center;flex-wrap:wrap}'
  // Glossary tiles: everything is on the tile, like a voice tile, no dialog.
  + '#tts-settings-root .snd-tile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:8px}'
  + '#tts-settings-root .snd-tile-grid.compact{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}'
  + '#tts-settings-root .snd-term-tile,#tts-settings-root .snd-unknown-tile{box-sizing:border-box;min-width:0;padding:9px;border:1px solid var(--line,#293144);border-radius:10px;background:var(--surface2,#161d2b)}'
  + '#tts-settings-root .snd-term-tile.off{opacity:.55}'
  + '#tts-settings-root .snd-term-head{display:flex;gap:6px;align-items:center}'
  + '#tts-settings-root .snd-term-effect{flex:1;min-width:0}'
  + '#tts-settings-root .snd-term-head button{min-width:32px;padding:5px 8px}'
  + '#tts-settings-root .snd-term-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;align-items:center}'
  + '#tts-settings-root .snd-chip{display:inline-flex;align-items:center;gap:2px;padding:2px 3px 2px 8px;border-radius:12px;background:var(--soft,rgba(133,91,251,.12));color:var(--ink,#f4f7fb);font-size:12px;max-width:100%;overflow-wrap:anywhere}'
  + '#tts-settings-root .snd-chip button{border:0;background:none;color:var(--muted,#a4a8bc);padding:0 5px;min-width:0;min-height:0;font-size:14px;line-height:1;cursor:pointer}'
  + '#tts-settings-root .snd-chip button:hover{color:#f29da6}'
  + '#tts-settings-root .snd-term-new{flex:1 1 120px;min-width:0;font-size:12px}'
  + '#tts-settings-root .snd-unknown-tile{display:flex;flex-direction:column;gap:6px}'
  + '#tts-settings-root .snd-unknown-tile b{overflow-wrap:anywhere}'
  + '#tts-settings-root .snd-subtabs{display:flex;gap:4px;margin:8px 0 0;border-bottom:1px solid var(--line,#293144)}'
  + '#tts-settings-root .snd-subtabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:8px 14px;color:var(--muted,#a4a8bc);font-weight:600}'
  + '#tts-settings-root .snd-subtabs button[aria-selected="true"]{color:var(--ink,#f4f7fb);border-bottom-color:var(--purple,#7132f5)}'
  + '#tts-settings-root .snd-subtabs small{opacity:.7;font-weight:400}'
  // 다중선택 on the glossary tiles.
  + '#tts-settings-root .snd-gloss-select{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 0}'
  + '#tts-settings-root .snd-gloss-select button{padding:6px 10px;min-height:34px;font-size:12px}'
  + '#tts-settings-root .snd-gloss-select button[aria-pressed="true"]{border-color:#aa82fa;background:#7132f540}'
  + '#tts-settings-root #snd-gloss-picked{font-size:12px;color:var(--muted,#a4a8bc)}'
  + '#tts-settings-root :is(.snd-term-tile,.snd-unknown-tile).picking{position:relative;padding-left:34px;cursor:pointer}'
  + '#tts-settings-root :is(.snd-term-tile,.snd-unknown-tile) .snd-pick{position:absolute;left:10px;top:12px;margin:0}'
  + '#tts-settings-root :is(.snd-term-tile,.snd-unknown-tile).picked{border-color:#aa82fa;background:#7132f530;box-shadow:inset 0 0 0 1px #7132f566}'
  + '#tts-settings-root .snd-unknown-row{display:flex;gap:6px;align-items:center}'
  + '#tts-settings-root .snd-unknown-row select{flex:1;min-width:0}'
  + '#tts-settings-root .snd-unknown-row button{flex:none;padding:5px 10px}'
  + '#tts-settings-root .snd-rule-error{flex-basis:100%;color:#f29da6}'
  + '#tts-settings-root .snd-rule-word{color:#9aa3b5;font-size:12px}'
  + '#tts-settings-root .snd-tile-time{font-size:11px;opacity:.75}'
  // A section behind its off switch: the fieldset disables every control in it; it only has to look it.
  + '#tts-settings-root .snd-gate{border:0;margin:0;padding:0;min-width:0;min-inline-size:0;transition:opacity .15s}'
  + '#tts-settings-root .snd-gate:disabled{opacity:.4;filter:grayscale(1)}'
  + '#tts-settings-root .snd-gate:disabled *{cursor:not-allowed}'
  // The settings sheet already dims a row with a disabled input (.row:has(input:disabled)); inside a gated section that
  // stacked on the section, and rows holding only a select stood out brighter. The section alone dims, evenly.
  + '#tts-settings-root .snd-gate:disabled .row{opacity:1}'
  + '#tts-settings-root .snd-credit{grid-column:1/-1;margin:6px 2px 2px;font-size:11px;color:var(--muted,#a4a8bc);opacity:.8;overflow-wrap:anywhere}';

/**
 * After the copied voice-list rules, so these win on order: a sound needs a name,
 * its tags and a play button, not a square tile. Hundreds of tracks fit in fewer
 * screens, and a phone shows one readable row per sound.
 */
export const SOUND_LIST_CSS = '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list){grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:7px}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-row{aspect-ratio:auto;min-height:0;padding:9px 54px 9px 10px;gap:2px;cursor:pointer}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-top{align-items:center;gap:8px;min-width:0}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-top strong{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-tags{-webkit-line-clamp:1;margin:0;font-size:12px;color:var(--muted,#a4a8bc)}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .snd-row-words{margin:0;font-size:12px;color:#d8c4fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .snd-row-words.none{color:var(--muted,#a4a8bc);opacity:.55}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .snd-row-meta{font-size:10.5px;color:#c9b4ec;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .tile-audition{top:50%;bottom:auto;right:9px;transform:translateY(-50%);width:38px;height:38px;min-width:0;min-height:0;padding:0;border-radius:50%;font-size:13px}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-row.playing{border-color:#ec4899;box-shadow:inset 0 0 0 1px #ec489966}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-row.playing .tile-audition{background:#ec4899;border-color:#f9a8d4;color:#fff}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-row.dragging{opacity:.4}'
  + '#tts-settings-root .voice-folders.drop-ready .folder-item:not(:first-child){outline:1px dashed #a780ef88;outline-offset:-1px}'
  + '#tts-settings-root .voice-folders .folder-item.drop{background:#7132f550;border-color:#b697ff}'
  + '@media(max-width:768px){#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list){grid-template-columns:minmax(0,1fr)}'
  // Three rows above the list on a phone instead of five: search with filter and
  // sort; LLM, + 추가 and 파일; then 폴더 ▾ ＋ beside the selection bar. The browser
  // box steps aside (display:contents) so its bar and list join the explorer grid.
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-command-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-command-bar .voice-search-wrap{flex:1 1 0;min-width:0}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-command-bar>select{flex:none;width:76px;min-width:0;padding-left:8px;padding-right:4px;font-size:12px}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-command-bar>:is([id$="-count"],[id$="-total"]){display:none}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-tools{display:flex;flex-wrap:nowrap!important;gap:6px;width:100%;flex-basis:100%}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-tools>button{flex:1 1 0;min-width:0;white-space:nowrap;min-height:38px;padding-top:6px;padding-bottom:6px}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-tools>.file-menu{flex:none}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-explorer{grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);gap:6px}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-explorer:has(.folders-open){grid-template-rows:auto auto minmax(0,1fr)}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-folders{grid-column:1;grid-row:1;min-width:0}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-folders.folders-open{grid-column:1/-1}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-browser{display:contents}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-selection-bar{grid-column:2;grid-row:1;min-width:0;flex-wrap:wrap;gap:5px;padding-bottom:6px}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-explorer:has(.folders-open) .voice-selection-bar{grid-column:1/-1;grid-row:2}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-selection-bar>button{padding:6px 9px;min-height:36px;font-size:12px}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-selection-bar>[id$="-selected-count"]{font-size:11px}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) :is(#snd-bgm-list,#snd-sfx-list){grid-column:1/-1;grid-row:2}'
  + '#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-explorer:has(.folders-open) :is(#snd-bgm-list,#snd-sfx-list){grid-row:3}}'
  + '@media(max-width:360px){#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-command-bar>select{width:64px;font-size:11px}#tts-settings-root :is(#sound-bgm,#sound-sfx) .voice-selection-bar>[id$="-selected-count"]{display:none}}'
  // Glossary: the effect is a button that opens the searchable picker.
  + '#tts-settings-root .snd-term-effect{flex:1;min-width:0;display:flex;align-items:center;gap:6px;justify-content:space-between;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:7px 10px;font-weight:600}'
  + '#tts-settings-root .snd-term-effect span{opacity:.6;font-size:11px}'
  + '#tts-settings-root .snd-term-effect.empty{border-style:dashed;color:var(--muted,#a4a8bc);font-weight:400}'
  + '#tts-settings-root .snd-unknown-hints{display:flex;flex-wrap:wrap;gap:5px}'
  + '#tts-settings-root .snd-hint{padding:4px 9px;min-height:0;border-radius:14px;font-size:12px;background:#7132f530;border-color:#7132f588;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '#tts-settings-root .snd-hint:hover{background:#7132f560}'
  + '#tts-settings-root .snd-unknown-pick{flex:1;min-width:0}'
  // The picker: a modal list, a bottom sheet on a phone.
  + '#tts-dialogs #snd-pick-dialog{width:480px;max-width:calc(100vw - 24px);height:min(640px,85vh);padding:16px;box-sizing:border-box;flex-direction:column;gap:10px}'
  + '#tts-dialogs #snd-pick-dialog[open]{display:flex}'
  + '#tts-dialogs #snd-pick-dialog .dialog-head{margin:0}'
  + '#tts-dialogs #snd-pick-dialog #snd-pick-search{width:100%;box-sizing:border-box}'
  + '#tts-dialogs #snd-pick-dialog #snd-pick-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:4px}'
  + '#tts-dialogs #snd-pick-dialog .snd-pick-row{display:flex;gap:6px;align-items:stretch}'
  + '#tts-dialogs #snd-pick-dialog .snd-pick-play{flex:none;width:40px;padding:0}'
  + '#tts-dialogs #snd-pick-dialog .snd-pick-name{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;text-align:left;padding:7px 10px}'
  + '#tts-dialogs #snd-pick-dialog .snd-pick-name small{flex-basis:100%;font-size:11px;color:var(--muted,#a4a8bc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '#tts-dialogs #snd-pick-dialog .snd-pick-name em{font-style:normal;font-size:10px;padding:1px 7px;border-radius:8px;background:#ec489933;color:#f9a8d4}'
  + '#tts-dialogs #snd-pick-dialog .snd-pick-row.active .snd-pick-name{border-color:#aa82fa;background:#7132f530}'
  + '#tts-dialogs #snd-pick-dialog #snd-pick-count{color:var(--muted,#a4a8bc);font-size:11px}'
  + '@media(max-width:600px){#tts-dialogs #snd-pick-dialog{width:100vw;max-width:100vw;height:82vh;max-height:82vh;margin:auto 0 0;border-radius:16px 16px 0 0}}';
