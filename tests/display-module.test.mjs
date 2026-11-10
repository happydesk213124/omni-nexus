import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runRules } from './support/risu-rules.mjs';

// The display module as Risu holds it: rules that carry no stylesheet and stand aside from a message they have
// nothing to do in, the sheet once, and no Lua.
const bundle = await build({ stdin: { contents: `export { ensureInrayDisplayModule, displayModuleCss } from './src/storage/inray-display-module';
  export { ensureInlineTagModule } from './src/storage/inline-tag-module';
  export { ensureOmniHelperModule } from './src/storage/omni-helper-module';
  export { forgetModuleMarks } from './src/storage/module-write';
  export { resetDeviceStore } from './src/storage/device-store';
  export * from './src/domain/inray-display';
  export * from './src/domain/message-controls';
  export { ttsModule } from './src/domain/tts/module';
  export { ttsDefaults } from './src/config/tts-defaults';
  export { soundModule } from './src/domain/sound/module';
  export { soundDefaults } from './src/config/sound-defaults';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

let db, save, writes;
beforeEach(() => {
  db = { modules: [{ id: 'someone-elses', name: 'Other', regex: [], lorebook: [] }], enabledModules: ['someone-elses'] };
  save = new Map(); writes = [];
  globalThis.risuai = {
    pluginStorage: { getItem: async k => structuredClone(save.get(k)), setItem: async (k, v) => { save.set(k, structuredClone(v)); }, removeItem: async k => { save.delete(k); } },
    getDatabase: async keys => Object.fromEntries(keys.map(key => [key, structuredClone(db[key])])),
    setDatabase: async patch => { writes.push(structuredClone(patch)); Object.assign(db, structuredClone(patch)); },
  };
  api.resetDeviceStore(); api.forgetModuleMarks();
});
const ours = () => db.modules.find(m => m.id === 'inlay-inray-display');
const row = { enabled: true, userchat: false, folded: false };
/** What Risu reads in a rule's flags: its order, and whether it names an action (which makes Risu try it first). */
const meta = rule => { const marks = [...rule.flag.matchAll(/<([^>]+)>/g)].flatMap(m => m[1].split(',').map(v => v.trim())); return { order: marks.some(m => m.startsWith('order ')), action: marks.some(m => !m.startsWith('order ')) }; };

test('no rule of the module carries a stylesheet; the sheet is in the module once, the pictures\' and the row\'s', async () => {
  assert.equal(await api.ensureInrayDisplayModule(true, 80, row), true);
  const module = ours();
  assert.ok(module.regex.length >= 13);
  for (const rule of module.regex) assert.doesNotMatch(rule.out, /<style/, `${rule.comment} carries a stylesheet`);
  // What the rules lost is what the module's sheet has: the same text the domain's own drawing starts with.
  const drawn = api.inrayDisplayOut(true, 80), sheet = /^<style>([\s\S]*?)<\/style>/.exec(drawn)[1];
  assert.ok(sheet.length > 3000 && sheet === api.chatDisplayCss(80));
  assert.equal(module.backgroundEmbedding, `<style>${sheet}${api.messageControlsCss(false)}</style>`);
  assert.equal(module.backgroundEmbedding, api.displayModuleCss(80, false));
  // And the picture itself is drawn by the same markup as before, minus the sheet.
  const shot = module.regex.find(rule => rule.comment === 'inray-shot-display');
  assert.equal(shot.out, drawn.slice(drawn.indexOf('</style>') + 8));
  assert.match(shot.out, /^<br><div class="inray-shot"/);
  // A setting that changes the sheet changes the module's copy.
  assert.equal(await api.ensureInrayDisplayModule(true, 120, { ...row, folded: true }), true);
  assert.equal(ours().backgroundEmbedding, api.displayModuleCss(120, true));
  assert.notEqual(api.displayModuleCss(120, true), api.displayModuleCss(80, false));
});

test('every rule of ours is tried before it is run: a message it finds nothing in is not parsed again', async () => {
  await api.ensureInrayDisplayModule(false, 100, row);
  await api.ensureInlineTagModule(true, 100, false);
  await api.ensureOmniHelperModule(true);
  const tts = api.ttsModule({ ...api.ttsDefaults(), hideName: true, hideTone: true, illustration: true });
  const sound = ['bgm', 'sfx'].map(kind => api.soundModule(kind, { ...api.soundDefaults(), sfxFirst: true }, []));
  const rules = [...db.modules.filter(m => m.id !== 'someone-elses'), tts, ...sound].flatMap(m => m.regex.map(rule => ({ ...rule, module: m.id })));
  assert.ok(rules.length >= 40, `${rules.length} rules`);
  for (const rule of rules) {
    assert.equal(rule.ableFlag, true, `${rule.module} ${rule.comment}: Risu reads the marks only with ableFlag`);
    assert.ok(meta(rule).action, `${rule.module} ${rule.comment} (${rule.flag}) names no action`);
  }
  // A plain reply: only the rules with something to do in it run (the row's two, and the speech controls).
  const ran = [];
  runRules('She smiled.\n\n"Hello there."', rules, { index: 3, role: 'char', ran });
  assert.ok(ran.length && ran.length < 12, `${ran.length} of ${rules.length} ran: ${ran.join(', ')}`);
  assert.ok(!ran.some(name => /inray|spinner|wait|token|inline|imgstart|bgm|sfx/.test(name)), ran.join(', '));
  // The request's copy (editprocess): nothing of ours to strip, nothing run.
  const sent = [];
  runRules('She smiled.\n\n"Hello there."', rules, { mode: 'editprocess', index: 3, role: 'char', ran: sent });
  assert.deepEqual(sent, []);
  // The mark is one a host that cannot read `<...>` would not take for a regular expression's flag.
  assert.doesNotMatch(api.QUIET_ACTION, /[dgimsuvy]/);
  assert.equal(api.quietFlag('g<order -10030>'), `g<order -10030><${api.QUIET_ACTION}>`);
  for (const flag of ['gi<order -10110,no_end_nl>', 's<order 10303><cbs>', `g<${api.QUIET_ACTION}>`]) assert.equal(api.quietFlag(flag), flag, 'a rule that names an action keeps its flags');
});

test('the module\'s sheet goes through the same rules behind the chat and comes out as it went in', async () => {
  await api.ensureInrayDisplayModule(false, 100, row);
  await api.ensureInlineTagModule(true, 100, false);
  const rules = db.modules.flatMap(m => m.regex);
  const behind = `\n${ours().backgroundEmbedding}\n`;
  // Risu draws what modules put behind the chat with no message's place (-1) and nobody's role.
  assert.equal(runRules(behind, rules, { index: -1 }), behind);
});

test('a rewritten module is switched off for a frame, so Risu reads its new rules now and not at its next start', async () => {
  await api.ensureInrayDisplayModule(false, 100, row);
  assert.equal(writes.length, 1, 'a first install is one write: the list of ids changes with it');
  assert.deepEqual(writes[0].enabledModules, ['someone-elses', 'inlay-inray-display']);
  writes.length = 0;
  db.enabledModules = ['inlay-inray-display', 'someone-elses', 'a-third'];
  await api.ensureInrayDisplayModule(false, 70, row);
  assert.equal(writes.length, 2);
  assert.ok(writes[0].modules, 'the new module is written with the first');
  assert.deepEqual(writes[0].enabledModules, ['someone-elses', 'a-third'], 'off, the others untouched');
  assert.deepEqual(writes[1], { enabledModules: ['inlay-inray-display', 'someone-elses', 'a-third'] }, 'and back where it was, the modules not sent twice');
  // Nothing to write, nothing switched.
  writes.length = 0;
  api.forgetModuleMarks(); save.delete('onx_module_marks');
  await api.ensureInrayDisplayModule(false, 70, row);
  assert.deepEqual(writes, []);
});

test('the Lua trigger that placed the row is taken out; a trigger of the user\'s, and their rules, stay', async () => {
  await api.ensureInrayDisplayModule(false, 100, row);
  const module = ours();
  const legacy = { comment: 'omni-message-controls', type: 'start', conditions: [], lowLevelAccess: false, effect: [{ type: 'triggerlua', code: 'listenEdit("editDisplay", function(tid, data, meta) return data end)' }] };
  const mine = { comment: 'my-own-trigger', type: 'start', conditions: [], effect: [] }, rule = { comment: 'my-own-rule', in: 'a', out: 'b', type: 'editdisplay' };
  // As a build before this one left it: the trigger in, the placing rules not.
  db.modules = db.modules.map(m => m === module ? { ...module, trigger: [legacy, mine], regex: [...module.regex.filter(r => !/^omni-message-controls-(?!display)/.test(r.comment)), rule] } : m);
  api.forgetModuleMarks(); save.delete('onx_module_marks');
  await api.ensureInrayDisplayModule(false, 100, row);
  const after = ours();
  assert.deepEqual(after.trigger, [mine]);
  assert.ok(after.regex.some(r => r.comment === 'my-own-rule'));
  assert.deepEqual(after.regex.filter(r => /^omni-message-controls-/.test(r.comment)).map(r => r.comment),
    ['omni-message-controls-display', 'omni-message-controls-bottom', 'omni-message-controls-heading', 'omni-message-controls-thoughts', 'omni-message-controls-start']);
  assert.doesNotMatch(JSON.stringify(after), /triggerlua/);
  // The row switched off: its placing rules go, the rule that draws a mark stays (an old mark is still drawn).
  await api.ensureInrayDisplayModule(false, 100, { ...row, enabled: false });
  assert.deepEqual(ours().regex.filter(r => /^omni-message-controls-/.test(r.comment)).map(r => r.comment), ['omni-message-controls-display']);
  // For the reader's messages too: the first rule's pattern lets the reader through.
  await api.ensureInrayDisplayModule(false, 100, { ...row, userchat: true });
  assert.match(ours().regex.find(r => r.comment === 'omni-message-controls-bottom').in, /::user/);
});

test('a reply with pictures is drawn as before, through the module\'s rules', async () => {
  await api.ensureInrayDisplayModule(false, 100, row);
  const rules = ours().regex;
  const text = 'Story.\n[[@inrayspinner::slot1::832::1216]] [[@inray::card_1::inxshot_card_1_a::832::1216]]\nMore.\n[[@inraywait::w1::1024::1024]]';
  const html = runRules(text, rules, { index: 2, role: 'char' });
  assert.equal((html.match(/data-inray-bake="1"/g) || []).length, 1);
  assert.match(html, /data-inray-frame="slot1"/);
  assert.match(html, /data-inray-wait="w1"/);
  assert.equal((html.match(/data-omni-footer="2"/g) || []).length, 2, 'a row above and below');
  assert.doesNotMatch(html, /<style|\[\[@inray||||/, 'no sheet in the message, no mark or mask left');
  // The request never sees a marker.
  assert.equal(runRules(text, rules, { mode: 'editprocess', index: 2, role: 'char' }), 'Story.\n\nMore.\n');
});
