import test from 'node:test';
import assert from 'node:assert/strict';
import { installHost } from '../tools/parity/host.mjs';

// A NAI key shared with another app: while that app draws, NovelAI answers 429. One shot
// it refused must not stop the rest, and must not be lost: its spinner turns pink with
// the shot kept, and a double tap draws it with no tagger call.
let instance = 0;
const sleep = () => new Promise(r => setTimeout(r, 10));
const body = 'First narrative paragraph long enough for generating images.\nSecond dialogue in the scene.\nThird line of the reply.';
async function fixture({ refuse = 2 } = {}) {
  const host = installHost({ promptsDir: 'prompts' });
  const api = await import(`../.test-build/stream-services.mjs?park=${++instance}`);
  await api.openDb(); await api.seedPrompts();
  const config = api.getConfig();
  Object.assign(config.card, { power: true, image_min: 3, image_max: 3, persist_chat_images: true, preprocessing: false, llm_reverse_bar: false, llm_tag_cal: false,
    lorebook: false, asset_nai_tags: 'off', char_info: false, user_info: false, comic_gen: 'off', nai5_first: false, nai5_only: false, include_max: 0, inline_chat_text_side: 'after' });
  config.llm = { source: 'custom', provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'test', api_key: 'test' };
  config.nai = { ...config.nai, api_key: 'test', model: 'nai-diffusion-4-5-full' };
  api.setConfig(config);
  host.setLlmReply(JSON.stringify({ new_characters: [], scenes: [{ place: 'garden', shots: [1, 2, 3].map(line => ({ line, paragraph: 0, characters: [], composition: 'scene ' + line })) }] }));
  await risuai.setCharacterToIndex(0, { chaId: 'c', name: 'C', chats: [{ id: 'chat', message: [{ role: 'char', chatId: 'm', data: body }] }] });
  // The second generation hits another app's lock (refuse: 0 lets every one through).
  const real = risuai.nativeFetch;
  let generations = 0;
  risuai.nativeFetch = async (url, options) => {
    if (String(url).includes('generate-image') && ++generations === refuse) return { ok: false, status: 429, headers: {}, data: new TextEncoder().encode('Concurrent generation is locked') };
    return real(url, options);
  };
  const request = { session_id: 'session', character_id: 'c', chat_id: 'chat', char_index: 0, chat_index: 0, message_index: 0, message_role: 'char', assistant_text: body, content_hash: 'h' };
  const wait = async id => { for (let n = 0; n < 600; n++) { const job = await api.getJob(id); if (['done', 'error', 'cancelled'].includes(job.state)) return job; await sleep(); } throw Error('job timeout'); };
  const text = async () => (await risuai.getChatFromIndex(0, 0)).message[0].data;
  return { api, host, request, wait, text, generations: () => generations };
}

