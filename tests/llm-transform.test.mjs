import assert from 'node:assert/strict';
import { test } from 'node:test';
import { llmResponseToText, readStreamToText } from '../.test-build/llm-transform.mjs';
import { readJsonBody } from '../.test-build/llm-client.mjs';

/**
 * A stream that emits Risu `{ "0": cumulativeText }` chunks and then, unless told
 * otherwise, never signals `done`. This is the shape a plugin-provider model hands
 * back through `runLLMModel` when the upstream refuses or errors mid-stream: the
 * text arrives, the close never does.
 */
function hangingRisuStream(chunks, { close = false } = {}) {
  let i = 0;
  let cancelled = false;
  return {
    getReader() {
      return {
        read() {
          if (i < chunks.length) {
            const value = { 0: chunks[i] };
            i += 1;
            return Promise.resolve({ done: false, value });
          }
          if (close || cancelled) return Promise.resolve({ done: true, value: undefined });
          return new Promise(() => {});
        },
        cancel() {
          cancelled = true;
          return Promise.resolve();
        },
      };
    },
  };
}

test('readStreamToText still drains a well-behaved stream to its final cumulative text', async () => {
  const text = await readStreamToText(hangingRisuStream(['그', '그건', '그건 생성할 수 없습니다.'], { close: true }));
  assert.equal(text, '그건 생성할 수 없습니다.');
});

test('readStreamToText returns the text so far when the stream goes idle without closing', async () => {
  const notes = [];
  const t0 = Date.now();
  const text = await readStreamToText(hangingRisuStream(['그건', '그건 생성할 수 없습니다.']), {
    idleMs: 60,
    note: (stage, detail) => notes.push({ stage, ...detail }),
  });
  assert.equal(text, '그건 생성할 수 없습니다.');
  assert.ok(Date.now() - t0 < 2000, 'idle completion must not wait for a hard deadline');
  assert.ok(notes.some((n) => n.stage === 'llm.stream.idle'), 'idle completion is recorded for the debug log');
});

test('readStreamToText throws at the deadline when nothing has arrived', async () => {
  await assert.rejects(
    readStreamToText(hangingRisuStream([]), { idleMs: 60, deadlineAt: Date.now() + 80 }),
    /시간 초과/,
  );
});

test('readStreamToText without options behaves as before (no timers) on a closing stream', async () => {
  const text = await readStreamToText(hangingRisuStream(['a', 'ab'], { close: true }));
  assert.equal(text, 'ab');
});

test('llmResponseToText forwards read options to a Risu streaming envelope', async () => {
  const text = await llmResponseToText(
    { type: 'streaming', result: hangingRisuStream(['x', 'xy']) },
    { idleMs: 60 },
  );
  assert.equal(text, 'xy');
});

test('llmResponseToText still throws on a Risu fail envelope', async () => {
  await assert.rejects(llmResponseToText({ type: 'fail', result: 'blocked' }), /Risu LLM 실패: blocked/);
});

// ── the HTTP lane's body reader ─────────────────────────────────────────────

const never = new Promise(() => {});

test('readJsonBody parses a real Response body', async () => {
  const payload = { choices: [{ message: { content: '{"shots":[]}' } }] };
  const resp = new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await readJsonBody(resp, never, { idleMs: 200 }), payload);
});

test('readJsonBody falls back to json() when there is no body stream', async () => {
  const payload = { choices: [] };
  const resp = { status: 200, async json() { return payload; } };
  assert.deepEqual(await readJsonBody(resp, never, { idleMs: 200 }), payload);
});

test('readJsonBody ends on the idle gap when the body stream delivers JSON but never closes', async () => {
  const bytes = new TextEncoder().encode('{"choices":[{"message":{"content":"그건 생성할 수 없습니다."}}]}');
  let sent = false;
  const body = {
    getReader() {
      return {
        read() {
          if (!sent) { sent = true; return Promise.resolve({ done: false, value: bytes }); }
          return new Promise(() => {});
        },
        cancel() { return Promise.resolve(); },
      };
    },
  };
  const t0 = Date.now();
  const out = await readJsonBody({ status: 200, body }, never, { idleMs: 60 });
  assert.equal(out.choices[0].message.content, '그건 생성할 수 없습니다.');
  assert.ok(Date.now() - t0 < 2000);
});

test('readJsonBody surfaces the deadline when json() never settles', async () => {
  const resp = { status: 200, json: () => new Promise(() => {}) };
  const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('LLM 응답 시간 초과 (1s)')), 50));
  await assert.rejects(readJsonBody(resp, deadline, {}), /시간 초과/);
});
