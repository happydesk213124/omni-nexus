import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/storage/character-roster';export * from './src/storage/current-bot';export {readChatNote,writeChatNote,characterIdForNoteSession} from './src/storage/chat-session-store';export {characterSource} from './src/services/character-source';export {sessionIdHash} from './src/core/util/text';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

// Two bots, the first open. A read of Risu is counted by kind: the directory of every bot, a whole bot, a chat.
let chars,reads,open,readOf;
const note=text=>({comment:'omni.nexus.note',key:'',alwaysActive:false,mode:'normal',content:JSON.stringify({version:1,note:{text}})});
beforeEach(()=>{
  chars=['bot-a','bot-b'].map(chaId=>({chaId,name:chaId,globalLore:[],chats:[{id:'one',localLore:[note(chaId+' one')]},{id:'two',localLore:[]}]}));
  reads={getDatabase:0,getCharacterFromIndex:0,getChatFromIndex:0};open=0;readOf=[0,0];
  globalThis.risuai={getCurrentCharacterIndex:async()=>open,getCurrentChatIndex:async()=>0,
    getDatabase:async()=>{reads.getDatabase++;return {characters:structuredClone(chars)};},
    getCharacterFromIndex:async i=>{reads.getCharacterFromIndex++;readOf[i]++;return structuredClone(chars[i]);},
    getChatFromIndex:async(i,j)=>{reads.getChatFromIndex++;return structuredClone(chars[i].chats[j]);},
    setCharacterToIndex:async(i,c)=>{chars[i]=structuredClone(c);},
    setChatToIndex:async(i,j,c)=>{chars[i].chats[j]=structuredClone(c);}};
  api.forgetBots();
});
const scope=(bot,chat)=>'risu_'+api.sessionIdHash(bot+'|'+chat);
const alice={id:'alice',name:'Alice',appearance:'blue eyes',attire:'shirt',costumes:[{name:'default',attire:'shirt'}]};
const bob={id:'bob',name:'Bob',appearance:'green eyes',attire:'coat',costumes:[{name:'default',attire:'coat'}]};
const names=rows=>rows.map(r=>r.name).sort();
const zero=()=>{for(const k of Object.keys(reads))reads[k]=0;readOf=[0,0];};

test('the open bot\'s roster is read off the bot alone, by any of its scopes: no directory of every bot',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  zero();
  for(const s of [scope('bot-a','one'),scope('bot-a','two'),'bot-a'])assert.deepEqual(names(await api.readCharacterRoster(s)),['Alice']);
  assert.deepEqual(reads,{getDatabase:0,getCharacterFromIndex:3,getChatFromIndex:0},'one read of the bot each, nothing of every bot');
});

test('reads at the same moment share one read of the bot; one asked later reads it again (nothing kept on a timer)',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  zero();
  const rows=await Promise.all([scope('bot-a','one'),scope('bot-a','two'),'bot-a'].map(s=>api.readCharacterRoster(s)));
  assert.deepEqual(rows.map(names),[['Alice'],['Alice'],['Alice']]);
  assert.equal(reads.getCharacterFromIndex,1,'one read for all three');
  await api.readCharacterRoster('bot-a');
  assert.equal(reads.getCharacterFromIndex,2,'a read after it reads again');
});

test('a job holds the bot it read: its later reads read nothing, until a write lets go and the job ends',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  zero();
  const bot=await api.readOpenBot();
  await api.holdBot(bot,async()=>{
    for(const s of [scope('bot-a','one'),'bot-a'])assert.deepEqual(names(await api.readCharacterRoster(s)),['Alice']);
    assert.equal(await api.characterIdForNoteSession(scope('bot-a','one')),'bot-a');
    assert.equal(reads.getCharacterFromIndex,1,'only the job\'s own read');
    // A write within the job: what it held is let go, the next read is Risu's and sees the write.
    await api.mutateCharacterRoster('bot-a',rows=>[...rows,bob]);
    zero();
    assert.deepEqual(names(await api.readCharacterRoster('bot-a')),['Alice','Bob']);
    assert.equal(reads.getCharacterFromIndex,1);
  });
  assert.equal(api.heldBot('bot-a'),null,'nothing held once the job ended');
});