test('a shot NovelAI refuses leaves a pink slot; the others are drawn; a double tap draws it without the tagger', async () => {
  const f = await fixture();
  // Message writes only (the session note may share the API without changing a message).
  const writes = [], write = risuai.setChatToIndex;
  risuai.setChatToIndex = async (...args) => { writes.push(args[2].message?.[0]?.data); return write(...args); };
  const created = await f.api.createJob(f.request);
  const job = await f.wait(created.job_id);
  risuai.setChatToIndex = write;
  assert.equal(job.state, 'done', JSON.stringify(job.error || job.result?.message));
  assert.match(String(job.result?.message), /이미지 2\/3 완료 · 1장은 분홍 칸/);
  const changed = writes.filter((text, i) => text !== (i ? writes[i - 1] : body));
  assert.equal(changed.length, 2, 'slots written pink from the start, then the images: no third write to turn a spinner pink');
  assert.doesNotMatch(changed[0], /inrayspinner/, 'the slots are pink from the start');
  assert.equal(f.generations(), 3, 'the shot after the refused one was still drawn');
  let text = await f.text();
  const pink = `${created.job_id}_1`;
  assert.equal((text.match(/\[\[@inray::/g) || []).length, 2, 'two images baked');
  assert.match(text, new RegExp(`\\[\\[@inraywait::${pink}::\\d+::\\d+\\]\\]`), 'the refused shot is a pink slot');
  assert.doesNotMatch(text, /\[\[@inrayspinner::[^\]]+\]\](?!\[\[@inray::)/, 'no spinner keeps spinning');
  const kept = await f.api.listInlineWaits();
  assert.deepEqual(kept.map(row => row.id), [pink], 'only the pink slot keeps its shot');
  assert.equal(kept[0].tagged.scenes[0].shots[0].composition, 'scene 2');
  assert.equal(kept[0].hostMessageId, 'm');

  const tagged = f.host.llmRequests.length;
  const tap = await f.api.generateInlineWait({ ...f.request, wait_id: pink, host_message_id: 'm' });
  assert.equal(tap.ok, true, JSON.stringify(tap.error));
  assert.equal((await f.wait(tap.job_id)).state, 'done');
  text = await f.text();
  assert.equal((text.match(/\[\[@inray::/g) || []).length, 3, 'the slot became its image');
  assert.doesNotMatch(text, /inraywait/);
  assert.equal(f.host.llmRequests.length, tagged, 'drawn from the kept shot: no tagger call');
  assert.deepEqual((await f.api.listInlineWaits()).map(row => row.id), [], 'its shot is let go once drawn');
});

test('a spinner left by a run that never ended is drawn from its kept shot on a double tap', async () => {
  const f = await fixture();
  // As if the page closed mid-run: the spinner is in the message, its shot in the store.
  const id = 'gone-job_0';
  const spinner = `[[@inrayspinner::${id}::832::1216]]`;
  const message = (await risuai.getChatFromIndex(0, 0));
  message.message[0].data = body.replace('\n', '\n' + spinner + '\n');
  await risuai.setChatToIndex(0, 0, message);
  await f.api.putInlineWaits([{ id, tagged: { scenes: [{ place: 'garden', shots: [{ characters: [], composition: 'left behind' }] }] }, line: 1, characterId: 'c', chatId: 'chat', hostMessageId: 'm', createdAt: Date.now() - 10 * 60 * 1000 }]);
  const tagged = f.host.llmRequests.length;
  const tap = await f.api.generateInlineWait({ ...f.request, wait_id: id, host_message_id: 'm' });
  assert.equal(tap.ok, true, JSON.stringify(tap.error));
  assert.equal((await f.wait(tap.job_id)).state, 'done');
  const text = await f.text();
  assert.doesNotMatch(text, /inrayspinner::gone-job|inraywait/);
  assert.equal((text.match(/\[\[@inray::/g) || []).length, 1);
  assert.equal(f.host.llmRequests.length, tagged, 'no tagger call');
});

// 꾹 누르기: every pink slot of the message, from the pressed one down, then from the top.
test('pressing a pink slot long makes every pink slot of its message in order, with no tagger call', async () => {
  const f = await fixture({ refuse: 0 });
  const slot = id => `[[@inraywait::${id}::832::1216]]`;
  const lines = body.split('\n');
  const message = await risuai.getChatFromIndex(0, 0);
  message.message[0].data = [lines[0], slot('w1'), lines[1], slot('w2'), lines[2], slot('w3')].join('\n');
  await risuai.setChatToIndex(0, 0, message);
  const shot = name => ({ scenes: [{ place: 'garden', shots: [{ characters: [], composition: name }] }] });
  await f.api.putInlineWaits(['w1', 'w2', 'w3'].map((id, i) => ({ id, tagged: shot(id), line: i + 1, characterId: 'c', chatId: 'chat', hostMessageId: 'm', createdAt: Date.now() })));
  const tagged = f.host.llmRequests.length, seen = [];
  // As in a tag job: each image shows in its slot as it comes, and one write puts them all in.
  const previews = [];
  globalThis.__OMNI_SPINNER_PREVIEW__ = async row => { previews.push(row); };
  let writes = 0;
  const write = risuai.setChatToIndex;
  risuai.setChatToIndex = async (...args) => { writes++; return write(...args); };
  let finished;
  const done = new Promise(resolve => { finished = resolve; });
  const started = await f.api.generateAllInlineWaits({ ...f.request, wait_id: 'w2', host_message_id: 'm' }, state => { seen.push({ ...state }); if (state.finished) finished(state); });
  assert.deepEqual(started.ids, ['w2', 'w3', 'w1'], 'from the pressed slot down, then from the top');
  const again = await f.api.generateAllInlineWaits({ ...f.request, wait_id: 'w1', host_message_id: 'm' });
  assert.equal(again.ok, false, 'one run at a time');
  const end = await done;
  risuai.setChatToIndex = write; delete globalThis.__OMNI_SPINNER_PREVIEW__;
  assert.equal(end.made, 3); assert.equal(end.stopped, undefined);
  assert.equal(writes, 1, 'one message write for the whole run');
  assert.deepEqual(previews.map(row => row.waitSlot), ['w2', 'w3'], 'shown in their slots as they came; the last went straight into the write');
  const text = await f.text();
  assert.equal((text.match(/\[\[@inray::/g) || []).length, 3, 'every slot became its image');
  assert.doesNotMatch(text, /inraywait/);
  assert.equal(f.host.llmRequests.length, tagged, 'drawn from the kept shots: no tagger call');
  // One at a time: a slot's job had ended before the next one began.
  const jobs = seen.filter(s => s.jobId && !s.finished).map(s => s.jobId);
  assert.equal(new Set(jobs).size, 3);
});

test('a slot whose job fails stays pink and is not counted as made; the run goes on', async () => {
  const f = await fixture({ refuse: 1 });
  const slot = id => `[[@inraywait::${id}::832::1216]]`;
  const lines = body.split('\n');
  const message = await risuai.getChatFromIndex(0, 0);
  message.message[0].data = [lines[0], slot('w1'), lines[1], slot('w2')].join('\n');
  await risuai.setChatToIndex(0, 0, message);
  const shot = name => ({ scenes: [{ place: 'garden', shots: [{ characters: [], composition: name }] }] });
  await f.api.putInlineWaits(['w1', 'w2'].map((id, i) => ({ id, tagged: shot(id), line: i + 1, characterId: 'c', chatId: 'chat', hostMessageId: 'm', createdAt: Date.now() })));
  let finished; const done = new Promise(resolve => { finished = resolve; });
  await f.api.generateAllInlineWaits({ ...f.request, wait_id: 'w1', host_message_id: 'm' }, state => { if (state.finished) finished(state); });
  const end = await done;
  assert.equal(end.done, 2, 'the run went on past the refused one');
  assert.equal(end.made, 1, 'only the drawn slot counts');
  const text = await f.text();
  assert.match(text, /\[\[@inraywait::w1::/, 'the refused slot is still pink');
  assert.doesNotMatch(text, /\[\[@inraywait::w2::/);
});
