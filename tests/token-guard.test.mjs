import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { installHost } from '../tools/parity/host.mjs';

/**
 * A wiki module turns every `[[…]]` into a link at the default order, ahead of
 * our rules: `[[@inray::…]]` became blue text instead of the image. Our tokens
 * are masked first and unmasked after every default-order module, so the image
 * draws and the module keeps its own `[[links]]`. Display rules are applied the
 * way Risu does: by `<order N>` (default 0), higher first, stable within one order.
 */
const WIKI_LINK = { comment: '링크', type: 'editdisplay', flag: 'g', in: '\\[\\[(.+?)\\]\\]', out: '<a style="color:#0275d8">$1</a>' };
const orderOf = rule => Number(/<order (-?\d+)/.exec(rule.flag || '')?.[1] ?? 0);
function display(text, rules) {
  const sorted = rules.filter(rule => rule.type === 'editdisplay').map((rule, i) => ({ rule, i }))
    .sort((a, b) => orderOf(b.rule) - orderOf(a.rule) || a.i - b.i).map(row => row.rule);
  for (const rule of sorted) text = text.replace(new RegExp(rule.in, String(rule.flag || '').replace(/<[^>]*>/g, '')), rule.out);
  return text;
}

test('our [[…]] tokens survive a module that links every [[…]]; that module keeps its own links', { timeout: 60000 }, async () => {
  installHost({ promptsDir: 'prompts' });
  const api = await import('../.test-build/stream-services.mjs?token-guard');
  await api.openDb();
  await api.ensureInrayDisplayModule(false, 100);
  await api.ensureInlineTagModule(true, 100, false);
  await api.ensureOmniHelperModule(true);
  const sound = await build({ stdin: { contents: `export { soundModule } from './src/domain/sound/module'; export { soundDefaults } from './src/config/sound-defaults';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
  const { soundModule, soundDefaults } = await import('data:text/javascript;base64,' + Buffer.from(sound.outputFiles[0].text).toString('base64'));
  const bgm = soundModule('bgm', soundDefaults(), []);
  const db = await risuai.getDatabase();
  const ours = [...db.modules.flatMap(module => module.regex || []), ...bgm.regex];
  // The wiki module sits in front, as an earlier-installed module would.
  const rules = [WIKI_LINK, ...ours];

  const image = '[[@inray::shot1::inxshot_shot1.srisu_ab.webp::832::1216]]';
  const chat = `앞 문장\n${image}\n[[홍길동]]은 [[서울]]에 산다.\n[[imgstart]]\n[[bgm:calm, cafe]]\n[[inx1]]{"aspect":"portrait","characters":[]}[[/inx1]]\n뒤 문장`;
  const shown = display(chat, rules);
  assert.match(shown, /class="inray-shot"/, 'the image is drawn');
  assert.doesNotMatch(shown, /@inray::|<a style="color:#0275d8">@/, 'never a link of our token');
  assert.match(shown, /<a style="color:#0275d8">홍길동<\/a>은 <a style="color:#0275d8">서울<\/a>에 산다/, 'the module still links its own [[…]]');
  assert.doesNotMatch(shown, /imgstart/, 'the 보조 프롬 marker is hidden');
  assert.match(shown, /data-omni-bgm/, 'the BGM marker is a ♪');
  assert.match(shown, /data-inx-slot="1"/, 'a streaming-tag block is a slot');
  assert.doesNotMatch(shown, /[]/, 'no mask is left on screen');

  // Without the mask the wiki module wins: the conflict this guards against.
  const bare = display(chat, rules.filter(rule => !/^omni-token-/.test(rule.comment)));
  assert.doesNotMatch(bare, /class="inray-shot"/);
  assert.match(bare, /<a style="color:#0275d8">@inray::shot1/);

  // With no other module, the mask changes nothing.
  const alone = display(chat, ours), plain = display(chat, ours.filter(rule => !/^omni-token-/.test(rule.comment)));
  assert.equal(alone, plain, 'same output as before the guard');
  // One pair per module, never piling up on rewrites.
  await api.ensureInlineTagModule(true, 100, false); await api.ensureOmniHelperModule(true); await api.ensureInrayDisplayModule(false, 100);
  const again = (await risuai.getDatabase()).modules;
  for (const module of again) assert.ok((module.regex || []).filter(rule => rule.comment === 'omni-token-guard').length <= 1, module.name);
});
