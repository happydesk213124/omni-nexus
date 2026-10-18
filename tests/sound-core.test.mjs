import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './src/domain/sound/tags';export * from './src/domain/sound/match';export * from './src/domain/sound/audio';export * from './src/domain/sound/clip';export * from './src/domain/sound/scene';export * from './src/domain/sound/combo';export * from './src/domain/sound/find';export * from './src/domain/sound/module';export * from './src/config/sound-defaults';export {normalizeSoundData,loadSoundData,saveSoundData,soundData,resetSoundStore} from './src/storage/sound-store';export {SOUND_SAMPLES} from './src/config/sound-samples';export {parseCueLine,parseTtsMessage} from './src/domain/tts/segment';export {matchTtsAnchors} from './src/domain/tts/anchors';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const item = (key, tags, kind = 'bgm') => ({ key, kind, name: key, tags, folder: '', source: 'url', url: `https://x.test/${key}.mp3` });
// Display rules as Risu runs them: highest <order> first, its own flags.
const render = (rules, text) => {
  const order = rule => Number((/<order (-?\d+)/.exec(rule.flag || '') || [])[1] || 0);
  for (const rule of [...rules].sort((a, b) => order(b) - order(a))) {
    const flags = [...new Set(String(rule.flag || 'g').replace(/<[^>]*>/g, '').replace(/[^dgimsuvy]/g, ''))].join('') || 'u';
    text = text.replace(new RegExp(rule.in, flags), rule.out);
  }
  return text;
};

test('BGM tags: thirty vocabulary words, synonyms fold in, the marker yields three tags', () => {
  assert.equal(api.BGM_TAGS.length, 30);
  assert.equal(api.normalizeSoundTag(' Tense '), 'tense');
  assert.equal(api.normalizeSoundTag('긴박'), 'tense');
  assert.equal(api.normalizeSoundTag('추격'), 'chase');
  assert.deepEqual(api.parseBgmMarker('[[bgm:tense, chase, fast]]\n본문'), ['tense', 'chase', 'fast']);
  assert.equal(api.parseBgmMarker('그냥 본문'), null);
  assert.match(api.bgmPromptText(api.BGM_TAGS), /exactly three tags/);
  assert.doesNotMatch(api.bgmPromptText(api.BGM_TAGS), /https?:/, 'the prompt never carries the track list');
});

test('BGM pick: shared tags decide, the current track stays unless another is strictly better', () => {
  const items = [item('chase', ['tense', 'chase', 'fast']), item('calm-day', ['calm', 'daily', 'slow']), item('night', ['tense', 'night', 'slow'])];
  assert.deepEqual(api.pickBgm(['긴박', '추격', '빠른'], items), { key: 'chase', score: 3, reason: 'switch' });
  // One tag in common with the current song, one with another: keep playing.
  assert.equal(api.pickBgm(['tense', 'school', 'mid'], items, 'night').key, 'night');
  assert.equal(api.pickBgm(['tense', 'night', 'slow'], items, 'chase').key, 'night', 'a strictly better match switches');
  assert.deepEqual(api.pickBgm(['festival'], items, 'chase'), { key: 'chase', score: 0, reason: 'keep' });
  assert.deepEqual(api.pickBgm(['festival'], items), { key: '', score: 0, reason: 'none' });
});