test('another bot still goes through the directory, and the open one is not read for it once seen',async()=>{
  await api.mutateCharacterRoster('bot-b',()=>[bob]);
  await api.readCharacterRoster('bot-a');
  zero();
  assert.deepEqual(names(await api.readCharacterRoster('bot-b')),['Bob']);
  // (The directory was read for the write a moment ago and is reused for two seconds, as before.)
  assert.deepEqual(readOf,[0,1],'bot-b alone; the open bot-a is not read for it');
  assert.ok(reads.getDatabase<=1);
  // Another bot opened: the open one is read again before the directory is asked.
  open=1;zero();
  assert.deepEqual(names(await api.readCharacterRoster('bot-b')),['Bob']);
  assert.deepEqual(readOf,[0,1],'bot-b, now open, read alone');
  assert.equal(reads.getDatabase,0,'no directory for the open bot');
});

test('writes still find their bot through the directory',async()=>{
  zero();
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  assert.ok(reads.getDatabase>0,'a write routes by the directory, which refuses two bots with one id');
});

test('the open bot\'s chat note comes with the bot: no directory, no second copy, no chat read',async()=>{
  zero();
  assert.deepEqual(await api.readChatNote(scope('bot-a','one')),{text:'bot-a one'});
  assert.deepEqual(reads,{getDatabase:0,getCharacterFromIndex:1,getChatFromIndex:0});
  const bot=await api.readOpenBot();zero();
  await api.holdBot(bot,async()=>{assert.deepEqual(await api.readChatNote(scope('bot-a','one')),{text:'bot-a one'});});
  assert.deepEqual(reads,{getDatabase:0,getCharacterFromIndex:0,getChatFromIndex:0},'held: nothing read at all');
  // Another bot's note: as before, through the directory.
  zero();
  assert.deepEqual(await api.readChatNote(scope('bot-b','one')),{text:'bot-b one'});
  assert.ok(reads.getDatabase>0);
});

test('a chat note written is read anew, not off the bot read before the write',async()=>{
  const bot=await api.readOpenBot();
  await api.holdBot(bot,async()=>{
    await api.writeChatNote(scope('bot-a','one'),{text:'changed'});
    assert.equal(api.heldBot('bot-a'),null,'the write let go');
    assert.deepEqual(await api.readChatNote(scope('bot-a','one')),{text:'changed'});
  });
});

test('the asset tags\' bot is the open bot alone too',async()=>{
  zero();
  assert.equal((await api.characterSource('bot-a'))?.chaId,'bot-a');
  assert.deepEqual(reads,{getDatabase:0,getCharacterFromIndex:1,getChatFromIndex:0});
  zero();
  assert.equal((await api.characterSource('bot-b'))?.chaId,'bot-b');
  assert.equal(reads.getDatabase,1,'another bot: the directory, as before');
});

