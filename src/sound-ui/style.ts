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
  + '#tts-settings-root .snd-rule,#tts-settings-root .snd-term,#tts-settings-root .snd-unknown{display:flex;gap:6px;align-items:center;flex-wrap:wrap}'
  + '#tts-settings-root .snd-rule-error{flex-basis:100%;color:#f29da6}'
  + '#tts-settings-root .snd-tile-time{font-size:11px;opacity:.75}';
