import test from 'node:test';
import assert from 'node:assert/strict';
import { installHost } from '../tools/parity/host.mjs';

// A NAI key shared with another app: while that app draws, NovelAI answers 429. One shot
// it refused must not stop the rest, and must not be lost: its spinner turns pink with
// the shot kept, and a double tap draws it with no tagger call.
let instance = 0;
const sleep = () => new Promise(r => setTimeout(r, 10));
const body = 'First narrative paragraph long enough for generating images.\nSecond dialogue in the scene.\nThird line of the reply.';
async function fixture() {
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
  // The second generation hits another app's lock.
  const real = risuai.nativeFetch;
  let generations = 0;
  risuai.nativeFetch = async (url, options) => {
    if (String(url).includes('generate-image') && ++generations === 2) return { ok: false, status: 429, headers: {}, data: new TextEncoder().encode('Concurrent generation is locked') };
    return real(url, options);
  };
  const request = { session_id: 'session', character_id: 'c', chat_id: 'chat', char_index: 0, chat_index: 0, message_index: 0, message_role: 'char', assistant_text: body, content_hash: 'h' };
  const wait = async id => { for (let n = 0; n < 600; n++) { const job = await api.getJob(id); if (['done', 'error', 'cancelled'].includes(job.state)) return job; await sleep(); } throw Error('job timeout'); };
  const text = async () => (await risuai.getChatFromIndex(0, 0)).message[0].data;
  return { api, host, request, wait, text, generations: () => generations };
}

test('a shot NovelAI refuses leaves a pink slot; the others are drawn; a double tap draws it without the tagger', async () => {
  const f = await fixture();
  const created = await f.api.createJob(f.request);
  const job = await f.wait(created.job_id);
  assert.equal(job.state, 'done', JSON.stringify(job.error || job.result?.message));
  assert.match(String(job.result?.message), /이미지 2\/3 완료 · 1장은 분홍 칸/);
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