test('effects: rules find the words in reading order, the glossary picks the sound', () => {
  const rules = api.soundDefaults().sfxRules;
  const text = '§싸아아아──§\n문이 열렸다.\n§덜컹! 덜컹! 와르르르르──!§';
  assert.deepEqual(api.sfxHits(text, rules).map(hit => hit.word), ['싸아아아──', '덜컹! 덜컹! 와르르르르──!']);
  assert.notEqual(api.sfxMarksProblem('', '§'), '');
  assert.deepEqual(api.sfxHits('§x§', [{ id: 'bad', name: 'bad', open: '', close: '§', enabled: true }]), [], 'a rule without both marks is skipped');
  const marks = (id, open, close) => ({ id, name: id, open, close, enabled: true });
  assert.deepEqual(api.sfxHits('[[쾅]] 그리고 (펑) *휙*', [marks('b', '[[', ']]'), marks('p', '(', ')'), marks('s', '*', '*')]).map(hit => hit.word), ['쾅', '펑', '휙'], 'marks are literal, regex characters too');
  assert.deepEqual(api.sfxHits('§열린 채로\n다음 줄§ 끝', rules), [], 'a mark left open never swallows the next line');
  assert.deepEqual(api.sfxHits('<b title="§쾅§">x</b>', rules).length, 0, 'never across a tag');
  assert.deepEqual(api.sfxMarksFromPattern('§([^§\\n]{1,60})§'), { open: '§', close: '§' }, 'a rule saved as a regex keeps its marks');
  assert.deepEqual(api.sfxMarksFromPattern('\\*([^*\\n]{1,40})\\*'), { open: '*', close: '*' });
  assert.deepEqual(api.sfxMarksFromPattern('(?:x|y)+'), { open: '§', close: '§' }, 'anything else becomes the § rule');
  const migrated = api.normalizeSoundData({ settings: { sfxRules: [{ id: 'old', name: '옛 규칙', pattern: '\\[([^\\]\\n]{1,60})\\]', flags: 'i', enabled: true }] } }).settings.sfxRules;
  assert.deepEqual(migrated, [{ id: 'old', name: '옛 규칙', open: '[', close: ']', enabled: true }], 'older saves keep their rule as marks, without the regex');
  const sfx = [item('door', ['문 닫힘'], 'sfx'), item('crash', ['붕괴'], 'sfx')];
  const glossary = [{ id: 'g', terms: ['덜컹', '쾅'], sfxKey: 'door', enabled: true }, { id: 'h', terms: ['와르르'], sfxKey: 'crash', enabled: false }];
  assert.equal(api.pickSfx('덜컹! 덜컹!', glossary, sfx).key, 'door');
  assert.equal(api.pickSfx('와르르', glossary, sfx), null, 'a disabled glossary row is ignored');
  assert.equal(api.pickSfx('쾅! 문 닫힘', glossary, sfx).key, 'door', 'an effect tag can match without a glossary row');
  assert.equal(api.pickSfx('문이 열렸다', [], [item('one', ['문'], 'sfx')]), null, 'a one-letter tag never matches inside a longer word (it would hit every word)');
  assert.equal(api.pickSfx('쾅', [], [item('bang', ['쾅'], 'sfx')]).key, 'bang', 'but the whole word §쾅§ matches its own one-letter name');
});

test('audio files are recognised by their bytes, not their names', () => {
  const head = text => new Uint8Array([...text].map(c => c.charCodeAt(0)).concat(Array(16).fill(0)));
  assert.equal(api.sniffAudioMime(head('ID3')), 'audio/mpeg');
  assert.equal(api.sniffAudioMime(new Uint8Array([0xff, 0xfb, 0x90, 0, ...Array(12).fill(0)])), 'audio/mpeg');
  const wav = head('RIFF0000WAVE'); assert.equal(api.sniffAudioMime(wav), 'audio/wav');
  assert.equal(api.sniffAudioMime(head('OggS')), 'audio/ogg');
  assert.equal(api.sniffAudioMime(head('<!doctype html>')), '', 'a web page is not audio');
});

