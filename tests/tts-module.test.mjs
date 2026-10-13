import test from 'node:test';

import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { build } from 'esbuild';

import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';

import { chromium } from 'playwright';



const compiled = await build({stdin:{contents:"export * from './src/domain/tts/module';export * from './src/domain/tts/segment';export * from './src/domain/tts/filter';export * from './src/storage/tts-module';export * from './src/domain/message-controls';export * from './src/domain/inray-display';export * from './src/config/tts-defaults';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});

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



test('module display name and first-person speech instructions preserve module identity',()=>{

  assert.equal(module.name,'⚛️ omni tts');assert.equal(module.id,'omni-tts');

  assert.match(api.TTS_CUE_PROMPT,/first-person story/);

  assert.match(api.TTS_CUE_PROMPT,/actual name and delivery/);

  assert.match(api.TTS_CUE_PROMPT,/actions, descriptions and unspoken narration remain plain prose/);

});



test('single spoken characters and literal exclusions never produce buttons or playback entries',()=>{

  const terms=api.ttsExcludeTerms('상태창, [시스템], 상태창, ');

  const mod=api.ttsModule({...api.ttsDefaults(),hideName:false,hideTone:false,excludeText:terms.join(', ')}),only=renderer([mod.trigger[0].effect[0].code]);

  for(const cue of ['하린: “응.”','👦 하린 (happy):\n“네!”','Sora: "A."','하린: 「え？」','하린: “é.”','하린: “。!?…”','가.','안녕 상태창 표시.','하린: “[시스템] 안내입니다.”']){

    const marked=only(cue);

    assert.equal(marked,cue,'excluded cues preserve original text: '+cue);

    assert.doesNotMatch(apply(marked,mod.regex),/data-omnitts-play=/,cue);

    assert.deepEqual(api.parseTtsMessage(cue,terms),[],cue);

  }

  const source='하린: “응.”\n하린: “안녕.”\n상태창 정보.\n나무가 흔들렸다.\n👦 Sora:\n“Hello.”';

  const segments=api.parseTtsMessage(source,terms);

  assert.deepEqual(segments.map(s=>[s.id,s.text]),[['2','안녕.'],['4','나무가 흔들렸다.'],['5','Hello.']]);

  const html=apply(only(source),mod.regex);

  assert.equal((html.match(/data-omnitts-play="1"/g)||[]).length,3);

  for(const segment of segments)assert.ok(html.includes('data-omnitts-source="'+api.cueLineKey(source.slice(segment.start,segment.end))+'"'));

  const escaped=api.ttsModule({...api.ttsDefaults(),excludeText:'[[note]], ]=], "quoted"'});

  assert.doesNotMatch(apply(renderer([escaped.trigger[0].effect[0].code])('하린: “[[note]] 안내.”'),escaped.regex),/data-omnitts-play=/,'Lua term literals handle brackets without pattern parsing');

});



test('changed active module refreshes cached display code without touching other modules or chat',async()=>{

  const original=globalThis.risuai,source='하린 (happy): “안녕하세요.”',settings={...api.ttsDefaults(),enabled:true,hideName:false,hideTone:false};

  const old=api.ttsModule(settings),other={id:'other',assets:[['keep','asset','png']]},writes=[];

  let db={modules:[other,old],enabledModules:['other','omni-tts'],characters:[{chats:[{message:[{data:source}]}]}]},cacheIds='',cached=[],renderIds='',display='',reloads=0;

  const update=()=>{

    const ids=db.enabledModules.join('-');

    if(cacheIds!==ids){cacheIds=ids;cached=db.modules.filter(m=>db.enabledModules.includes(m.id));}

    const live=cached.find(m=>m.id==='omni-tts'),renderKey=cached.map(m=>m.id).join('-');

    if(renderKey!==renderIds){renderIds=renderKey;reloads++;display=live?apply(renderer([live.trigger[0].effect[0].code])(source),live.regex):source;}

  };

  update();

  globalThis.risuai={requestPluginPermission:async()=>true,getDatabase:async()=>structuredClone(db),setDatabase:async patch=>{writes.push(structuredClone(patch));db={...db,...patch};update();}};

  try{

    const changed={...settings,hideName:true,hideTone:true};

    await globalThis.risuai.setDatabase({modules:[other,api.ttsModule(changed)]});

    assert.ok(display.includes('하린'),'same-ID writes reproduce Risu display cache staleness');

    db.modules=[other,old];writes.length=0;

    await api.ensureTtsModule(changed);

    assert.equal(writes.length,2);assert.deepEqual(writes.map(w=>w.enabledModules),[['other'],['other','omni-tts']]);

    assert.equal(display.includes('하린'),false,'name hiding affects already-rendered text after the automatic refresh');

    assert.ok(reloads>=3);assert.deepEqual(db.modules[0],other);assert.equal(db.characters[0].chats[0].message[0].data,source);

    writes.length=0;await api.ensureTtsModule(changed);assert.equal(writes.length,0,'unchanged settings do not reload the module');

    await api.ensureTtsModule({...changed,excludeText:'안녕'});assert.doesNotMatch(display,/data-omnitts-play=/,'exclusion updates existing chat buttons');

    await api.ensureTtsModule({...changed,enabled:false});assert.deepEqual(db.enabledModules,['other']);

    writes.length=0;await api.ensureTtsModule(changed);assert.equal(writes.length,1,'power ON is a single activation');

    assert.deepEqual(db.enabledModules,['other','omni-tts']);

  }finally{globalThis.risuai=original;}

});



test('narration OFF keeps the same blue module button ready for plugin visibility',async()=>{

  const off=api.ttsModule({...api.ttsDefaults(),narration:false});

  assert.deepEqual(off,module,'narration visibility must not be baked into module output');

  const html=apply(renderer([off.trigger[0].effect[0].code])('도서관에 햇빛이 내려앉았다.'),off.regex);

  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});

  try {

    const page=await browser.newPage();await page.setContent(off.backgroundEmbedding+html);

    const button=page.locator('[data-omnitts-kind="narration"]');

    assert.equal(await button.count(),1);assert.equal(await button.isVisible(),true);

    assert.equal(await button.evaluate(n=>getComputedStyle(n).color),'rgb(147, 197, 253)');

    const normal=await button.evaluate(n=>getComputedStyle(n).backgroundColor);await button.hover();

    assert.notEqual(await button.evaluate(n=>getComputedStyle(n).backgroundColor),normal,'blue button has hover feedback');

  } finally {await browser.close();}

});



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

  assert.doesNotMatch(html,/<div[^>]*data-omnitts-/,'TTS must not replace the message layout');

});



