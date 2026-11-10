import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';
import { runRules } from './support/risu-rules.mjs';

const compiled = await build({ stdin: { contents: "export * from './src/domain/message-controls';export * from './src/domain/inray-display';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const TOP = (n) => `OMNI${n}top`, BOTTOM = (n) => `OMNI${n}bottom`;

/** The trigger these rules replaced, run as Risu ran it: before any rule, told the message's place, asking its role. */
function trigger(enabled, userchat, roleOf) {
  const code = readFileSync('tests/fixtures/message-controls-trigger.lua', 'utf8').replaceAll('__ENABLED__', String(enabled)).replaceAll('__USERCHAT__', String(userchat));
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  lua.lua_pushjsfunction(L, state => { const role = roleOf(lua.lua_tointeger(state, 2)); if (role == null) lua.lua_pushnil(state); else lua.lua_pushstring(state, to_luastring(role)); return 1; });
  lua.lua_setglobal(L, to_luastring('getChatRole'));
  const init = `callbacks={}\nfunction listenEdit(_, fn) table.insert(callbacks, fn) end\n${code}\nfunction render(data, index) for _,fn in ipairs(callbacks) do data=fn("id",data,{index=index}) end return data end`;
  assert.equal(lauxlib.luaL_dostring(L, to_luastring(init)), lua.LUA_OK, lua.lua_tojsstring(L, -1));
  return (text, index) => {
    lua.lua_getglobal(L, to_luastring('render')); lua.lua_pushstring(L, to_luastring(text)); lua.lua_pushinteger(L, index);
    assert.equal(lua.lua_pcall(L, 2, 1, 0), lua.LUA_OK, lua.lua_tojsstring(L, -1));
    const value = to_jsstring(lua.lua_tolstring(L, -1)); lua.lua_pop(L, 1); return value;
  };
}

const samples = {
  plain: 'She smiled.\n"Hello there."',
  one: 'x',
  heading: '<Thoughts>\nplan\n</Thoughts>\n\n## Response\n\nShe smiled.',
  headingBold: 'thinking…\n  ## **Response**  \nBody line\n\n# OOC\nnote',
  headingKorean: '# 응답\n본문입니다.',
  headingLast: 'Body\n# OOC',
  headingLastLine: 'Body\n# OOC\n',
  headingCrlf: 'A\r\n## Response\r\nBody\r\n',
  notHeading: 'Response\n* # Response\n#Responses\n# Response now\nBody',
  thoughts: '<Thoughts>\nfirst\n</Thoughts>\nStory one.\n<Thoughts>again</Thoughts>\nStory two.',
  thoughtsOnly: '</Thoughts>',
  trailing: 'Body\n\n\n',
  leading: '\n\nBody',
  hashes: '#\n##\n# \n#*# Response *',
  drawn: 'Body <div data-omni-footer="3" data-omni-edge="top">x</div>',
  marked: `${TOP(2)}\n\nBody\n\n${BOTTOM(2)}`,
  image: 'Body\n[[@inray::card1::inxshot_abc::832::1216]]\nMore',
  dollars: 'Cost is $1 and $& and $n here\n# Response\n$2 back',
  empty: '',
  long: Array.from({ length: 300 }, (_, i) => `Line ${i} of the story, with "speech" and *thought*.`).join('\n'),
};

test('the rules place a message\'s row where the Lua trigger they replaced did', () => {
  let checked = 0;
  for (const [enabled, userchat] of [[true, false], [true, true], [false, false]]) {
    const rules = api.messageControlsRules(enabled, userchat).map(api.moduleRule);
    for (const [name, text] of Object.entries(samples)) for (const role of ['char', 'user', 'system']) for (const index of [-1, 0, 3]) {
      const then = trigger(enabled, userchat, at => at === index ? role : null)(text, index);
      const now = runRules(text, rules, { index, role: index < 0 ? 'null' : role });
      assert.equal(now, then, `${name}: enabled ${enabled}, reader's too ${userchat}, a ${role}'s message at ${index}`);
      checked++;
    }
  }
  // The comparison would also pass with nothing placed anywhere: some of these must have got their two marks.
  const rules = api.messageControlsRules(true, false);
  assert.equal(runRules(samples.plain, rules, { index: 4, role: 'char' }), `${TOP(4)}\n\n${samples.plain}\n\n${BOTTOM(4)}`);
  assert.equal(runRules(samples.heading, rules, { index: 0, role: 'char' }), `<Thoughts>\nplan\n</Thoughts>\n\n## Response\n\n\n${TOP(0)}\n\n\nShe smiled.\n\n${BOTTOM(0)}`, 'after the heading and its line break');
  assert.equal(runRules(samples.thoughts, rules, { index: 1, role: 'char' }), `<Thoughts>\nfirst\n</Thoughts>\n\n${TOP(1)}\n\n\nStory one.\n<Thoughts>again</Thoughts>\nStory two.\n\n${BOTTOM(1)}`, 'after the first </Thoughts>');
  assert.ok(checked > 500);
});

test('switched off there is no rule; on, only the first asks Risu whose message it is and none writes anything but a mark', () => {
  assert.deepEqual(api.messageControlsRules(false, false), []);
  assert.deepEqual(api.messageControlsRules(false, true), []);
  const rules = api.messageControlsRules(true, false);
  assert.deepEqual(rules.map(rule => rule.comment), ['omni-message-controls-bottom', 'omni-message-controls-heading', 'omni-message-controls-thoughts', 'omni-message-controls-start']);
  assert.ok(rules.every(rule => rule.type === 'editdisplay' && rule.ableFlag), 'display only: the stored message and the request never see a mark');
  // Before every other rule (the token guard is the next, at 10200), in this order.
  assert.deepEqual(rules.map(rule => Number(/<order (-?\d+)>/.exec(rule.flag)[1])), [10303, 10302, 10301, 10300]);
  assert.deepEqual(rules.map(rule => rule.flag.includes('<cbs>')), [true, false, false, false]);
  // None runs for every match (`g`), and each is tried first: a message it has nothing to do in costs its scan.
  for (const rule of rules) { assert.doesNotMatch(rule.flag.replace(/<[^>]*>/g, ''), /g/); assert.equal(api.quietFlag(rule.flag), rule.flag); }
  assert.doesNotMatch(JSON.stringify(rules), /<button|<style|<div/);
  assert.match(rules[0].in, /\{\{role\}\}/); assert.match(rules[0].in, /\{\{chat_index\}\}/);
  assert.doesNotMatch(rules[0].in, /::user/);
  assert.match(api.messageControlsRules(true, true)[0].in, /notequal::\{\{role\}\}::user/);
});

test('a reply nobody is to get a row for is not touched, and not parsed again', () => {
  const rules = api.messageControlsRules(true, false);
  for (const [text, at] of [[samples.heading, { index: 2, role: 'user' }], [samples.heading, { index: -1, role: 'char' }], [samples.drawn, { index: 2, role: 'char' }], [samples.marked, { index: 2, role: 'char' }], ['', { index: 2, role: 'char' }]]) {
    const ran = [];
    assert.equal(runRules(text, rules, { ...at, ran }), text);
    assert.deepEqual(ran, [], 'no rule ran');
  }
  // The bot's reply: the bottom mark, then the one top rule that finds its place.
  const ran = [];
  runRules(samples.heading, rules, { index: 2, role: 'char', ran });
  assert.deepEqual(ran, ['omni-message-controls-bottom', 'omni-message-controls-heading']);
  const plain = [];
  runRules(samples.plain, rules, { index: 2, role: 'char', ran: plain });
  assert.deepEqual(plain, ['omni-message-controls-bottom', 'omni-message-controls-start']);
});

test('a long reply with no heading costs the rules a few scans, not a search that grows with it', () => {
  const rules = api.messageControlsRules(true, false);
  const text = ('가나다 "라마바" # Response 아님\n').repeat(20000) + '<Thoughts>' + 'x'.repeat(200000);
  const before = performance.now();
  for (let i = 0; i < 5; i++) runRules(text, rules, { index: 1, role: 'char' });
  assert.ok(performance.now() - before < 3000, `took ${Math.round(performance.now() - before)} ms`);
});
