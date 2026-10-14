import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({stdin:{contents:"export * from './src/domain/tts/filter';export * from './src/config/tts-defaults';export {normalizeTtsSettings} from './src/storage/tts-store';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('spoken omissions use the configured comma list literally and can be cleared', () => {
  assert.equal(api.ttsDefaults().omitCharacters, '[, ]');
  assert.equal(api.ttsSpokenText('[안녕하세요] 【안내】', '[, ]'), '안녕하세요 【안내】');
  assert.equal(api.ttsSpokenText('[안녕] (하나) .* 둘', '(, ), .*'), '[안녕] 하나 둘');
  assert.equal(api.ttsSpokenText('[안녕]', ''), '[안녕]');
  assert.equal(api.ttsSpokenText('[안녕]', ' , , '), '[안녕]');
  assert.equal(api.ttsSpokenText('🌟안녕하세요🌟', '🌟'), '안녕하세요');
});

test('old bracket preferences migrate once and edited or empty omission lists persist', () => {
  assert.equal(api.normalizeTtsSettings({stripBrackets:false}).omitCharacters, '');
  assert.equal(api.normalizeTtsSettings({stripBrackets:true}).omitCharacters, '[, ]');
  assert.equal(api.normalizeTtsSettings({omitCharacters:''}).omitCharacters, '');
  assert.equal(api.normalizeTtsSettings({stripBrackets:false,omitCharacters:'【, 】'}).omitCharacters, '【, 】');
  assert.equal(api.normalizeTtsSettings({omitCharacters:42}).omitCharacters, '[, ]');
});
