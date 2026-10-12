import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';

const compiled = await build({stdin:{contents:"export * from './src/domain/tts/module';export * from './src/domain/tts/segment';export * from './src/domain/message-controls';export * from './src/domain/inray-display';export * from './src/config/tts-defaults';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const external = JSON.parse(readFileSync('tests/fixtures/tts-external-display.json','utf8'));
const module = api.ttsModule(api.ttsDefaults());

function renderer(codes) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  const init = `callbacks={}\nfunction listenEdit(_, fn) table.insert(callbacks, fn) end\nfunction getChatRole() return 'char' end\n` + codes.join('\n') + '\nfunction render(data) for _,fn in ipairs(callbacks) do data=fn("id",data,{index=2}) end return data end';
  assert.equal(lauxlib.luaL_dostring(L,to_luastring(init)),lua.LUA_OK,lua.lua_tojsstring(L,-1));
  return text => {
    lua.lua_getglobal(L,to_luastring('render')); lua.lua_pushstring(L,to_luastring(text));
    const status = lua.lua_pcall(L,1,1,0);
    assert.equal(status,lua.LUA_OK,lua.lua_tojsstring(L,-1));
    const value = to_jsstring(lua.lua_tolstring(L,-1)); lua.lua_pop(L,1); return value;
  };
}
function cbs(text, toggles) {
  // Only the conditional syntax present in this supplied fixture is modelled.
  // This is not a replacement for Risu's CBS parser.
  for (let i=0;i<12;i++) {
    const next=text.replace(/{{#if(?:_pure)?\s*{{\?\s*{{getglobalvar::([\w]+)}}\s*=\s*([01])\s*}}\s*}}((?:(?!{{#if)[\s\S])*?){{\/if}}/g,(_,key,n,body)=>Number(toggles[key]||0)===Number(n)?body:'');
    if(next===text)break;text=next;
  }
  return text;
}
function apply(text,rules,toggles={}) {
  const ordered=rules.map(rule=>{
    let order=0;let flags=rule.ableFlag?rule.flag||'g':'g';
    flags=flags.replace(/<([^>]+)>/g,(_,body)=>{for(const part of body.split(','))if(part.trim().startsWith('order '))order=parseInt(part.trim().slice(6));return '';});
    return {...rule,order,flags:[...new Set(flags.replace(/[^dgimsuvy]/g,''))].join('')||'u'};
  }).sort((a,b)=>b.order-a.order);
  for(const rule of ordered) {
    let pattern=rule.in;
    if(rule.flag?.includes('<cbs>'))pattern=cbs(pattern,toggles);
    if(!pattern)continue;
    const output=rule.out.replaceAll('$n','\n');
    text=cbs(text.replace(new RegExp(pattern,rule.flags),output),toggles);
  }
  return text;
}
const imageRules=[api.historyDisplayRegexScript(),api.framedAssetDisplayRegexScript(),api.inrayDisplayRegexScript(),api.spinnerDisplayRegexScript()].map((r,i)=>({...r,flag:`g<order ${-10010-i*10}>`}));
const render=renderer([api.messageControlsTrigger(true,false).effect[0].code,module.trigger[0].effect[0].code]);

test('real Lua render keeps source offsets, declines partial cues and skips code/HTML',()=>{
  const only=renderer([module.trigger[0].effect[0].code]);
  const body='하린 (happy): "반가워요."\n\n나레이션입니다.\n하린 (happy): "미완성\n```\n코드 줄\n```\n<div>\n상태창\n</div>';
  const marked=only(body);
  assert.equal((marked.match(/OMNITTS/g)||[]).length,2);
  assert.match(marked,/OMNITTS2L1H[0-9-]+D/); assert.match(marked,/OMNITTS2L3H[0-9-]+N/);
  assert.ok(marked.includes('H'+api.cueLineKey(body.split('\n')[0])+'D'));
  assert.ok(marked.includes('하린 (happy): "미완성'));
  assert.ok(marked.includes('<div>\n상태창\n</div>'));
  assert.equal(only('가나다\n').endsWith('\n\n'),false);
  assert.doesNotMatch(marked,/<button/);
  const html=apply(marked,module.regex);
  assert.equal((html.match(/x-omnitts-play=/g)||[]).length,2);
});

test('attached active rules preserve 14 footer buttons, image hover CSS and TTS controls',()=>{
  const source='# Thoughts\n비공개 추론\n# Response\n하린 (happy): "안녕하세요."\n\n[[@inrayspinner::job_0::832::1216]][[@inray::card-1::inxshot_card-1.webp::832::1216]]\n';
  const html=apply(render(source),[...external,...imageRules,api.messageControlsDisplayScript(),...module.regex]);
  assert.equal((html.match(/data-omni-action=/g)||[]).length,14);
  assert.equal((html.match(/data-inray-bake="1"/g)||[]).length,1);
  assert.match(html,/\.inray-shot\[data-inlay-inline-shot\]:hover \.inray-bar/);
  assert.match(html,/x-omnitts-image="1"/);
  assert.match(html,/data-omnitts-kind="dialogue"/);
  assert.doesNotMatch(html,/비공개 추론/);
  assert.doesNotMatch(html,/[]/);
});

test('moving our final controls ahead of external rules reproduces the hidden top bar',()=>{
  const source='OMNI2top\n# Thoughts\n비공개 추론\n# Response\n본문\nOMNI2bottom';
  const early=apply(source,[api.messageControlsDisplayScript()]);
  const damaged=apply(early,external);
  assert.equal((damaged.match(/data-omni-action=/g)||[]).length,7);
});

test('hidden thoughts never enter playback and footer injection preserves original cue identity in either module order',()=>{
  const cue='하린 (happy): "안녕하세요."';
  for(const source of [`# Thoughts\n숨김\n\n하린 (sad): "숨긴 말"\n# Response\n${cue}`,`<Thoughts>\n숨김\n\n하린 (sad): "숨긴 말"\n</Thoughts>\n${cue}`]) {
    assert.deepEqual(api.parseTtsMessage(source).map(s=>s.text),['안녕하세요.']);
    for(const codes of [[module.trigger[0].effect[0].code,api.messageControlsTrigger(true,false).effect[0].code],[api.messageControlsTrigger(true,false).effect[0].code,module.trigger[0].effect[0].code]]) {
      const html=apply(renderer(codes)(source),[...external,...imageRules,api.messageControlsDisplayScript(),...module.regex]);
      assert.equal((html.match(/x-omnitts-play=/g)||[]).length,1);
      assert.ok(html.includes(`x-omnitts-source="${api.cueLineKey(cue)}"`));
    }
  }
});

test('incomplete delimiters and long streaming tails do not run expanding backtracking searches',()=>{
  const only=renderer([module.trigger[0].effect[0].code]);
  const before=performance.now();
  for(const text of ['하린 ('+'a'.repeat(100000),'가'.repeat(100000),'[[@inray::'.repeat(10000),'OMNITTS2L1D'.repeat(5000)]) {
    apply(only(text),[...imageRules,api.messageControlsDisplayScript(),...module.regex]);
  }
  assert.ok(performance.now()-before<4000);
});