test('modules: ⚛️ names, display rules run before OmniTTS, files become module assets', () => {
  const settings = { ...api.soundDefaults(), bgmEnabled: true, sfxEnabled: true };
  const bgm = api.soundModule('bgm', settings, [{ ...item('a', []), source: 'asset', assetName: 'omnisound_bgm_a.mp3', assetPath: 'assets/a.mp3' }, item('b', [])]);
  assert.equal(bgm.name, '⚛️ omni bgm'); assert.equal(bgm.id, 'omni-bgm');
  assert.deepEqual(bgm.assets, [['omnisound_bgm_a.mp3', 'assets/a.mp3', 'omnisound_bgm_a.mp3']], 'only stored files are assets; links are not');
  assert.match(bgm.regex[0].flag, /<order -10120,no_end_nl>/, 'no_end_nl: Risu would add a line break after the button');
  assert.ok(-10120 > -10200, 'higher order runs first: the marker is a button before TTS reads lines');
  const shown = '[[bgm:tense,chase,fast]]\n본문'.replace(new RegExp(bgm.regex[0].in, 'gi'), bgm.regex[0].out);
  assert.match(shown, /data-omni-bgm="1"[^>]*><\/button>/, 'an empty control: the glyph is module CSS, so the line text TTS reads stays clean'); assert.doesNotMatch(shown, /\[\[bgm:/);
  assert.match(bgm.backgroundEmbedding, /\[data-omni-bgm\]::before\{content:"♪"\}/);
  assert.match(bgm.lorebook[0].content, /\[\[bgm:mood,place,tempo\]\]/);
  assert.match(bgm.lorebook[0].content, /only where the music should change[\s\S]*turns sharply/, 'a cue only where the music changes, mid-reply too');
  assert.match(bgm.lorebook[0].content, /directly before the first narration or dialogue line/, 'the cue sits before the line it scores, not at the very top');
  assert.doesNotMatch(bgm.lorebook[0].content, /begin every reply/);
  assert.equal(api.soundModule('bgm', { ...settings, bgmPrompt: false }, []).lorebook.length, 0);
  const sfx = api.soundModule('sfx', settings, []);
  assert.equal(sfx.name, '⚛️ omni 효과음');
  const line = render(sfx.regex, '§덜컹§ 문이 열렸다.');
  assert.match(line, /^§덜컹§<span data-omni-sfx-tail="1"><button[^>]*data-omni-sfx="1"[^>]*><\/button><\/span> 문이 열렸다\.$/, 'the effect text stays and a gray ▶ follows it');
  assert.equal(render(api.soundModule('sfx', { ...settings, sfxFirst: false }, []).regex, '§덜컹§'), line.replace(' 문이 열렸다.', ''), 'the same look either way');
  const dashed = api.soundModule('sfx', { ...settings, sfxRules: [{ id: 'd', name: 'd', open: '--', close: '-]', enabled: true }] }, []);
  assert.match(render(dashed.regex, '--쾅-]'), /^--쾅-\]<span data-omni-sfx-tail/, 'a dash or bracket in a mark is literal in unicode mode');
  assert.deepEqual(api.sfxHits('--쾅-] 그리고', [{ id: 'd', name: 'd', open: '--', close: '-]', enabled: true }]).map(hit => hit.word), ['쾅']);
  assert.match(sfx.regex[0].flag, /<order 10130,no_end_nl>/, 'before every other module by default');
  assert.match(api.soundModule('sfx', { ...settings, sfxFirst: false }, []).regex[0].flag, /<order -10130,no_end_nl>/, 'off: after them, as before');
  assert.match(sfx.backgroundEmbedding, /\[data-omni-sfx\]::before\{content:"▶"\}/);
  assert.match(sfx.lorebook[0]?.content || '', /§쾅§/, 'the model is told how to mark an effect');
  assert.equal(api.soundModule('sfx', { ...settings, sfxCue: false }, []).lorebook.length, 0);
  assert.equal(api.soundModule('sfx', { ...settings, sfxRules: settings.sfxRules.map(r => ({ ...r, enabled: false })) }, []).lorebook.length, 0, 'no rule in use, no instruction');
  const own = api.soundModule('sfx', { ...settings, sfxRules: [{ id: 'mine', name: 'mine', open: '【', close: '】', enabled: true }] }, []);
  assert.match(own.lorebook[0]?.content || '', /\n【쾅】\n문이 닫혔다\./, 'the instruction uses the marks the chat will show, for any rule, on a line of their own');
  assert.match(own.lorebook[0]?.content || '', /Never put the marks inside a narration or dialogue line/);
  assert.equal(render(own.regex, '【쾅】').includes('data-omni-sfx'), true);
  assert.equal(render(sfx.regex, '<div title="§쾅§">x</div>'), '<div title="§쾅§">x</div>', 'a mark inside a tag attribute gets no button');
});

test('cues join the TTS lines in order; effect words are played, not read', () => {
  const rules = api.soundDefaults().sfxRules;
  const reply = '[[bgm:calm,cafe,slow]]\n그가 문을 열었다. §문 쾅§ 소리가 울렸다.\n하린 (calm): "괜찮아."\n[[bgm:tense,chase,fast]]\n§우르르 쾅§';
  const rows = api.parseTtsMessage(reply, [], 1, true, { bgm: true, sfxRules: rules });
  // An effect past the middle of its line plays after the line; the music is always set first.
  assert.deepEqual(rows.map(r => [r.kind, r.text]), [['bgm', 'calm, cafe, slow'], ['narration', '그가 문을 열었다. §문 쾅§ 소리가 울렸다.'], ['sfx', '문 쾅'], ['dialogue', '괜찮아.'], ['bgm', 'tense, chase, fast'], ['sfx', '우르르 쾅']]);
  assert.equal(rows[1].spoken, '그가 문을 열었다. 소리가 울렸다.');
  const order = text => api.parseTtsMessage(text, [], 1, true, { bgm: true, sfxRules: rules }).map(r => r.kind);
  assert.deepEqual(order('§끼이익§ 문이 열렸다.'), ['sfx', 'narration'], 'a mark in the first half: the effect, then the line');
  assert.deepEqual(order('그가 문을 닫았다. §쾅§'), ['narration', 'sfx'], 'in the second half: the line, then the effect');
  assert.deepEqual(order('하린 (calm): "§쾅§ 깜짝이야."'), ['sfx', 'dialogue'], 'the same inside a dialogue line');
  assert.deepEqual(order('하린 (calm):\n"놀랐잖아. §쾅§"'), ['dialogue', 'sfx'], 'and in a two-line cue');
  assert.deepEqual(rows[4].tags, ['tense', 'chase', 'fast'], 'a second cue changes the music mid-reply');
  assert.equal(rows[2].context, '그가 문을 열었다. §문 쾅§ 소리가 울렸다.');
  assert.equal(rows.filter(r => r.kind === 'narration').length, 1, 'a line that is only an effect is not read');
  assert.deepEqual(api.parseTtsMessage(reply).map(r => r.kind), ['narration', 'dialogue', 'narration'], 'without sound on, nothing changes');
  // Chat controls exist only for spoken lines: a cue never takes one.
  assert.deepEqual(api.matchTtsAnchors([{ kind: 'narration', text: '문 쾅' }, { kind: 'narration', text: '그가 문을 열었다. §문 쾅§ 소리가 울렸다.' }], rows), [-1, 1]);
});

test('TTS never reads a streaming-tag block, even one spanning lines or still open', () => {
  const rows = api.parseTtsMessage('그가 웃었다.\n[[inx1]]\n{"place":"room","characters":[]}\n[[/inx1]]\n하린 (calm): "안녕."\n[[inx2]]{"place":"ha');
  assert.deepEqual(rows.map(r => r.text), ['그가 웃었다.', '안녕.']);
  assert.equal(rows[1].start, '그가 웃었다.\n[[inx1]]\n{"place":"room","characters":[]}\n[[/inx1]]\n'.length, 'offsets still point at the source');
});

test('TTS never reads the BGM marker line', () => {
  assert.equal(api.parseCueLine('[[bgm:tense,chase,fast]]', '1'), null);
  assert.equal(api.parseCueLine('그녀가 문을 열었다.', '2').kind, 'narration');
});

test('stored data is normalised: bad rows dropped, settings clamped', () => {
  const data = api.normalizeSoundData({ settings: { bgmVolume: 7, bgmMatcher: 'nope', bgmTags: [] }, bgm: [item('ok', ['a']), { key: 'x', name: 'no url', source: 'url', url: 'http://insecure' }], sfx: [{ key: 'f', name: 'file', source: 'asset' }] });
  assert.equal(data.settings.bgmVolume, 1); assert.equal(data.settings.bgmMatcher, 'auto'); assert.equal(data.settings.bgmTags.length, 30);
  assert.deepEqual(data.bgm.map(i => i.key), ['ok']); assert.deepEqual(data.sfx, [], 'a file row without its asset path is dropped');
});

test('effect clips: the silence around a sound is skipped, a long one stops at the limit, every one plays as loud', () => {
  const rate = 1000, tone = (seconds, level, lead = 0, tail = 0) => {
    const data = new Float32Array(Math.round((lead + seconds + tail) * rate));
    for (let i = Math.round(lead * rate); i < Math.round((lead + seconds) * rate); i++) data[i] = level * Math.sin(i / 3);
    return [data];
  };
  const all = { maxSeconds: 0, trim: false, normalize: false };
  const padded = tone(.5, .5, 1, 2);
  assert.deepEqual(api.sfxWindow(padded, rate, all), { start: 0, end: 3500, cut: false, gain: 1 }, 'everything off: the file as it is');
  const trimmed = api.sfxWindow(padded, rate, { ...all, trim: true });
  assert.ok(trimmed.start >= 980 && trimmed.start <= 1001 && trimmed.end >= 1499 && trimmed.end <= 1551, 'only a breath of the silence stays: ' + JSON.stringify(trimmed));
  assert.deepEqual(api.sfxWindow([new Float32Array(500)], rate, { ...all, trim: true }), { start: 0, end: 500, cut: false, gain: 1 }, 'a silent file is not cut to nothing');
  const long = api.sfxWindow(tone(120, .5), rate, { ...all, maxSeconds: 6 });
  assert.deepEqual([long.end - long.start, long.cut], [6000, true], 'a two-minute ambience stops at six seconds');
  const loud = api.sfxWindow(tone(1, .9), rate, { ...all, normalize: true }), quiet = api.sfxWindow(tone(1, .05), rate, { ...all, normalize: true });
  const rms = (channels, w) => { let sum = 0; for (let i = w.start; i < w.end; i++) sum += (channels[0][i] * w.gain) ** 2; return Math.sqrt(sum / (w.end - w.start)); };
  assert.ok(Math.abs(20 * Math.log10(rms(tone(1, .9), loud) / rms(tone(1, .05), quiet))) < 1, 'a loud and a quiet effect end up within 1 dB');
  assert.ok(.9 * loud.gain <= .98 + 1e-9 && .05 * quiet.gain <= .98 + 1e-9, 'never past the safe peak');
  const wav = new DataView(api.encodeSfxWav(padded, rate, { ...trimmed, cut: true }));
  assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), 'RIFF');
  assert.equal(wav.getUint32(40, true), (trimmed.end - trimmed.start) * 2, 'one 16-bit channel of exactly the window');
  assert.equal(wav.getInt16(wav.byteLength - 2, true), 0, 'a cut clip fades out to silence');
});

