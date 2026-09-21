import { readFileSync } from 'node:fs';

/** Applied last: the final save path owns capture, coalescing and retry. */
export function repairSettingsSave(source) {
  let out = source;
  const once = (needle, replacement) => {
    if (out.split(needle).length !== 2) throw new Error('[settings save] needle drift: ' + needle.slice(0, 90));
    out = out.replace(needle, () => replacement);
  };
  const region = (start, end, replacement) => {
    const a = out.indexOf(start), b = out.indexOf(end, a);
    if (a < 0 || b < 0 || out.indexOf(start, a + 1) >= 0) throw new Error('[settings save] region drift: ' + start);
    out = out.slice(0, a) + replacement + out.slice(b);
  };
  region('  async function flushSettingsSave() {', '  function queueSettingsSave(', '');
  region('  async function xa(opts) {', '  function Oe() {', readFileSync(new URL('./settings-save.js', import.meta.url), 'utf8') + '\n');
  region('    const flush = async () => {\n      for (const timer of timers.values())',
    '    globalThis.__OMNI_FLUSH_CHARACTERS__ = flush;', '    const flush = omniFlushLiveWrites;\n');
  region('    const enqueue = (key, work) => {', '    shell.addEventListener("input", event => {', '    const enqueue = omniEnqueueLiveWrite;\n');
  once('    const timers = live.timers;\n    const pending = live.pending;\n', '');
  once('enqueue("prompt:" + key, async () => {await K("/v1/prompts/" + encodeURIComponent(key), { method: "PUT", body: { text } });const row=t.prompts?.find(p=>p.key===key);if(row)row.text=text;});', 'omniQueuePromptSave(key, text);');
  once('    let incoming = e?.settings || null;', `    let incoming = e?.settings || null;
    t._settingsConfirmed = incoming ? JSON.parse(JSON.stringify(incoming)) : null;`);
  once('      t.backendSettings = n?.settings || t.backendSettings;', `      if (n?.settings) t._settingsConfirmed = JSON.parse(JSON.stringify(n.settings));
      t._settingsNeedsCommit = true;
      t.backendSettings = mergeSettingsPatch(n?.settings || t.backendSettings, t.settingsSavePending);`);
  once('  async function At() {', '  async function At() {\n    t._settingsCloseEpoch = (t._settingsCloseEpoch || 0) + 1;');
  // Keep a short debounce for sliders/viewer controls that bypass the field
  // collector. Close/save explicitly flush it instead of waiting for the timer.
  once('        t.uiOpen && $e(`자동 저장 실패: ${z(n?.message || n, 60)}`, !1);\n      });\n    }, 500);', '        omniSaveError(n);\n      });\n    }, 200);');
  return out;
}
