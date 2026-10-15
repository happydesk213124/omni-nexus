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
  + '#tts-settings-root .snd-unknown-row{display:flex;gap:6px;align-items:center}'
  + '#tts-settings-root .snd-unknown-row select{flex:1;min-width:0}'
  + '#tts-settings-root .snd-unknown-row button{flex:none;padding:5px 10px}'
  + '#tts-settings-root .snd-rule-error{flex-basis:100%;color:#f29da6}'
  + '#tts-settings-root .snd-rule-word{color:#9aa3b5;font-size:12px}'
  + '#tts-settings-root .snd-tile-time{font-size:11px;opacity:.75}';
