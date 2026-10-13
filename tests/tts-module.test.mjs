import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';
import { chromium } from 'playwright';

const compiled = await build({stdin:{contents:"export * from './src/domain/tts/module';export * from './src/domain/tts/anchors';export * from './src/domain/tts/segment';export * from './src/domain/tts/filter';export * from './src/storage/tts-module';export * from './src/domain/message-controls';export * from './src/domain/inray-display';export * from './src/config/tts-defaults';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const external = JSON.parse(readFileSync('tests/fixtures/tts-external-display.json','utf8'));
const status = JSON.parse(readFileSync('tests/fixtures/tts-dd-status.json','utf8')).data;
const module = api.ttsModule(api.ttsDefaults());
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
  assert.match(api.TTS_CUE_PROMPT,/actions, descriptions and unspoken narration remain plain prose/);
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
  for(const text of ['하린 ('+'a'.repeat(100000),'가'.repeat(100000),'[[@inray::'.repeat(10000),'"'.repeat(50000),'```\n'+'가 "나"\n'.repeat(20000),('그는 "말했다" 그리고 떠났다.\n').repeat(4000),'<div class="x">'.repeat(10000)]) {
    apply(text,[...imageRules,api.messageControlsDisplayScript(),...module.regex]);
  }
  assert.ok(performance.now()-before<4000);
});

test('narration OFF and dead controls are hidden by CSS alone; the module output does not change',async()=>{
  const off=api.ttsModule({...api.ttsDefaults(),narration:false});
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
    await page.evaluate(()=>document.body.setAttribute('x-omnitts-narration','off'));
    assert.equal(await button.isVisible(),false,'one root attribute hides narration across re-renders');
    assert.equal(await page.locator('[data-omnitts-kind="dialogue"]').isVisible(),true);
    await page.locator('[data-omnitts-kind="dialogue"]').evaluate(n=>n.setAttribute('x-omnitts-dead','1'));
    assert.equal(await page.locator('[data-omnitts-kind="dialogue"]').isVisible(),false,'unbound controls are hidden');
  } finally {await browser.close();}
});

test('controls never change wrapping and sit right after the last glyph; the playing control animates',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try{
    const page=await browser.newPage();
    const source='하린: “긴 대사도 그대로 읽을 수 있어요. 줄바꿈과 대사 상자의 높이는 그대로 유지되어야 합니다.”\n바람이 불었다. 나뭇잎이 흔들리고 멀리서 종소리가 들려왔다 그리고 다시 조용해졌다.';
    const toggles={toggle_ban_CSS:0,toggle_cuevisible:1};
    for(const width of [233,320,517,900])for(const [withTts,without] of [[apply(source,[...external,...plain.regex],toggles),apply(source,external,toggles)],['<p>'+apply(source,plain.regex).replace('\n','<br>')+'</p>','<p>'+source.replace('\n','<br>')+'</p>']]){
      await page.setViewportSize({width:width+80,height:700});
      const lines=async html=>{
        await page.setContent(plain.backgroundEmbedding+`<style>.regex-quote-block{border:1px solid #888;padding:6px}</style><main style="width:${width}px;font:20px/1.5 sans-serif">${html}</main>`);
        return page.locator('main').evaluate(n=>{const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),rows=[];let t;while(t=walker.nextNode()){const range=document.createRange();for(let i=0;i<t.length;i++){range.setStart(t,i);range.setEnd(t,i+1);const r=range.getBoundingClientRect();if(r.width)rows.push([t.data[i],Math.round(r.left),Math.round(r.top)]);}}return {rows,height:n.getBoundingClientRect().height};});
      };
      const before=await lines(without),after=await lines(withTts);
      assert.deepEqual(after,before,'every glyph keeps its exact position: '+width);
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