test('⚡ BGM scene: the prose only, and a long reply keeps its start and its end', () => {
  const reply = '<Thoughts>\nsecret plan\n</Thoughts>\n[[bgm:calm,cafe,slow]]\n비가 내리는 카페.\n[[@inray::c::inxshot_c.png::1::1]]\n[[inx1]]{"place":"x"}[[/inx1]]\n그녀가 웃었다.';
  assert.equal(api.bgmSceneText(reply), '비가 내리는 카페.\n그녀가 웃었다.');
  const long = '시작 문단.\n' + '가'.repeat(9000) + '\n지금 장면.';
  const scene = api.bgmSceneText(long, 4000);
  assert.ok(scene.length <= 4003 && scene.startsWith('시작 문단.') && scene.endsWith('지금 장면.'), 'start and the current end both stay');
});

test('another module that restyles §쾅§ into its own box carries ▶ inside it, on the same line', () => {
  // As a user's module had it: the marks go, the word goes in a block, and a blank line follows the block.
  const theirs = { comment: '의성어', type: 'editdisplay', ableFlag: true, flag: 'gs', in: '§([^§\\n\\r]+)§', out: '\n\n<div class="regex-sound-block">$1</div>\n\n' };
  const settings = api.soundDefaults();
  const first = render([theirs, ...api.soundModule('sfx', settings, []).regex], '문이 §끼이익── 쿠구궁!§ 닫혔다.');
  assert.match(first, /<div class="regex-sound-block">끼이익── 쿠구궁!<span data-omni-sfx-tail="1"><button[^>]*data-omni-sfx="1"[^>]*><\/button><\/span><\/div>/, 'their box carries ▶ right after the word, not on the next line');
  assert.equal((first.match(/data-omni-sfx="1"/g) || []).length, 1, 'one ▶, no leftover from the closing step');
  const after = render([theirs, ...api.soundModule('sfx', { ...settings, sfxFirst: false }, []).regex], '문이 §쾅§ 닫혔다.');
  assert.doesNotMatch(after, /data-omni-sfx/, 'switched off it is the old behaviour: nothing left to put ▶ on');
});