test('module and playback agree on plain names, emoji headers, English tone and next-line quotations',()=>{

  const only=renderer([module.trigger[0].effect[0].code]);

  for(const cue of ["하린: '반가워요.'",'Sora： 「hello: again.」','하린: ‘반가워요.’','하린: 『반가워요.』','하린: “반가워요.”','하린 (happy): "반가워요."','👨 Sora:\n“자자, 성으로 데려가자.”','🧑‍🚀 Sora (soft tone)：\n“안녕하세요.”','하린：\n"안녕하세요."','이민지 (calm) “안녕하세요.”']){

    const segments=api.parseTtsMessage(cue);assert.equal(segments.length,1,cue);assert.equal(segments[0].kind,'dialogue');

    assert.ok(['하린','Sora','이민지'].includes(segments[0].speaker));

    const key=api.cueLineKey(cue.slice(segments[0].start,segments[0].end));

    const html=apply(only(cue),module.regex);

    assert.equal((html.match(/x-omnitts-play=/g)||[]).length,1,cue);

    assert.ok(html.includes('data-omnitts-source="'+key+'"'),cue);

    assert.ok(html.includes(segments[0].text),cue);

  }

  const multiline='👦하린: “안녕.”\nSora (happy): “반가워.”\n하린:“다시 만났네.”';

  assert.deepEqual(api.parseTtsMessage(multiline).map(s=>[s.speaker,s.kind]),[['하린','dialogue'],['Sora','dialogue'],['하린','dialogue']]);

  assert.equal((apply(only(multiline),module.regex).match(/data-omnitts-kind="dialogue"/g)||[]).length,3);

  for(const text of ['붉은감자:먹으면 체력이 회복된다','하린 (happy): 반가워요.','https://fish.audio/m/123','12:30']){assert.ok(api.parseTtsMessage(text).every(s=>s.kind!=='dialogue'));assert.doesNotMatch(apply(only(text),module.regex),/data-omnitts-kind="dialogue"/);}

  for(const cue of ['👨 Sora:\n“미완성','하린 (happy):','하린：']){

    assert.equal(api.parseTtsMessage(cue).length,0);assert.doesNotMatch(apply(only(cue),module.regex),/x-omnitts-play=/);

  }

});



