import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';
import { chromium } from 'playwright';

const compiled = await build({stdin:{contents:"export * from './src/domain/tts/module';export * from './src/domain/tts/anchors';export * from './src/domain/tts/segment';export * from './src/domain/tts/filter';export * from './src/storage/tts-module';export * from './src/domain/message-controls';export * from './src/domain/inray-display';export * from './src/config/tts-defaults';export {normalizeTtsSettings} from './src/storage/tts-store';export * from './src/domain/tts/illustration';export {soundModule} from './src/domain/sound/module';export {soundDefaults} from './src/config/sound-defaults';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const external = JSON.parse(readFileSync('tests/fixtures/tts-external-display.json','utf8'));
const status = JSON.parse(readFileSync('tests/fixtures/tts-dd-status.json','utf8')).data;
const hidden = {...api.ttsDefaults(),hideName:true,hideTone:true};
const module = api.ttsModule(hidden);
const visible = {...api.ttsDefaults(),hideName:false,hideTone:false};
const plain = api.ttsModule(visible);

function renderer(codes) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  const init = `callbacks={}\nfunction listenEdit(_, fn) table.insert(callbacks, fn) end\nfunction getChatRole() return 'char' end\n` + codes.join('\n') + '\nfunction render(data) for _,fn in ipairs(callbacks) do data=fn("id",data,{index=2}) end return data end';
  assert.equal(lauxlib.luaL_dostring(L,to_luastring(init)),lua.LUA_OK,lua.lua_tojsstring(L,-1));
  return text => {
    lua.lua_getglobal(L,to_luastring('render')); lua.lua_pushstring(L,to_luastring(text));
    const code = lua.lua_pcall(L,1,1,0);
    assert.equal(code,lua.LUA_OK,lua.lua_tojsstring(L,-1));
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
const ANCHOR=/<span data-omnitts-tail="1"><button[^>]*data-omnitts-kind="(dialogue|narration)"[^>]*><\/button><\/span>/g;
const strip=html=>html.replace(ANCHOR,'');
const kinds=html=>[...html.matchAll(ANCHOR)].map(m=>m[1]);
// What the host binds: anchors paired with source segments.
const bound=(html,source,terms=[],skip=1)=>{const segments=api.parseTtsMessage(source,terms,skip);return api.matchTtsAnchors(api.ttsAnchorTexts(html),segments).map(i=>i<0?null:segments[i]);};
const imageRules=[api.historyDisplayRegexScript(),api.framedAssetDisplayRegexScript(),api.inrayDisplayRegexScript(),api.spinnerDisplayRegexScript()].map((r,i)=>({...r,flag:`g<order ${-10010-i*10}>`}));
const controls=renderer([api.messageControlsTrigger(true,false).effect[0].code]);

test('module display name and first-person speech instructions preserve module identity',()=>{
  assert.equal(module.name,'⚛️ omni tts');assert.equal(module.id,'omni-tts');
  assert.match(api.TTS_CUE_PROMPT,/first-person story/);
  assert.match(api.TTS_CUE_PROMPT,/actual name and delivery/);
  assert.match(api.TTS_CUE_PROMPT,/actions and descriptions remain plain prose/);
  assert.match(api.TTS_CUE_PROMPT,/inner thoughts use the same cue with single quotes: Name \(delivery\): 'Thought'/);
  assert.equal(api.ttsDefaults().hideName,false);assert.equal(api.ttsDefaults().translation.provider,'google-free');
});

test('the module never edits the reply before other modules: no Lua display trigger and every rule runs last',()=>{
  assert.deepEqual(module.trigger,[],'a display trigger would run before every regex module');
  for(const rule of module.regex.filter(r=>r.comment!=='omnitts-image-controls')){
    const order=Number(/<order (-?\d+)>/.exec(rule.flag)[1]);
    assert.ok(order<=-10200,`${rule.comment} must run after all other display rules`);
  }
  const outputs=JSON.stringify(module.regex.map(r=>r.out));
  assert.doesNotMatch(outputs,/OMNITTS/,'no intermediate tokens exist for other rules to see');
});

test('a supplied status panel regex renders exactly as without TTS and its lines get no controls',()=>{
  const source='[DD_STATUS]\nTIME::Day 3 - 21:40\nJET::120\nBOGART::30\nMARSHAL::45\nLAG::200\nMAX::480\n하린::77\n[/DD_STATUS]\n\n하린 (happy): "안녕하세요."\n그는 웃었다.';
  const alone=apply(source,status);
  assert.match(alone,/class="dd-status"/,'fixture renders the panel by itself');
  for(const mod of [module,plain]) {
    const html=apply(source,[...status,...mod.regex]);
    const panel=html.slice(0,html.indexOf('</div>\n')+6);
    assert.equal(panel,alone.slice(0,alone.indexOf('</div>\n')+6),'status markup is byte-identical');
    assert.doesNotMatch(panel,/data-omnitts/);
    assert.deepEqual(kinds(html),['dialogue','narration']);
    assert.deepEqual(bound(html,source).map(s=>s?.text),['안녕하세요.','그는 웃었다.']);
  }
  assert.equal(strip(apply(source,[...status,...plain.regex])),alone,'without hidden names the whole reply is unchanged apart from the controls');
});

test('external display modules produce identical prose and HTML with the module enabled',()=>{
  const sources=['👨 Sora: “반가워요.”','하린 (happy): "안녕하세요."\n\n나레이션입니다.\n하린 (sad):\n"미안해."','*그녀는 웃었다.* 「좋아요.」\n\n§쾅§\n\n“짧은 대답.”',`# Thoughts\n숨김 "생각"\n# Response\n하린 (happy): "안녕하세요."`];
  for(const source of sources)for(const toggle_ban_CSS of [0,1])for(const toggle_cuevisible of [0,1]){
    const toggles={toggle_ban_CSS,toggle_cuevisible};
    const expected=apply(source,external,toggles),actual=apply(source,[...external,...plain.regex],toggles);
    assert.equal(strip(actual),expected,'external rules see and produce the original text: '+source);
    assert.doesNotMatch(actual,/[]/,'guards never leak');
  }
  const html=apply('👨 Sora: “반가워요.”',[...external,...plain.regex],{toggle_ban_CSS:0,toggle_cuevisible:1});
  assert.match(html,/<div class="regex-quote-block">"반가워요\."<span data-omnitts-tail="1">/,'the control sits inside an external quote box, after its last glyph');
  assert.deepEqual(bound(html,'👨 Sora: “반가워요.”').map(s=>s?.speaker),['Sora']);
});

test('single spoken characters and literal exclusions never play, and excluded lines get no control',()=>{
  const terms=api.ttsExcludeTerms('상태창, [시스템], 상태창, ');
  const mod=api.ttsModule({...visible,excludeText:terms.join(', ')});
  for(const cue of ['하린: “응.”','👦 하린 (happy):\n“네!”','Sora: "A."','하린: 「え？」','하린: “é.”','하린: “。!?…”','가.','안녕 상태창 표시.','하린: “[시스템] 안내입니다.”']){
    const html=apply(cue,mod.regex);
    assert.equal(strip(html),cue,'excluded cues preserve original text: '+cue);
    assert.deepEqual(api.parseTtsMessage(cue,terms),[],cue);
    assert.ok(bound(html,cue,terms).every(s=>s===null),'any remaining control stays unbound and hidden: '+cue);
  }
  for(const cue of ['안녕 상태창 표시.','하린: “[시스템] 안내입니다.”'])assert.deepEqual(kinds(apply(cue,mod.regex)),[],'literal terms are filtered in the display rule itself');
  const source='하린: “응.”\n하린: “안녕.”\n상태창 정보.\n나무가 흔들렸다.\n👦 Sora:\n“Hello.”';
  const html=apply(source,mod.regex);
  assert.deepEqual(bound(html,source,terms).filter(Boolean).map(s=>[s.id,s.text]),[['2','안녕.'],['4','나무가 흔들렸다.'],['5','Hello.']]);
  const escaped=api.ttsModule({...api.ttsDefaults(),excludeText:'[[note]], ]=], "quoted", a|b, (x)'});
  assert.deepEqual(kinds(apply('하린: “[[note]] 안내.”\n그는 a|b 를 봤다.\n하린: “다른 말.”',escaped.regex)),['dialogue'],'regex metacharacters in terms are literal');
});

test('a spoken line split into several quote boxes binds once, to the box that ends it',()=>{
  const sources=[`Jet (curious): "어디 보자... '드릴 히어로 신선했다 ㅋㅋㅋ', '맥스 덤프트럭 등장은 솔직히 반칙 아님?', '저 하얀 애는 누구임? 신캐임? 멍때리는 거 개귀엽네'..."`,`하린: "나무, '피떡', "행복", "분영" "`,`하린: '행복, "라면", '치킨', 피자'`];
  for(const source of sources){
    const [segment]=api.parseTtsMessage(source);
    assert.equal(segment?.kind,'dialogue',source);
    assert.match(segment.text,/^[^"'“”]/,'the outermost quotes are the speech boundary');
    for(const toggles of [{toggle_ban_CSS:0,toggle_cuevisible:0},{toggle_ban_CSS:1,toggle_cuevisible:1}]){
      const html=apply(source,[...external,...module.regex],toggles);
      const bound2=bound(html,source);
      assert.deepEqual(bound2.filter(Boolean).map(s=>s.text),[segment.text],'exactly one control plays the whole line: '+source);
      assert.ok(bound2.at(-1),'the final box carries the playable control');
    }
  }
});

test('symbol-only lines are never voiced; brackets are stripped only from what Fish hears',()=>{
  for(const text of ['[00:10… 00:09… 00:08…]','12:30 - 13:45','!!! ??? ...','[1/3] (2)']){
    assert.deepEqual(api.parseTtsMessage(text),[],text);
    assert.deepEqual(kinds(apply(text,module.regex)),[],text);
  }
  assert.equal(api.parseTtsMessage('[00:00 - SHOOTING FINISHED]').length,1,'letters keep the line');
  const loose=api.ttsModule({...api.ttsDefaults(),skipSymbolOnly:false});
  assert.deepEqual(kinds(apply('[00:10… 00:09…]',loose.regex)),['narration'],'turning the toggle off gives symbol-only lines a control');
  assert.equal(api.parseTtsMessage('[00:10… 00:09…]',[],1,false).length,1,'and they become playable');
  assert.equal(api.ttsSpokenText('[00:00 - SHOOTING FINISHED]',true),'00:00 - SHOOTING FINISHED');
  assert.equal(api.ttsSpokenText('[00:00 - SHOOTING FINISHED]',false),'[00:00 - SHOOTING FINISHED]');
  assert.equal(api.ttsSpokenText('【시스템】 안내 [끝]',true),'시스템 안내 끝');
});

test('status-panel exclusions are default, merged once into older saves, then left to the user',()=>{
  // § is the effect mark now: a line with one is read without it (segment.ts), so it is no longer a default.
  const terms=['┣','::','DD_','✨Upcoming'];
  assert.deepEqual(api.ttsExcludeTerms(api.ttsDefaults().excludeText),terms);
  const old=api.normalizeTtsSettings({excludeText:'상태창'});
  assert.deepEqual(api.ttsExcludeTerms(old.excludeText),['상태창',...terms],'existing terms stay first');
  assert.equal(old.excludeSeed,1);
  assert.equal(api.normalizeTtsSettings({...old,excludeText:'상태창'}).excludeText,'상태창','a user who removed the defaults keeps them removed');
  assert.equal(api.normalizeTtsSettings({excludeText:'┣, §, ::',excludeSeed:1}).excludeText,'┣, §, ::','a save that has § keeps it: it is never taken out by itself');
  assert.deepEqual(api.ttsExcludeTerms('a,\nb\nc, a'),['a','b','c'],'one term per line works in the textarea too');
  for(const line of ['┣ 체력 99','JET::120','DD_STATUS 표시','✨Upcoming: 다음 화'])assert.deepEqual(api.parseTtsMessage(line,terms),[],line);
});

test('illustration speech is read from the caption tail like the shot-tag editor',()=>{
  assert.equal(api.illustrationSpeech('1girl, smile, speechbubble, korean text:안녕, 반가워!'),'안녕, 반가워!','commas inside the line are kept');
  assert.equal(api.illustrationSpeech('boy, thought bubble, japanese text:こんにちは'),'こんにちは');
  assert.equal(api.illustrationSpeech('girl, 1.2::speechbubble, english text:Stop.::'),'Stop.');
  assert.equal(api.illustrationSpeech('girl, 2::speech bubble:: 2::huge text::, korean text:안돼, 가지마'),'안돼, 가지마','말풍선 강조 / 글씨 크게');
  assert.equal(api.illustrationSpeech('girl, smile, looking at viewer'),'');
});

test('changed active module refreshes cached display code without touching other modules or chat',async()=>{
  const original=globalThis.risuai,source='하린 (happy): “안녕하세요.”',settings={...api.ttsDefaults(),enabled:true,hideName:false,hideTone:false};
  const old=api.ttsModule(settings),other={id:'other',assets:[['keep','asset','png']]},writes=[];
  let db={modules:[other,old],enabledModules:['other','omni-tts'],characters:[{chats:[{message:[{data:source}]}]}]},cacheIds='',cached=[],renderIds='',display='',reloads=0;
  const update=()=>{
    const ids=db.enabledModules.join('-');
    if(cacheIds!==ids){cacheIds=ids;cached=db.modules.filter(m=>db.enabledModules.includes(m.id));}
    const live=cached.find(m=>m.id==='omni-tts'),renderKey=cached.map(m=>m.id).join('-');
    if(renderKey!==renderIds){renderIds=renderKey;reloads++;display=live?apply(source,live.regex):source;}
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

test('module and playback agree on plain names, emoji headers, English tone and next-line quotations',()=>{
  for(const mod of [module,plain])for(const cue of ["하린: '반가워요.'",'Sora： 「hello: again.」','하린: ‘반가워요.’','하린: 『반가워요.』','하린: “반가워요.”','하린 (happy): "반가워요."','👨 Sora:\n“자자, 성으로 데려가자.”','🧑‍🚀 Sora (soft tone)：\n“안녕하세요.”','하린：\n"안녕하세요."','이민지 (calm) “안녕하세요.”']){
    const segments=api.parseTtsMessage(cue);assert.equal(segments.length,1,cue);assert.equal(segments[0].kind,'dialogue');
    const html=apply(cue,mod.regex);
    assert.deepEqual(kinds(html),['dialogue'],cue);
    assert.deepEqual(bound(html,cue).map(s=>s?.text),[segments[0].text],cue);
  }
  const html=apply('하린 (happy): "반가워요."\nSora (sad):\n"잘 가."',module.regex);
  assert.doesNotMatch(strip(html),/하린|happy|Sora|sad/,'hidden names and tones leave only the quotation');
  assert.match(strip(html),/^"반가워요\."\n"잘 가\."$/);
  const toneOnly=apply('하린 (happy): "반가워요."',api.ttsModule({...api.ttsDefaults(),hideName:true,hideTone:false}).regex);
  assert.equal(strip(toneOnly),'(happy) "반가워요."');
  const nameOnly=apply('하린 (happy): "반가워요."',api.ttsModule({...api.ttsDefaults(),hideName:false,hideTone:true}).regex);
  assert.equal(strip(nameOnly),'하린: "반가워요."');
  const multiline='👦하린: “안녕.”\nSora (happy): “반가워.”\n하린:“다시 만났네.”';
  assert.deepEqual(api.parseTtsMessage(multiline).map(s=>[s.speaker,s.kind]),[['하린','dialogue'],['Sora','dialogue'],['하린','dialogue']]);
  assert.deepEqual(kinds(apply(multiline,module.regex)),['dialogue','dialogue','dialogue']);
  for(const text of ['붉은감자:먹으면 체력이 회복된다','하린 (happy): 반가워요.','https://fish.audio/m/123','12:30']){assert.ok(api.parseTtsMessage(text).every(s=>s.kind!=='dialogue'));assert.ok(!kinds(apply(text,module.regex)).includes('dialogue'),text);}
  for(const cue of ['👨 Sora:\n“미완성','하린 (happy):','하린：']){
    assert.equal(api.parseTtsMessage(cue).length,0);assert.deepEqual(kinds(apply(cue,module.regex)),[],cue);
    assert.equal(apply(cue,module.regex),cue,'unfinished cues are left exactly as streamed');
  }
});

test('code, CSS, form fields and hidden reasoning never receive a control',()=>{
  const source='하린 (happy): "반가워요."\n\n나레이션입니다.\n```\n코드 줄 "x"\n```\n<style>\n.box{color:red}\nbody p\n</style>\n<textarea>\n입력 줄\n</textarea>\n    들여쓴 코드\n# 제목\n| 표 | 줄 |\n<!--\n주석 줄\n-->\n<thoughts>\n생각 줄\n</thoughts>';
  const html=apply(source,plain.regex);
  assert.equal(strip(html),source,'guards and controls leave every byte of the reply');
  // Other modules may wrap a whole reply in <Thoughts>, so reasoning is not a
  // display guard; its lines simply never bind to a playable source segment.
  assert.deepEqual(api.ttsAnchorTexts(html).map(a=>a.text),['하린 (happy): "반가워요."','나레이션입니다.','생각 줄']);
  assert.deepEqual(bound(html,source).map(s=>s?.text??null),['반가워요.','나레이션입니다.',null]);
  assert.doesNotMatch(html,/<style>[^<]*data-omnitts/);
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
    assert.deepEqual(kinds(html),[],'image markup lines get no line control');
  }finally{await browser.close();}
});

test('attached active rules preserve 14 footer buttons, image hover CSS and TTS controls',()=>{
  const source='# Thoughts\n비공개 추론\n# Response\n하린 (happy): "안녕하세요."\n\n[[@inrayspinner::job_0::832::1216]][[@inray::card-1::inxshot_card-1.webp::832::1216]]\n';
  const html=apply(controls(source),[...external,...imageRules,api.messageControlsDisplayScript(),...module.regex]);
  assert.equal((html.match(/data-omni-action=/g)||[]).length,14);
  assert.equal((html.match(/data-inray-bake="1"/g)||[]).length,1);
  assert.match(html,/\.inray-shot\[data-inlay-inline-shot\]:hover \.inray-bar/);
  assert.match(html,/x-omnitts-image="1"/);
  assert.deepEqual(kinds(html),['dialogue']);
  assert.doesNotMatch(html,/비공개 추론/);
  assert.doesNotMatch(html,/[-]/,'no guard or footer token survives');
});

test('moving our final controls ahead of external rules reproduces the hidden top bar',()=>{
  const source='OMNI2top\n# Thoughts\n비공개 추론\n# Response\n본문\nOMNI2bottom';
  const early=apply(source,[api.messageControlsDisplayScript()]);
  const damaged=apply(early,external);
  assert.equal((damaged.match(/data-omni-action=/g)||[]).length,7);
});

test('hidden thoughts never enter playback and controls bind to the original cue',()=>{
  const cue='하린 (happy): "안녕하세요."';
  for(const source of [`# Thoughts\n숨김\n\n하린 (sad): "숨긴 말"\n# Response\n${cue}`,`<Thoughts>\n숨김\n\n하린 (sad): "숨긴 말"\n</Thoughts>\n${cue}`]) {
    assert.deepEqual(api.parseTtsMessage(source).map(s=>s.text),['안녕하세요.']);
    const html=apply(controls(source),[...external,...imageRules,api.messageControlsDisplayScript(),...module.regex]);
    assert.deepEqual(bound(html,source).filter(Boolean).map(s=>api.cueLineKey(source.slice(s.start,s.end))),[api.cueLineKey(cue)]);
  }
});

test('incomplete delimiters and long streaming tails do not run expanding backtracking searches',()=>{
  const before=performance.now();
  for(const text of ['하린 ('+'a'.repeat(100000),'가'.repeat(100000),'[[@inray::'.repeat(10000),'"'.repeat(50000),'```\n'+'가 "나"\n'.repeat(20000),('그는 "말했다" 그리고 떠났다.\n').repeat(4000),'<div class="x">'.repeat(10000),('가나다 [[bgm:calm\n').repeat(20000)]) {
    apply(text,[...imageRules,api.messageControlsDisplayScript(),...module.regex]);
  }
  assert.ok(performance.now()-before<4000);
});

test('a BGM marker still streaming in gets no control, like the reader that never reads it',()=>{
  for(const partial of ['[[bgm:calm, ca','[[BGM:calm, cafe, slow','그 순간 [[bgm:tense']) {
    assert.deepEqual(kinds(apply(`문이 열렸다.\n${partial}`,plain.regex)),['narration'],'only the prose line: '+partial);
    assert.deepEqual(api.parseTtsMessage(partial,[]),[],'the reader skips it too: '+partial);
  }
});

test('narration OFF does not change the module; hiding is left to the plugin',async()=>{
  const off=api.ttsModule({...hidden,narration:false});
  assert.deepEqual(off,module,'narration visibility must not be baked into module output');
  const html=apply('도서관에 햇빛이 내려앉았다.\n하린 (happy): "안녕하세요."',off.regex);
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await page.setContent(off.backgroundEmbedding+'<p>'+html.replace('\n','<br>')+'</p>');
    const button=page.locator('[data-omnitts-kind="narration"]');
    assert.equal(await button.isVisible(),true);
    assert.equal(await button.evaluate(n=>getComputedStyle(n).color),'rgb(147, 197, 253)');
    const normal=await button.evaluate(n=>getComputedStyle(n).backgroundColor);await button.hover();
    assert.notEqual(await button.evaluate(n=>getComputedStyle(n).backgroundColor),normal,'blue button has hover feedback');
    // Visibility is the plugin's job (inline style on each control), never a module rule.
    assert.doesNotMatch(off.backgroundEmbedding,/x-omnitts-narration|x-omnitts-dead|display:none/);
    await button.evaluate(n=>n.style.display='none');
    assert.equal(await button.isVisible(),false,'a plugin-set inline style hides the control');
    assert.equal(await page.locator('[data-omnitts-kind="dialogue"]').isVisible(),true);
  } finally {await browser.close();}
});

test('with the gutter on, only the gutter changes the layout',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try{
    const page=await browser.newPage(),gutter=api.ttsModule({...visible,controlGutter:true});
    const source='바람이 불었다. 나뭇잎이 흔들리고 멀리서 종소리가 들려왔다 그리고 다시 조용해졌다.\n하린: “긴 대사도 그대로 읽을 수 있어요.”';
    const withTts='<p>'+apply(source,gutter.regex).replace('\n','<br>')+'</p>',without='<p>'+source.replace('\n','<br>')+'</p>';
    for(const width of [233,320,517]){
      const glyphs=async (html,pad)=>{await page.setContent(gutter.backgroundEmbedding+`<main style="width:${width}px;font:20px/1.5 sans-serif">${html}</main>`);
        return page.locator('main').evaluate((n,pad)=>{if(pad)n.querySelector('p').style.paddingInlineEnd='32px';const p=getComputedStyle(n.querySelector('p')).paddingInlineEnd;const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),rows=[];let t;while(t=w.nextNode()){const r=document.createRange();for(let i=0;i<t.length;i++){r.setStart(t,i);r.setEnd(t,i+1);const b=r.getBoundingClientRect();if(b.width)rows.push([t.data[i],Math.round(b.left),Math.round(b.top)]);}}return {p,rows};},pad);};
      const on=await glyphs(withTts,false),off=await glyphs(without,true);
      assert.equal(on.p,'32px','the paragraph with controls keeps the gutter');
      assert.deepEqual(on.rows,off.rows,'every glyph sits where it would without TTS given the same gutter: '+width);
    }
  } finally { await browser.close(); }
});

test('controls never change wrapping and sit right after the last glyph; the playing control animates',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try{
    const page=await browser.newPage();
    const source='하린: “긴 대사도 그대로 읽을 수 있어요. 줄바꿈과 대사 상자의 높이는 그대로 유지되어야 합니다.”\n바람이 불었다. 나뭇잎이 흔들리고 멀리서 종소리가 들려왔다 그리고 다시 조용해졌다.';
    const toggles={toggle_ban_CSS:0,toggle_cuevisible:1};
    for(const width of [233,320,517,900])for(const [withTts,without] of [[apply(source,[...external,...plain.regex],toggles),apply(source,external,toggles)],['<p>'+apply(source,plain.regex).replace('\n','<br>')+'</p>','<p>'+source.replace('\n','<br>')+'</p>']]){
      await page.setViewportSize({width:width+80,height:700});
      // Blocks are addressed by their place among element children, controls left out, so both pages agree.
      const lines=async (html,gutters)=>{
        await page.setContent(plain.backgroundEmbedding+`<style>.regex-quote-block{border:1px solid #888;padding:6px}</style><main style="width:${width}px;font:20px/1.5 sans-serif">${html}</main>`);
        return page.locator('main').evaluate((n,gutters)=>{
          const kids=el=>[...el.children].filter(c=>!c.matches('[data-omnitts-tail]'));
          const pathOf=el=>{const path=[];for(let e=el;e!==n;e=e.parentElement)path.unshift(kids(e.parentElement).indexOf(e));return path;};
          const at=path=>path.reduce((el,i)=>kids(el)[i],n);
          // The page without TTS gets the same gutter on the same blocks; the page with TTS reports where it has one.
          if(gutters)for(const path of gutters)at(path).style.paddingInlineEnd='32px';
          const found=gutters?null:[...n.querySelectorAll('*')].filter(el=>!el.closest('[data-omnitts-tail]')&&getComputedStyle(el).paddingInlineEnd==='32px').map(pathOf);
          const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),rows=[];let t;while(t=walker.nextNode()){const range=document.createRange();for(let i=0;i<t.length;i++){range.setStart(t,i);range.setEnd(t,i+1);const r=range.getBoundingClientRect();if(r.width)rows.push([t.data[i],Math.round(r.left),Math.round(r.top)]);}}
          return {layout:{rows,height:n.getBoundingClientRect().height},found};
        },gutters);
      };
      const after=await lines(withTts),before=await lines(without,after.found);
      assert.deepEqual(after.found,[],'「재생 버튼 자리 여백」 off (the default): no gutter, every glyph exactly where it is without TTS');
      assert.deepEqual(after.layout,before.layout,'every glyph sits where it would without TTS, given the same gutter: the gutter is the only change: '+width);
      await lines(withTts);
      const buttons=page.locator('[data-omnitts-play]');
      assert.equal(await buttons.count(),2);
      for(let i=0;i<2;i++){
        const rect=await buttons.nth(i).boundingBox();
        assert.ok(rect.width>=24&&rect.height>=24,'usable click target');
        const glyph=await buttons.nth(i).evaluate(b=>{const tail=b.parentElement,range=document.createRange();let node=tail.previousSibling;while(node&&!(node.nodeType===3&&node.data.trim()))node=node.lastChild||node.previousSibling;range.setStart(node,node.data.length-1);range.setEnd(node,node.data.length);return range.getBoundingClientRect().toJSON();});
        assert.ok(rect.x>=glyph.right-1&&rect.x<=glyph.right+12,'control starts right after the last glyph');
        assert.ok(rect.y<glyph.bottom&&rect.y+rect.height>glyph.top,'control shares the last text line');
      }
    }
    const button=page.locator('[data-omnitts-play]').first();
    const idle=await button.evaluate(n=>getComputedStyle(n).animationName);
    await button.evaluate(n=>n.setAttribute('x-omnitts-state','playing'));
    assert.equal(idle,'none');assert.equal(await button.evaluate(n=>getComputedStyle(n).animationName),'omnitts-pulse');
    assert.equal(await button.evaluate(n=>getComputedStyle(n,'::before').animationName),'omnitts-eq','equalizer bars move while playing');
    await button.evaluate(n=>n.setAttribute('x-omnitts-state','loading'));
    assert.equal(await button.evaluate(n=>getComputedStyle(n,'::before').animationName),'omnitts-spin');
  }finally{await browser.close();}
});

test('a one-line tag hides only its own line; a block tag still hides its block', () => {
  const kinds = text => api.parseTtsMessage(text).map(s => [s.kind, s.speaker]);
  const img = '<img src=(Kuromiya_hina.exhausted.webp)>\nHina (exhausted): "하아... 하... 여보... 진짜... 사랑해..."\n태양은 숨을 고르며 소파 옆 협탁에서 티슈와 물티슈를 집어 들었다.';
  assert.deepEqual(kinds(img), [['dialogue', 'Hina'], ['narration', '']], 'an image line right above dialogue');
  assert.deepEqual(kinds('<span class="x">장면</span>\n그녀가 웃었다.'), [['narration', '']]);
  assert.deepEqual(kinds('<br/>\n그녀가 웃었다.'), [['narration', '']]);
  assert.deepEqual(kinds('<div class="panel">\n상태 패널 안의 글\n<img src=a.webp>\n여전히 패널 안\n</div>\n\n바깥 나레이션이다.'), [['narration', '']], 'lines inside a <div> block stay hidden');
});

test('narration with parentheses gets its control; a speaker header alone does not', () => {
  const rules = api.ttsModule(visible).regex;
  assert.deepEqual(kinds(apply('그는 (작게) 한숨을 쉬었다.', rules)), ['narration'], 'parentheses are prose');
  assert.deepEqual(kinds(apply('(조용한 밤이었다)', rules)), ['narration']);
  assert.deepEqual(kinds(apply('하린 (angry):', rules)), [], 'a cue header waiting for its quote is not narration');
  assert.deepEqual(kinds(apply('하린 (angry): "그만해."', rules)), ['dialogue']);
  const source = '그는 (작게) 한숨을 쉬었다.';
  assert.equal(bound(apply(source, rules), source)[0]?.kind, 'narration', 'the host binds it to the line the player reads');
});

test('a line with an effect keeps its own control next to the effect ▶, as it is read', () => {
  const sfx = api.soundModule('sfx', { ...api.soundDefaults(), sfxEnabled: true }, []).regex, tts = api.ttsModule(visible).regex;
  const SFX = /data-omni-sfx="1"/g;
  for (const [line, kind] of [['§끼이익§ 문이 열렸다.', 'narration'], ['그가 문을 닫았다. §쾅§', 'narration'], ['하린 (calm): "§쾅§ 깜짝이야."', 'dialogue']]) {
    const html = apply(line, [...sfx, ...tts]);
    assert.equal((html.match(SFX) || []).length, 1, line + ': the effect ▶');
    assert.deepEqual(kinds(html), [kind], line + ': and the line\'s own control');
    assert.equal(bound(html, line).filter(Boolean)[0]?.kind, kind, line + ': and the host pairs that control with the line it reads');
  }
  // A real raw block is still guarded: a button that is not ours gets no control in its line.
  assert.deepEqual(kinds(apply('<button>눌러</button> 문이 열렸다.', tts)), []);
});

test('a line that is only an effect mark never gets a narration control, not even while it streams', () => {
  const marks = [{ open: '§', close: '§' }], sfx = api.soundModule('sfx', { ...api.soundDefaults(), sfxEnabled: true }, []).regex, tts = api.ttsModule(visible, marks).regex;
  for (const partial of ['§ 쾅!', '§ 쾅! §', '  §우르르 쾅§  ']) assert.deepEqual(kinds(apply(partial, [...sfx, ...tts])), [], partial);
  assert.equal((apply('§ 쾅! §', [...sfx, ...tts]).match(/data-omni-sfx="1"/g) || []).length, 1, 'the effect keeps its own ▶');
  for (const mixed of ['§끼이익§ 문이 열렸다.', '그가 문을 닫았다. §쾅§']) assert.deepEqual(kinds(apply(mixed, [...sfx, ...tts])), ['narration'], mixed);
  assert.deepEqual(kinds(apply('§ 쾅! §\n그가 웃었다.', [...sfx, ...tts])), ['narration'], 'the next line is unaffected');
  assert.deepEqual(kinds(apply('§ 쾅! §', api.ttsModule(visible).regex)), ['narration'], 'without effect marks (effects off) nothing changes');
  const own = api.ttsModule(visible, [{ open: '[[', close: ']]' }]).regex;
  assert.deepEqual(kinds(apply('[[쾅]]', own)), [], 'any rule\'s marks, written literally');
});