// An image job asks for its bot dozens of times (its roster nine times over). While its scope is held, one read
// serves them all, until a write: then one more read, kept in turn.
test('a job that holds its bot reads it once per write, the shared roster once, and lets both go at its end',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  let moduleReads=0;
  const shared={id:'inlay-inray-display',lorebook:[{comment:'omni.nexus.data.globalcharacter',key:'',alwaysActive:false,content:JSON.stringify({version:1,roster:[{...bob,id:'shared'}]})}]};
  const listBots=globalThis.risuai.getDatabase;
  globalThis.risuai.getDatabase=async keys=>{ if(Array.isArray(keys)&&keys.includes('modules')){moduleReads++;return {modules:[structuredClone(shared)]};} return listBots(keys); };
  zero();
  const release=api.holdBotScope(scope('bot-a','one'));
  for(let i=0;i<9;i++){
    assert.deepEqual(names(await api.readCharacterRoster(scope('bot-a','one'))),['Alice']);
    assert.deepEqual(names(await api.readCharacterRoster('__global__')),['Bob']);
  }
  assert.equal(await api.characterIdForNoteSession(scope('bot-a','two')),'bot-a');
  assert.deepEqual(await api.readChatNote(scope('bot-a','one')),{text:'bot-a one'});
  assert.deepEqual(reads,{getDatabase:0,getCharacterFromIndex:1,getChatFromIndex:0},'nine rosters, the note and its bot: one read of the bot');
  assert.equal(moduleReads,1,'and one read of the modules for the shared roster');
  // What a reader is handed is its own: changing it changes nothing for the next.
  const mine=await api.readCharacterRoster('bot-a');mine[0].name='Changed';mine[0].costumes[0].attire='changed';
  assert.equal((await api.readCharacterRoster('bot-a'))[0].costumes[0].attire,'shirt');
  // A write: the bot kept is older than it, so the next question reads once, and that read is kept.
  await api.writeChatNote(scope('bot-a','one'),{text:'changed'});
  zero();
  assert.deepEqual(await api.readChatNote(scope('bot-a','one')),{text:'changed'});
  for(let i=0;i<3;i++)await api.readCharacterRoster('bot-a');
  assert.equal(reads.getCharacterFromIndex,1,'one read after the write, not one per question');
  release();release();
  zero();
  await api.readCharacterRoster('bot-a');await api.readCharacterRoster('bot-a');
  assert.equal(reads.getCharacterFromIndex,2,'the job over, nothing is kept: every question asks Risu again');
  moduleReads=0;await api.readCharacterRoster('__global__');await api.readCharacterRoster('__global__');
  assert.equal(moduleReads,2);
});

test('a held job writes its bot fresh: the roster it saves is built on what Risu holds now, not on the bot it kept',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  const release=api.holdBotScope('bot-a');
  try {
    assert.deepEqual(names(await api.readCharacterRoster('bot-a')),['Alice']);
    // Changed behind the plugin's back (another device, Risu's own editor) while the job holds its read.
    const lore=chars[0].globalLore.find(e=>e.comment==='omni.nexus.data.global'),data=JSON.parse(lore.content);
    data.roster.push({id:'carol',name:'Carol'});lore.content=JSON.stringify(data);
    chars[0].chats[0].message=[{role:'char',data:'a reply that came meanwhile'}];
    await api.mutateCharacterRoster('bot-a',rows=>[...rows,bob]);
    assert.deepEqual(names(JSON.parse(chars[0].globalLore.find(e=>e.comment==='omni.nexus.data.global').content).roster),['Alice','Bob','Carol']);
    assert.equal(chars[0].chats[0].message[0].data,'a reply that came meanwhile','the write carried the bot as it was then, messages and all');
  } finally { release(); }
});

test('a person saved again as they were (a new stamp and nothing else) writes nothing',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[{...alice,updated_at:100}]);
  let writes=0;const set=globalThis.risuai.setCharacterToIndex;
  globalThis.risuai.setCharacterToIndex=async(i,c)=>{writes++;return set(i,c);};
  await api.mutateCharacterRoster('bot-a',rows=>rows.map(row=>({...row,updated_at:200})));
  await api.mutateCharacterRoster('bot-a',rows=>rows.map(row=>({...row,updated_at:300})),{buffer:true});
  assert.equal(writes,0);
  assert.deepEqual(api.bufferedRosterTargets(),[],'and nothing waits for the bake');
  assert.equal((await api.readCharacterRoster('bot-a'))[0].updated_at,100);
  await api.mutateCharacterRoster('bot-a',rows=>rows.map(row=>({...row,attire:'coat',updated_at:400})));
  assert.equal(writes,1,'a real change still writes, stamp and all');
  assert.equal((await api.readCharacterRoster('bot-a'))[0].updated_at,400);
});