test('green illustration control renders below the illustration and its hover toolbar',async()=>{

  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});

  try{

    const page=await browser.newPage();

    const html=apply('[[@inray::card-1::inxshot_card-1.webp::832::1216]]',[...imageRules,...module.regex]);

    await page.setContent(module.backgroundEmbedding+html);

    await page.locator('.inray-shot').evaluate(node=>{node.style.width='320px';node.querySelector('img').style.height='200px';});

    const image=await page.locator('.inray-shot img').boundingBox(),bar=await page.locator('[data-omnitts-image]').boundingBox();

    assert.ok(bar.y>=image.y+image.height,'play controls follow image content');

    assert.equal(await page.locator('[data-omnitts-image] button').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(19, 116, 72)');

  }finally{await browser.close();}

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

      assert.ok(html.includes(`data-omnitts-source="${api.cueLineKey(cue)}"`));

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





test('external quotation CSS and cue visibility still operate on original prose, with independent trailing buttons',()=>{

  const settings={...api.ttsDefaults(),hideName:false,hideTone:false};const mod=api.ttsModule(settings),only=renderer([mod.trigger[0].effect[0].code]);

  const source='👨 Sora: “반가워요.”';

  const marked=only(source);assert.ok(marked.startsWith(source),'original quotation, prefix and punctuation are preserved');

  const withoutButtons=text=>text.replace(/OMNITTS[0-9]+L[0-9]+H[0-9-]+[DN]/g,'').replace(/<span data-omnitts-tail="1">([^<>]+)<button[^>]*data-omnitts-play="1"[^>]*>▶<\/button><\/span>/g,'$1').replaceAll('&#8288;','');

  for(const toggle_ban_CSS of [0,1])for(const toggle_cuevisible of [0,1]){

    const toggles={toggle_ban_CSS,toggle_cuevisible};

    const expected=apply(source,external,toggles),actual=apply(marked,[...external,...mod.regex],toggles);

    assert.equal(withoutButtons(actual),expected,'external rules keep the same prose/HTML behavior');

    assert.equal((actual.match(/data-omnitts-play="1"/g)||[]).length,1);

    assert.doesNotMatch(actual,/<div[^>]*data-omnitts-/);

    for(const tail of actual.matchAll(/<span data-omnitts-tail="1">([^<>]+)<button/g))assert.ok(tail[1]==='&#8288;'||[...tail[1]].length===1,'the anchor holds the final glyph or a zero-width joiner');

  }

});



test('inline controls stay inside plain prose and external quote boxes, attached to the last text line',async()=>{

  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});

  try{

    const page=await browser.newPage();

    const mod=api.ttsModule({...api.ttsDefaults(),hideName:false,hideTone:false}),only=renderer([mod.trigger[0].effect[0].code]);

    const source='하린: “긴 대사도 그대로 읽을 수 있어요. 줄바꿈과 대사 상자의 높이는 그대로 유지되어야 합니다.”';

    const externalHtml=apply(only(source),[...external,...mod.regex],{toggle_ban_CSS:0,toggle_cuevisible:1});

    assert.match(externalHtml,/data-omnitts-tail="1"/);

    for(const width of [320,900])for(const html of [externalHtml,'<p>'+apply(only(source),mod.regex)+'</p>']){

      await page.setViewportSize({width:width+80,height:600});

      await page.setContent(mod.backgroundEmbedding+`<main style="width:${width}px;font:20px/1.5 sans-serif">${html}</main>`);

      const bounds=await page.locator('main').boundingBox();

      const button=page.locator('[data-omnitts-play]');const rect=await button.boundingBox();

      assert.equal(rect.width,36);assert.equal(rect.height,36,'the inline control retains a usable click target');

      assert.ok(rect.x>=bounds.x&&rect.x+rect.width<=bounds.x+bounds.width+1,'the control never overflows the message');

      assert.equal(await button.evaluate(n=>getComputedStyle(n).position),'absolute');

      if(html===externalHtml){assert.equal(await button.evaluate(n=>!!n.closest('div')),true);await button.click();}

      const lastText=await page.locator('main').evaluate(n=>{const range=document.createRange(),walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let text,last;while(text=walker.nextNode())if(!text.parentElement.closest('button')&&text.textContent.replace(/\u2060|\s/g,''))last=text;range.setStart(last,last.length-1);range.setEnd(last,last.length);return range.getBoundingClientRect().toJSON();});

      assert.ok(rect.y<lastText.bottom&&rect.y+rect.height>lastText.top,'button must share the last spoken text line: '+JSON.stringify({width,external:html===externalHtml,rect,lastText,html}));

    }

  }finally{await browser.close();}

});