test('a *…* rule never touches a <style> or <script> block: a CSS comment kept its */', () => {
  // A character's CSS, as one user's had it: with *효과음*, every comment lost its */
  // to the ▶ and commented out each rule after it, so the cards drew unstyled.
  const css = '<style>\n.a { color: red; }\n/* 다음 로그가 있으면 경계선을 제거한다. */\n.b { border: 0; }\n/* Status Window */\n.c { width: 100%; }\n</style>';
  const script = '<script>\nconst x = 2 *3* 4;\n</script>';
  const story = '그가 문을 닫았다.\n*쾅*\n정적이 흘렀다.';
  for (const sfxFirst of [true, false]) {
    const settings = { ...api.soundDefaults(), sfxFirst, sfxRules: [{ id: 'star', name: '*효과음*', open: '*', close: '*', enabled: true }] };
    const rules = api.soundModule('sfx', settings, []).regex;
    const shown = render(rules, `${css}\n${script}\n${story}\n${css}`);
    assert.equal(shown.split(css).length, 3, `sfxFirst=${sfxFirst}: both style blocks exactly as written`);
    assert.ok(shown.includes(script), `sfxFirst=${sfxFirst}: the script block as written`);
    assert.equal((shown.match(/data-omni-sfx="1"/g) || []).length, 1, `sfxFirst=${sfxFirst}: the story's *쾅* still gets its ▶`);
    assert.deepEqual(api.sfxHits(`${css}\n${story}`, settings.sfxRules).map(hit => hit.word), ['쾅'], 'the played cues skip the CSS too, so ▶ and cue stay paired');
  }
});

