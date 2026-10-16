import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({stdin:{contents:"export * from './src/domain/tts/filter';export * from './src/config/tts-defaults';export {normalizeTtsSettings} from './src/storage/tts-store';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('spoken omissions use the configured comma list literally and can be cleared', () => {
  assert.equal(api.ttsDefaults().omitCharacters, '[, ], (, )', 'Fish takes [..] and (..) as delivery tags: their marks are not sent');
  assert.equal(api.ttsDefaults().omitParenText, false, 'the words inside are read by default');
  assert.equal(api.ttsWithoutParentheticals('그는 (작게) 한숨을 쉬었다（조용히）.'), '그는 한숨을 쉬었다 .', 'the toggle drops parenthesized words whole');
  assert.equal(api.ttsSpokenText('그는 (작게) 한숨을 쉬었다.', api.ttsDefaults().omitCharacters), '그는 작게 한숨을 쉬었다.');
  assert.equal(api.ttsSpokenText('[안녕하세요] 【안내】', '[, ]'), '안녕하세요 【안내】');
  assert.equal(api.ttsSpokenText('[안녕] (하나) .* 둘', '(, ), .*'), '[안녕] 하나 둘');
  assert.equal(api.ttsSpokenText('[안녕]', ''), '[안녕]');
  assert.equal(api.ttsSpokenText('[안녕]', ' , , '), '[안녕]');
  assert.equal(api.ttsSpokenText('🌟안녕하세요🌟', '🌟'), '안녕하세요');
});

test('old bracket preferences migrate once and edited or empty omission lists persist', () => {
  assert.equal(api.normalizeTtsSettings({stripBrackets:false}).omitCharacters, '');
  assert.equal(api.normalizeTtsSettings({stripBrackets:true}).omitCharacters, '[, ], (, )');
  assert.equal(api.normalizeTtsSettings({omitCharacters:''}).omitCharacters, '');
  assert.equal(api.normalizeTtsSettings({stripBrackets:false,omitCharacters:'【, 】'}).omitCharacters, '【, 】, (, )', 'an older list gets ( and ) once, and only them');
  assert.equal(api.normalizeTtsSettings({omitCharacters:42}).omitCharacters, '[, ], (, )');
  const older = api.normalizeTtsSettings({omitCharacters:'[, ]'});
  assert.deepEqual([older.omitCharacters, older.omitSeed], ['[, ], (, )', 1]);
  assert.equal(api.normalizeTtsSettings({...older, omitCharacters:'[, ]'}).omitCharacters, '[, ]', 'taken out again by hand, they stay out');
  assert.equal(api.normalizeTtsSettings({omitCharacters:'', omitSeed: undefined}).omitCharacters, '', 'a list emptied on purpose stays empty');
});
