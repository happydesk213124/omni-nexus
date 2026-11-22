import { ttsData } from '../storage/tts-store';
import { omniTts } from '../services/tts-runtime';
import { blankTtsCharacter } from '../services/tts-characters';
import { callLlm } from '../providers/llm/client';
import { synthesizeFish } from '../providers/tts/fish';
import { synthesizeIrodori } from '../providers/tts/irodori';
import { geminiDefaultVoice, synthesizeGemini } from '../providers/tts/gemini';
import { elevenDefaultVoice, elevenModel, synthesizeEleven } from '../providers/tts/eleven';
import { selectTtsVoices } from '../providers/tts/selection';
import { translateTts } from '../providers/tts/translation';
import { input, on, text } from './common';

export function bindTtsConnectionTests(): void {
  for(const kind of ['fish','irodori','gemini','elevenlabs','llm','jev','translation'] as const){
    const id=`tts-test-${kind}`,node=input(id);
    if(!node)continue;
    on(id,async()=>{
      if(node.disabled)return;
      node.disabled=true;text(id+'-result','확인 중…');
      try {
        const data=ttsData(),settings=structuredClone(data.settings);
        if(kind==='fish'){
          const voice=data.voices.find(v=>v.key===settings.narrationVoice)||data.voices[0];
          if(!voice)throw Error('테스트할 음성을 음성 목록에 먼저 추가해 주세요.');
          const bytes=await omniTts.queue.request('connection-fish',()=>synthesizeFish('안녕하세요. 연결 테스트입니다.','',voice.fishId,settings),0);
          if(node.isConnected)text(id+'-result',`연결 성공 · 음성 ${(bytes.byteLength/1024).toFixed(1)} KB`);
        }else if(kind==='irodori'){
          // Its own slot: the test never waits behind lines being read, and the server queues the rest.
          const bytes=await omniTts.queue.request('connection-irodori',()=>synthesizeIrodori('こんにちは。接続テストです。','',settings),0);
          if(node.isConnected)text(id+'-result',`연결 성공 · 음성 ${(bytes.byteLength/1024).toFixed(1)} KB (${settings.irodori.voice})`);
        }else if(kind==='gemini'){
          const bytes=await omniTts.queue.request('connection-gemini',()=>synthesizeGemini('안녕하세요. 연결 테스트입니다.','',geminiDefaultVoice(settings),settings),0);
          if(node.isConnected)text(id+'-result',`연결 성공 · 음성 ${(bytes.byteLength/1024).toFixed(1)} KB (${settings.gemini.model} · ${geminiDefaultVoice(settings)})`);
        }else if(kind==='elevenlabs'){
          // The default voice, else the first one read in: a key with no voice chosen yet can still be tested.
          const voice=elevenDefaultVoice(settings)||data.elevenVoices[0]?.fishId||'';
          const bytes=await omniTts.queue.request('connection-elevenlabs',()=>synthesizeEleven('안녕하세요. 연결 테스트입니다.','',voice,settings),0);
          if(node.isConnected)text(id+'-result',`연결 성공 · 음성 ${(bytes.byteLength/1024).toFixed(1)} KB (${elevenModel(settings)} · ${voice})`);
        }else if(kind==='llm'){
          const answer=await callLlm({...settings.llm,max_tokens:32},[{role:'user',content:'Connection test. Reply only OK.'}]);
          if(!answer.trim())throw Error('모델 응답이 비어 있습니다.');
          if(node.isConnected)text(id+'-result','연결 성공 · 모델 응답 확인');
        }else if(kind==='jev'){
          const character=blankTtsCharacter('global','연결 테스트');character.tags=['차분한'];
          await selectTtsVoices([character],data.voices.slice(0,3),settings,'jev');
          if(node.isConnected)text(id+'-result','연결 성공 · 음성 선택 응답 확인');
        }else{
          if(settings.translation.provider==='off')throw Error('번역 방식을 먼저 선택해 주세요.');
          const translated=await translateTts([{id:'0',speaker:'',tone:'',text:'안녕하세요.',kind:'narration',start:0,end:6}],settings);
          if(node.isConnected)text(id+'-result',`연결 성공 · ${translated[0]}`);
        }
      }catch(error){if(node.isConnected)text(id+'-result',String((error as Error)?.message||error));}
      finally{if(node.isConnected)node.disabled=false;}
    });
  }
}