test('compound effects: split into sounds, a longer sound plays longer, all fit the longest length, joined into one clip', () => {
  assert.deepEqual(api.sfxParts('콰아앙 치이익 또르르'), ['콰아앙', '치이익', '또르르']);
  assert.deepEqual(api.sfxParts('끼이이익── 쿠구구구궁!'), ['끼이이익', '쿠구구구궁']);
  assert.deepEqual(api.sfxParts('쾅'), ['쾅']);
  assert.deepEqual(api.sfxParts('쾅!!'), ['쾅!!'], 'one sound keeps its word as written');
  assert.equal(api.sfxParts('a b c d e f').length, 4, 'four sounds at most');
  assert.deepEqual(api.sfxPartSeconds(['쾅', '콰앙', '콰아앙', '콰아아아앙'], 0), [1, 1, 2, 3]);
  const shared = api.sfxPartSeconds(['콰아앙', '치이익', '또르르'], 5);
  assert.ok(Math.abs(shared.reduce((a, b) => a + b, 0) - 5) < 1e-9 && shared.every(n => Math.abs(n - 5 / 3) < 1e-9), 'six seconds shrink evenly into five');
  assert.deepEqual(api.sfxPartSeconds(['쾅', '탕'], 5), [1, 1], 'what fits is left alone');
  const items = [{ key: 'door', kind: 'sfx', name: '문 쾅', tags: [], folder: '', source: 'url', url: 'https://x.test/d.mp3' }];
  assert.equal(api.exactSfx('문  쾅!', [], items)?.key, 'door', 'an effect named by the whole compound stays one effect');
  assert.equal(api.exactSfx('문 쾅 소리', [], items), null);
  const rate = 1000, tone = level => [Float32Array.from({ length: 1000 }, (_, i) => level * Math.sin(i / 3))];
  const a = tone(.5), b = tone(.5);
  const joined = api.joinSfxClips([{ channels: a, window: { start: 0, end: 1000, cut: false, gain: 1 } }, { channels: b, window: { start: 0, end: 600, cut: true, gain: 2 } }], rate, .04);
  assert.equal(joined[0].length, 1000 + 600 - 40, 'end to end, overlapping by the crossfade');
  assert.ok(Math.abs(joined[0][800] - a[0][800]) < 1e-6, 'the first sound as it was');
  assert.ok(Math.abs(joined[0][1100] - 2 * b[0][140]) < 1e-6, 'the second levelled by its own gain');
  assert.ok(Math.abs(joined[0].at(-1)) < .01 && Math.abs(joined[0].at(-1)) < Math.abs(joined[0][1100]) / 10, 'a part cut at its share fades out');
});

