import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { installHost } from '../tools/parity/host.mjs';

/**
 * 디버그 → 백업: one file with every setting and its API keys (unlike every
 * shared export), restored whole on another device.
 */
const built = await build({ stdin: { contents: `
  export { exportFullBackup, importFullBackup, FULL_BACKUP_TYPE } from './src/services/full-backup';
  export { openDb } from './src/storage/stores';
  export { seedPrompts, exportSettingsJson, getPrompt, setPrompt } from './src/services/settings';
  export { getConfig, setConfig } from './src/services/context';
  export { loadTtsData, ttsData, updateTtsSettings } from './src/storage/tts-store';
  export { loadSoundData, soundData, updateSoundSettings } from './src/storage/sound-store';
  export { listCommandPresets, saveCommandPresets } from './src/services/char-command-presets';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' } });
const code = built.outputFiles[0].text;
let n = 0;
const fresh = async () => {
  installHost({ promptsDir: 'prompts' });
  const api = await import('data:text/javascript;base64,' + Buffer.from(code + `\n//${++n}`).toString('base64'));
  await api.openDb(); await api.seedPrompts(); await api.loadTtsData(); await api.loadSoundData();
  return api;
};

test('모든 설정 내보내기 carries every key; 불러오기 restores all of it on another device', { timeout: 60000 }, async () => {
  const a = await fresh();
  const config = a.getConfig();
  config.llm = { ...config.llm, api_key: 'llm-secret-123456' };
  config.nai = { ...config.nai, api_key: 'nai-secret-123456', width: 1024 };
  config.card.image_max = 4;
  a.setConfig(config);
  await a.updateTtsSettings({ fish: { ...a.ttsData().settings.fish, key: 'fish-secret-123456' }, speed: 1.5 });
  await a.updateSoundSettings({ elevenKey: 'eleven-secret-123', bgmVolume: 0.3 });
  await a.saveCommandPresets([{ id: 'p1', name: '교복', cmd: '교복으로', cmd_post: '' }]);
  const text = await a.exportFullBackup();
  const doc = JSON.parse(text);
  assert.equal(doc.type, a.FULL_BACKUP_TYPE); assert.match(doc.warning, /공유하지 마세요/);
  for (const secret of ['llm-secret-123456', 'nai-secret-123456', 'fish-secret-123456', 'eleven-secret-123']) assert.ok(text.includes(secret), `${secret} is in the backup`);
  assert.ok(doc.prompts && Object.keys(doc.prompts).length > 3, 'prompts ride along');
  // The ordinary settings export still strips every key.
  const shared = await a.exportSettingsJson();
  assert.ok(!shared.includes('llm-secret-123456') && !shared.includes('nai-secret-123456'));

  // Another device: nothing set, then the file.
  const b = await fresh();
  assert.notEqual(b.getConfig().llm.api_key, 'llm-secret-123456');
  const result = await b.importFullBackup(text);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.restored, ['삽화 설정', '프롬프트', '명령 프리셋', 'TTS', 'BGM·효과음']);
  assert.equal(b.getConfig().llm.api_key, 'llm-secret-123456'); assert.equal(b.getConfig().nai.api_key, 'nai-secret-123456');
  assert.equal(b.getConfig().nai.width, 1024); assert.equal(b.getConfig().card.image_max, 4);
  assert.equal(b.ttsData().settings.fish.key, 'fish-secret-123456'); assert.equal(b.ttsData().settings.speed, 1.5);
  assert.equal(b.soundData().settings.elevenKey, 'eleven-secret-123'); assert.equal(b.soundData().settings.bgmVolume, 0.3);
  assert.deepEqual((await b.listCommandPresets()).items.map(p => p.name), ['교복']);
  // Not a backup: refused, nothing touched.
  const refused = await b.importFullBackup(JSON.stringify({ type: 'omnitts-settings', settings: {} }));
  assert.equal(refused.ok, false); assert.equal(b.getConfig().llm.api_key, 'llm-secret-123456');
});
