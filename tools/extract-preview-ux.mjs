import { runInNewContext } from 'node:vm';
import { readFileSync, writeFileSync } from 'fs';

const html = readFileSync('docs/settings-ux-preview.html', 'utf8');
const helpStart = html.indexOf('const HELP = ');
const helpEnd = html.indexOf('    function helpKey', helpStart);
if (helpStart < 0 || helpEnd < helpStart) throw new Error('missing preview help dictionary');
const help = runInNewContext(html.slice(helpStart,helpEnd) + ';({tips:HELP,aliases:HELP_ALIAS})', Object.create(null), {timeout:1000});
const style = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const map = {
  dashboard: 'dashboard',
  gen_options: 'gen_options',
  comic_gen: 'comic_gen',
  style_presets: 'style_presets',
  characters: 'characters',
  models: 'models',
  tts: 'curation',
  prompts: 'prompts',
  explorer: 'explorer',
  changelog: 'changelog',
  debug: 'debug',
};
const panes = {};
for (const [previewId, tab] of Object.entries(map)) {
  const re = new RegExp(`<section class="pane[^"]*" id="${previewId}">([\\s\\S]*?)</section>`);
  const m = html.match(re);
  if (!m) throw new Error(`missing pane ${previewId}`);
  panes[tab] = `<section class="pane active" id="${previewId}">${m[1].trim()}</section>`;
}
panes.card = panes.style_presets;
panes.curation = `
<div class="stack">
  <div class="block">캐릭터 말이 박제되면 그 줄을 읽습니다. Power가 꺼져 있으면 읽지 않습니다.</div>
  <label class="row"><span class="row-text"><b>읽기</b></span><span class="sw"><input id="nx-tts-on" type="checkbox"></span></label>
  <div class="row"><span class="row-text"><b>속도</b></span><input class="ctrl" id="nx-tts-rate" type="number" min="0.5" max="2" step="0.1" value="1"></div>
  <div class="row"><span class="row-text"><b>목소리</b></span><select class="ctrl" id="nx-tts-voice"><option value="">기본</option></select></div>
  <div class="actions"><button class="btn-ghost" type="button" id="nx-tts-test">시험 듣기</button></div>
</div>`;

const overlayStart = html.indexOf('<div class="preset-sheet-bg" id="nx-preset-sheet-bg">');
const overlayEnd = html.indexOf('  <script>');
if (overlayStart < 0 || overlayEnd < overlayStart) throw new Error('missing overlays');
const overlays = html.slice(overlayStart, overlayEnd).trim();

