import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GLOBAL_SCOPE,
  charRefDiskImageKey,
  charRefMetaKey,
  charRefScopeForCharacter,
  normalizeCharRefScope,
  parseCharRefMetaKey,
} from '../.test-build/char-ref-keys.mjs';

test('same character id, different scopes, different meta keys', () => {
  const id = 'alice';
  const globalKey = charRefMetaKey(GLOBAL_SCOPE, id);
  const sessA = charRefMetaKey('sess_a', id);
  const sessB = charRefMetaKey('sess_b', id);
  assert.equal(globalKey, 'char_ref::__global__::alice');
  assert.equal(sessA, 'char_ref::sess_a::alice');
  assert.equal(sessB, 'char_ref::sess_b::alice');
  assert.notEqual(globalKey, sessA);
  assert.notEqual(sessA, sessB);
  assert.notEqual(charRefDiskImageKey(globalKey), charRefDiskImageKey(sessA));
  assert.notEqual(charRefDiskImageKey(sessA), charRefDiskImageKey(sessB));
});

test('legacy char_ref_<id> parses as global read', () => {
  const parsed = parseCharRefMetaKey('char_ref_alice');
  assert.equal(parsed.scope, GLOBAL_SCOPE);
  assert.equal(parsed.characterId, 'alice');
  assert.equal(parsed.legacy, true);
  assert.equal(parseCharRefMetaKey('char_ref::__global__::alice').legacy, false);
  assert.equal(parseCharRefMetaKey('char_ref::sess_a::alice').scope, 'sess_a');
});

test('UI global/session normalize; empty is not silently global', () => {
  assert.equal(normalizeCharRefScope('global'), GLOBAL_SCOPE);
  assert.equal(normalizeCharRefScope(GLOBAL_SCOPE), GLOBAL_SCOPE);
  assert.equal(normalizeCharRefScope('session', 'chat123'), 'chat123');
  assert.equal(normalizeCharRefScope('sess_a'), 'sess_a');
  assert.equal(normalizeCharRefScope(''), '');
  assert.equal(normalizeCharRefScope('session', ''), '');
});

test('roster row scope wins over the unified / UI session id', () => {
  assert.equal(charRefScopeForCharacter('chat_root', 'session', 'unified_id'), 'chat_root');
  assert.equal(charRefScopeForCharacter('', 'session', 'unified_id'), 'unified_id');
  assert.equal(charRefScopeForCharacter('', '', 'chat123'), 'chat123');
  assert.equal(charRefScopeForCharacter(GLOBAL_SCOPE, 'global', ''), GLOBAL_SCOPE);
  assert.equal(charRefScopeForCharacter('', 'global', 'chat123'), GLOBAL_SCOPE);
  assert.equal(charRefScopeForCharacter('session', 'session', 'chat123'), 'chat123');
});
