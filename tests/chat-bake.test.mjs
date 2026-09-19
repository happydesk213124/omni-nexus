import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bakeTokenForCard,
  htmlHasBakeWrapForCard,
  htmlHasInrayBake,
  messageHasBakeToken,
  messageHasBakeTokenForCard,
  proseForHash,
  replaceBakeTokenCard,
  stripBakeTokenForCard,
  stripBakeTokens,
} from '../.test-build/chat-bake.mjs';
import {
  applyBakeTokensToBody,
  injectInlineImagesIntoHtml,
  insertSnippetAtShotLine,
  stripInlayInlineHtml,
} from '../.test-build/viewer-core.mjs';

const NAME = 'inxshot_card-1.webp';
const TOKEN = '[[@inray::card-1::inxshot_card-1.webp]]';

test('bake tokens point at gallery shots and strip leaves user assets', () => {
  const token = bakeTokenForCard('card-1', NAME);
  assert.equal(token, TOKEN);
  assert.equal(bakeTokenForCard('card-1'), '');
  const body = `안녕\n{{#asset::portrait}}\n${token}\n커피`;
  assert.equal(messageHasBakeToken(body), true);
  assert.equal(messageHasBakeTokenForCard(body, 'card-1'), true);
  assert.equal(messageHasBakeTokenForCard(body, 'other'), false);
  assert.equal(stripBakeTokens(body).includes('{{#asset::portrait}}'), true);
  assert.equal(messageHasBakeToken(stripBakeTokens(body)), false);
  assert.equal(stripBakeTokenForCard(body, 'card-1').includes(token), false);
  assert.equal(proseForHash(body), proseForHash(stripBakeTokens(body)));
  assert.equal(
    replaceBakeTokenCard(body, 'card-1', 'card-2', 'inxshot_card-2.webp'),
    '안녕\n{{#asset::portrait}}\n[[@inray::card-2::inxshot_card-2.webp]]\n커피',
  );
  assert.equal(htmlHasInrayBake(token), true);
  assert.equal(htmlHasInrayBake('<div data-inray-bake="1" data-inlay-inline-shot="card-1">'), true);
  assert.equal(htmlHasInrayBake('<div data-inlay-inline-shot="card-1">'), false);
  assert.equal(htmlHasBakeWrapForCard('<div data-inray-bake="1" data-inlay-inline-shot="card-1">', 'card-1'), true);
  assert.equal(htmlHasBakeWrapForCard('<div data-inlay-inline-shot="card-1">', 'card-1'), false);
});

test('legacy inxbake tokens still strip', () => {
  const body = '안녕\n{{#asset::inxbake_old.webp}}\n커피';
  assert.equal(messageHasBakeToken(body), true);
  assert.equal(stripBakeTokens(body).includes('inxbake_'), false);
  assert.equal(stripBakeTokens(body).includes('커피'), true);
});

test('plain bake insert matches inline line side', () => {
  const plain = '차를 탔다\n커피를 마셨다\n끝';
  const token = bakeTokenForCard('c1', 'inxshot_c1.webp');
  const before = insertSnippetAtShotLine(plain, 2, 'before', token);
  assert.match(before, new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n커피를 마셨다`));
  const after = insertSnippetAtShotLine(plain, 2, 'after', token);
  assert.match(after, /커피를 마셨다\n\[\[@inray::c1::inxshot_c1\.webp\]\]/);
});

test('html bake insert index matches inline inject', () => {
  const src = 'data:image/png;base64,abc';
  const rich = '차를 탔다<br><b>커피를 마셨다</b><br>끝';
  const injected = injectInlineImagesIntoHtml(rich, [
    { line: 2, src, shotIndex: 0, cardId: 'c1' },
  ], { textSide: 'before' });
  const token = bakeTokenForCard('c1', 'inxshot_c1.webp');
  const baked = insertSnippetAtShotLine(rich, 2, 'before', token);
  const injAt = injected.indexOf('data-inlay-inline-shot="c1"');
  const wrapStart = injected.lastIndexOf('<div', injAt);
  const bakeAt = baked.indexOf(token);
  assert.ok(injAt > 0 && bakeAt >= 0);
  assert.equal(bakeAt, wrapStart);
  assert.equal(stripInlayInlineHtml(injected).includes('<b>커피를 마셨다</b>'), true);
});

test('applyBakeTokensToBody rewrites from a clean body', () => {
  const plain = '첫째\n둘째\n셋째';
  const once = applyBakeTokensToBody(plain, [
    { line: 1, cardId: 'a', assetName: 'inxshot_a.webp' },
    { line: 3, cardId: 'c', assetName: 'inxshot_c.webp' },
  ], 'before');
  const again = applyBakeTokensToBody(once, [
    { line: 1, cardId: 'a', assetName: 'inxshot_a.webp' },
    { line: 3, cardId: 'c2', assetName: 'inxshot_c2.sroom.webp' },
  ], 'before');
  assert.equal(again.includes('[[@inray::a::inxshot_a.webp]]'), true);
  assert.equal(again.includes('[[@inray::c2::inxshot_c2.sroom.webp]]'), true);
  assert.equal(again.includes('inxshot_c.webp'), false);
  assert.equal(proseForHash(once), proseForHash(plain));
  assert.equal(proseForHash(again), proseForHash(plain));
});


test('dimensioned tokens survive recognition, stripping and reroll without losing intrinsic size', () => {
  const token = bakeTokenForCard('card-1', NAME, {width:832,height:1216});
  assert.equal(token, '[[@inray::card-1::inxshot_card-1.webp::832::1216]]');
  assert.equal(messageHasBakeTokenForCard(token,'card-1'),true);
  assert.equal(stripBakeTokenForCard(token,'card-1'),'');
  assert.equal(proseForHash('hello\n'+token),'hello');
  assert.equal(replaceBakeTokenCard(token,'card-1','next','inxshot_next.webp'), '[[@inray::next::inxshot_next.webp::832::1216]]');
  assert.equal(replaceBakeTokenCard(token,'card-1','next','inxshot_next.webp',{width:1216,height:832}), '[[@inray::next::inxshot_next.webp::1216::832]]');
  assert.equal(bakeTokenForCard('card-1',NAME,{width:Infinity,height:0}),TOKEN);
});