const chromeStart = html.indexOf('<header class="top">');
const chromeEnd = html.indexOf('<main class="main">');
if (chromeStart < 0 || chromeEnd < chromeStart) throw new Error('missing chrome');
let chrome = html.slice(chromeStart, chromeEnd);
chrome = chrome.replace('id="nav"', 'id="nx-tabs"');
chrome = chrome.replace(/data-tab="/g, 'data-nx-tab="');
chrome = chrome.replace('data-nx-tab="tts"', 'data-nx-tab="curation"');
chrome = chrome.replace('class="top"', 'class="top head"');
chrome = chrome.replace('class="brand"', 'class="brand head-brand"');
chrome = chrome.replace('class="top-right"', 'class="top-right head-actions"');
chrome = chrome.replace('class="live"', 'class="live nx-live"');
chrome = chrome.replaceAll('class="nav-label"', 'class="nav-label nx-nav-label"');
chrome += `
      <div id="nx-status-grid" hidden>
        <div id="nx-health-value"></div>
        <div id="nx-hook-value"></div>
        <div id="nx-job-card"></div>
      </div>
      <div id="nx-notices" hidden></div>
      <button type="button" id="nx-save-all" hidden></button>
      <span id="nx-save-flash" hidden></span>
      <div id="nx-main"></div>
`;

let css = style;
css = css.replace(/html, body \{ height: 100%; margin: 0; \}/g, '');
css = css.replace(/(?<=^|\n)\s*body \{[\s\S]*?overflow: hidden;\s*\}/g, '');
css = css.replace(/\.app \{/g, '#nx-shell.nx-ux {');
css = css.replace(/\.top \{/g, '#nx-shell.nx-ux .head {');
css = css.replace(/\.top-right/g, '#nx-shell.nx-ux .head-actions');
css = css.replace(/\.brand /g, '#nx-shell.nx-ux .head-brand ');
css = css.replace(/\.brand\{/g, '#nx-shell.nx-ux .head-brand{');
css = css.replace(/\.nav \{/g, '#nx-shell.nx-ux #nx-tabs {');
css = css.replace(/\.nav button/g, '#nx-shell.nx-ux #nx-tabs [data-nx-tab]');
css = css.replace(/\.nav-label/g, '#nx-shell.nx-ux .nx-nav-label');
css = css.replace(/\.main \{/g, '#nx-shell.nx-ux #nx-main {');
css = css.replace(/\.main:has/g, '#nx-shell.nx-ux #nx-main:has');
css = css.replace(/body\.help-on/g, 'html.nx-ux-on.help-on');
css = css.replace(/body\.nav-open/g, 'html.nx-nav-open');
css = css.replace(/html\.nx-nav-open \.nav(?=\s*[, {])/g, 'html.nx-nav-open #nx-shell.nx-ux #nx-tabs');
// Keep the actual pane wrappers: their flex/overflow rules pin the action dock.
css = css.replace(/html\[data-theme="dark"\]/g, 'html.nx-ux-on');
css = `
html.nx-ux-on, html.nx-ux-on body {
  height: 100% !important;
  width: 100% !important;
  margin: 0 !important;
  overflow: hidden !important;
}
html.nx-ux-on #nx-shell.nx-ux {
  position: fixed !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  box-sizing: border-box;
  padding: 0 !important;
  font: 16px/1.38 var(--font);
  background: var(--bg);
  color: var(--text);
}
html.nx-ux-on #nx-shell.nx-ux {
  display: grid !important;
  grid-template-columns: var(--nav-w, 220px) minmax(0, 1fr) !important;
  grid-template-rows: var(--header-h, 56px) auto minmax(0, 1fr) !important;
}
html.nx-ux-on #nx-shell.nx-ux #nx-status-grid,
html.nx-ux-on #nx-shell.nx-ux #nx-save-all,
html.nx-ux-on #nx-shell.nx-ux #nx-save-flash { display: none !important; }
html.nx-ux-on .nx-vendor-keep { display: none !important; }
html.nx-ux-on.help-on #nx-shell.nx-ux #nx-head-help,
html.nx-ux-on body.help-on #nx-shell.nx-ux #nx-head-help { display: block !important; }
${css}
html.nx-ux-on #nx-shell.nx-ux :is(.btn,.btn-ghost,.icon-btn,#nx-tabs button) {
  box-shadow: none !important;
  background-image: none !important;
  border-radius: 12px;
}
html.nx-ux-on #nx-shell.nx-ux .sw input {
  position: relative; display: block; appearance: none !important;
  padding: 0 !important; border: 0 !important; min-width: 0; min-height: 0;
  box-shadow: none !important; flex-shrink: 0;
}
html.nx-ux-on #nx-shell.nx-ux [hidden] { display: none !important; }
@media (max-width: 768px) {
  html.nx-ux-on #nx-shell.nx-ux { grid-template-columns: minmax(0,1fr) !important; }
  html.nx-ux-on #nx-shell.nx-ux { --header-h: 56px; }
  html.nx-ux-on #nx-shell.nx-ux .head { display:flex; gap:4px; padding:6px; min-width:0; flex-wrap:nowrap; }
  html.nx-ux-on #nx-shell.nx-ux .head-brand { display:none; }
  html.nx-ux-on #nx-shell.nx-ux .head-actions { display:flex; flex:1; gap:4px; min-width:0; margin:0; flex-wrap:nowrap; }
  html.nx-ux-on #nx-shell.nx-ux .head-actions .nx-live { display:block; flex:1; min-width:0; font-size:10px; white-space:nowrap; }
  html.nx-ux-on #nx-shell.nx-ux .head :is(button,.icon-btn) { min-width:28px; padding:6px; font-size:11px; white-space:nowrap; }
  html.nx-ux-on #nx-shell.nx-ux #nx-tabs { z-index:102; }
  html.nx-ux-on #drawerBg { z-index:101; }
}
@media (max-width: 425px) {
  #nx-shell.nx-ux :is(.actions,.preset-dock) { display: flex; flex-wrap: wrap; }
  #nx-shell.nx-ux :is(.actions,.preset-dock) > button { flex: 1 1 120px; white-space: normal; }
  #nx-shell.nx-ux #characters .preset-current .actions {
    display: grid;
    grid-template-columns: minmax(76px,1.45fr) repeat(4,minmax(42px,1fr));
    flex-wrap: initial;
  }
  #nx-shell.nx-ux #characters .preset-current .actions > button {
    flex: initial;
    white-space: nowrap;
  }
  #nx-shell.nx-ux :is(.row-text,.field,.block) { min-width: 0; overflow-wrap: anywhere; }
  #nx-shell.nx-ux :is(.grid2,.field-grid.cols-3,.preset-search) { grid-template-columns: minmax(0,1fr); }
}
`;

if (css.includes('.head-help-\n') || css.includes('.ex-pick-\n')) {
  throw new Error('css extract ate a body { rule');
}

// Avoid carrying indentation-only template lines into the generated bundle.
css = css.replace(/[ \t]+$/gm, '');
chrome = chrome.replace(/[ \t]+$/gm, '');
writeFileSync('src/settings-ux/preview-panes.json', JSON.stringify({ panes, overlays, chrome, help }));
writeFileSync('src/settings-ux/preview-css.ts', `export const previewCss = ${JSON.stringify(css)};\n`);
console.log('ok', Object.keys(panes).join(','), css.length, overlays.length);