test('a word is matched to effects by how it sounds, jamo by jamo, and search covers the folder', () => {
  assert.ok(api.soundWordSimilarity('콰광', '콰앙') > 0.55, 'a different syllable, but only two jamo apart');
  assert.ok(api.soundWordSimilarity('철컥', '철컹') > 0.6);
  assert.ok(api.soundWordSimilarity('휘이잉', '띠리링') < 0.45, 'only the ending in common');
  assert.ok(api.soundWordSimilarity('뚜벅뚜벅', '북적') < api.soundWordSimilarity('뚜벅뚜벅', '저벅저벅'), 'the same letters in another order are another sound');
  assert.ok(api.soundWordSimilarity('우당탕', '쾅') < 0.2);
  assert.equal(api.soundWordSimilarity('휘잉', '휘잉!'), 1);
  const items = [{ key: 'door', name: '문 쾅', tags: ['쾅'], folder: '문' }, { key: 'wind', name: '강풍', tags: ['휘잉', '바람'], folder: '날씨' }, { key: 'step', name: '발소리', tags: [], folder: '사람' }, { key: 'market', name: '야외 시장', tags: ['북적'], folder: '환경음' }];
  const glossary = [{ id: 'g', terms: ['저벅저벅'], sfxKey: 'step', enabled: true }];
  assert.deepEqual(api.suggestSfx('휘이잉', glossary, items).map(i => i.key), ['wind']);
  assert.deepEqual(api.suggestSfx('뚜벅뚜벅', glossary, items).map(i => i.key), ['step', 'market'], 'glossary words count as the effect\'s spellings; the picker also lists a looser guess');
  assert.deepEqual(api.suggestSfx('뚜벅뚜벅', glossary, items, 3, 0.55).map(i => i.key), ['step'], 'a looser guess (북적) is not a one-tap chip');
  assert.deepEqual(api.suggestSfx('삐리리', glossary, items), []);
  assert.equal(api.matchesSoundSearch(items[1], '날씨'), true, 'the folder is searchable');
  assert.equal(api.matchesSoundSearch(items[1], '날씨 & 문'), false);
});

test('a first run starts with the example lists; a save whose lists were emptied stays empty', async () => {
  const kv = new Map();
  globalThis.risuai = { pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => { kv.set(k, v); } } };
  try {
    api.resetSoundStore();
    const first = await api.loadSoundData();
    assert.equal(first.bgm.length, api.SOUND_SAMPLES.bgm.items.length); assert.equal(first.sfx.length, api.SOUND_SAMPLES.sfx.items.length);
    assert.ok(first.bgm.length > 100 && first.sfx.length > 100, 'both example lists are there');
    assert.ok(first.bgm.every(item => item.source === 'url' && item.url.startsWith('https://')), 'links only: nothing goes into the save file');
    assert.deepEqual(first.folders.bgm, api.SOUND_SAMPLES.bgm.folders);
    assert.equal(kv.size, 0, 'loading writes nothing');
    first.bgm.length = 0; first.sfx.length = 0; await api.saveSoundData();
    api.resetSoundStore();
    const again = await api.loadSoundData();
    assert.deepEqual([again.bgm.length, again.sfx.length], [0, 0], 'deleted examples never come back by themselves');
  } finally { delete globalThis.risuai; api.resetSoundStore(); }
});

test('defaults: quiet music under the voice, a short crossfade, full-level effects cut at 3 s, both off until switched on', () => {
  const d = api.soundDefaults();
  assert.deepEqual([d.bgmVolume, d.sfxVolume, d.duck, d.crossfadeMs, d.sfxMaxSec], [0.29, 1, 0.26, 500, 3]);
  assert.deepEqual([d.bgmEnabled, d.sfxEnabled], [false, false], 'installing changes nothing in the chat until a switch is on');
  assert.deepEqual([d.bgmMatcher, d.sfxMatcher], ['auto', 'auto'], 'auto is JEV with a key and the LLM without one; jev alone would fail before a key is set');
});
