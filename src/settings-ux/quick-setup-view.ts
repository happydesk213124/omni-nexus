import { QUICK_STEPS, quickDraws, quickKeyLooksRight, quickKeyNeeds, quickPicks, quickStepSkipped, type QuickAnswers, type QuickFeature, type QuickKey, type QuickStep } from '../domain/quick-setup';

/**
 * ⚡ 빠른 설정's look: one window over the settings, the same size from the first step to the last (it once grew and
 * shrank with every step and every choice), full screen on a phone. A rail on the left names the steps and what each
 * holds so far; the pane on the right asks. Everything here is markup built from the answers; the sheet
 * (quick-setup.ts) listens on its root and paints again on a choice, keeping the scroll and the field being typed in.
 */
export type QuickPane = QuickStep | 'done';
export const STEP_TITLES: Record<QuickPane, string> = { features: '무엇을 쓸까요', draw: '그림', sound: '소리', models: '모델', keys: 'API 키', review: '확인', done: '완료' };
const STEP_LEADS: Record<QuickPane, string> = {
  features: '쓸 것만 켜세요. 끈 것은 꺼 두고, 나머지 세부 값은 그대로 둡니다.',
  draw: '그림을 누가, 몇 장, 어떻게 그릴지 정합니다.',
  sound: '목소리와 효과음이 언제, 어떻게 나올지 정합니다.',
  models: 'Omni가 따로 물어볼 모델과, 목소리·장소·음악을 고르는 방법입니다.',
  keys: '고른 기능에 필요한 키만 보여 드려요. 이미 저장된 키는 비워 두면 그대로 씁니다.',
  review: '아래처럼 맞춥니다. 적용을 누르면 바로 저장돼요.',
  done: '설정했어요. 세부 값은 왼쪽 메뉴에서 언제든 바꿀 수 있고, 이 창은 위의 ⚡로 다시 열 수 있어요.',
};

export interface QuickCheck { state: 'idle' | 'busy' | 'ok' | 'bad'; text: string }
export interface QuickView {
  step: QuickPane;
  answers: QuickAnswers;
  /** The answers the sheet opened with: what differs is marked 변경 in the review. */
  initial: QuickAnswers;
  saved: Record<QuickKey, boolean>;
  checks: Record<QuickKey, QuickCheck>;
  /** Keys shown as typed (👁). */
  shown: Record<QuickKey, boolean>;
  qualityTokens: number;
  /** The helper model used when 직접's model field is left empty. */
  helperDefault: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const on = (b: boolean) => `aria-pressed="${b}"`;

// ── step 1: features ──
interface FeatureRow { key: QuickFeature; icon: string; title: string; note: string; needs: string }
const FEATURE_GROUPS: ReadonlyArray<[string, readonly FeatureRow[]]> = [
  ['그림', [
    { key: 'image', icon: '🖼️', title: '삽화', note: '답장 속 장면을 그림 한 장으로', needs: 'NovelAI' },
    { key: 'comic', icon: '📖', title: '만화', note: '대화와 이어지는 동작을 컷 만화로', needs: 'NovelAI' },
  ]],
  ['소리', [
    { key: 'tts', icon: '🔊', title: 'TTS 음성', note: '대사를 캐릭터마다 다른 목소리로', needs: 'Fish Audio' },
    { key: 'bgm', icon: '🎵', title: 'BGM', note: '장면 분위기에 맞는 음악', needs: '키 없이도 됨' },
    { key: 'sfx', icon: '💥', title: '효과음', note: '§쾅§ 같은 소리 단어에 효과음', needs: '키 없이도 됨' },
  ]],
  ['화면', [
    { key: 'viewer', icon: '📽️', title: '옴니 뷰어', note: '비주얼노벨처럼 · 감정 스탠딩과 배경', needs: 'NovelAI' },
  ]],
];
const FEATURE_NAMES = Object.fromEntries(FEATURE_GROUPS.flatMap(([, rows]) => rows.map(row => [row.key, row.title]))) as Record<QuickFeature, string>;
export const QUICK_PRESETS: ReadonlyArray<[id: string, title: string, features: readonly QuickFeature[]]> = [
  ['draw', '그림만', ['image']],
  ['voice', '그림 + 목소리', ['image', 'tts']],
  ['all', '전부 켜기', ['image', 'comic', 'tts', 'bgm', 'sfx', 'viewer']],
  ['none', '모두 끄기', []],
];
function featuresPane(a: QuickAnswers): string {
  const same = (list: readonly QuickFeature[]) => list.length === a.features.length && list.every(f => a.features.includes(f));
  return `<div class="nx-qs-presets"><span>빠르게</span>${QUICK_PRESETS.map(([id, title, list]) => `<button type="button" data-qs-preset="${id}" ${on(same(list))}>${title}</button>`).join('')}</div>`
    + FEATURE_GROUPS.map(([group, rows]) => `<div class="nx-qs-q"><h4>${group}</h4><div class="nx-qs-feats">${rows.map(row => {
      const active = a.features.includes(row.key);
      return `<button type="button" class="nx-qs-feat" role="switch" aria-checked="${active}" data-qs-feature="${row.key}" ${on(active)}><i>${row.icon}</i><span><b>${row.title}</b><small>${row.note}</small><em>${row.needs}</em></span><u aria-hidden="true"></u></button>`;
    }).join('')}</div></div>`).join('');
}

// ── choices ──
type Choice = [value: string | number | boolean, title: string, note?: string, badge?: string];
/** One question: buttons choosing one value of an answer. `data-qs-choice` names it, `data-value` is the value. */
function ask(key: keyof QuickAnswers, title: string, current: unknown, rows: readonly Choice[], hint = '', columns = 0, after = ''): string {
  return `<div class="nx-qs-q"><h4>${esc(title)}</h4>${hint ? `<p class="nx-qs-hint">${esc(hint)}</p>` : ''}<div class="nx-qs-opts"${columns ? ` style="--nx-qs-cols:${columns}" data-cols="${columns}"` : ''} role="radiogroup" aria-label="${esc(title)}">${rows.map(([value, label, note, badge]) =>
    `<button type="button" role="radio" data-qs-choice="${key}" data-value="${esc(String(value))}" ${on(current === value)} aria-checked="${current === value}"><b>${esc(label)}${badge ? `<mark>${esc(badge)}</mark>` : ''}</b>${note ? `<small>${esc(note)}</small>` : ''}</button>`).join('')}</div>${after}</div>`;
}

function drawPane(v: QuickView): string {
  const a = v.answers, image = a.features.includes('image'), comic = a.features.includes('comic');
  return [
    ask('tagMode', '그림 태그는 누가 쓸까요', a.tagMode, [
      ['stream', '메인 모델이 답장 쓰면서', '그림삽화·아르곤 삽화모듈 같은 방식 · 답장과 함께 나와 빠름 · 추가 키 없음', '추천'],
      ['tagger', '답장 뒤 보조 모델이 따로', '답장이 끝나면 보조 모델이 장면을 골라 태그를 씀 · 답장 글이 깔끔함'],
    ], '', 2),
    ask('images', '한 답장에 몇 장', a.images, [[1, '1장', '핵심 한 장'], [2, '1~2장', '가볍게'], [3, '2~3장', '', '추천'], [4, '3~4장', '장면이 많을 때']], '많을수록 Anlas와 시간이 더 듭니다.', 4),
    image && comic ? ask('comicShare', '그림 중 만화는 얼마나', a.comicShare, [[25, '가끔', '4장 중 1장쯤'], [50, '반반', '대표 장면은 삽화'], [75, '자주', '4장 중 3장쯤'], [100, '전부 만화', '삽화 없이']], '', 4) : '',
    comic ? ask('speech', '만화 말풍선', a.speech, [[true, '대사 넣기', '말풍선에 짧은 대사'], [false, '무대사', '표정과 행동만']], '', 2) : '',
    ask('quality', '퀄리티 향상 프롬프트', a.quality, [
      [true, '켜기', `구도·연속성·인물 태그 규칙 · 성인 묘사 규칙 포함 · 태그 만들 때마다 약 ${v.qualityTokens.toLocaleString('ko-KR')} 토큰 더 씀`],
      [false, '끄기', '기본 프롬프트만'],
    ], '', 2),
  ].filter(Boolean).join('');
}

function soundPane(a: QuickAnswers): string {
  const tts = a.features.includes('tts'), sfx = a.features.includes('sfx'), bgm = a.features.includes('bgm');
  return [
    tts ? ask('ttsAuto', 'TTS · 언제 읽을까요', a.ttsAuto, [[true, '새 답장이 오면 바로', '답장이 끝나면 처음부터 읽음'], [false, '▶를 누를 때만', '원하는 줄만 골라 듣기']], '', 2) : '',
    tts ? ask('narration', 'TTS · 무엇을 읽을까요', a.narration, [[true, '대사 + 나레이션', '지문도 나레이션 목소리로'], [false, '대사만', '따옴표 속 말만']], '', 2) : '',
    sfx ? ask('sfxMatcher', '효과음 · 어떻게 고를까요', a.sfxMatcher, [
      ['auto', '자동', '용어집 → JEV → 임베딩 → 글자 · 있는 것만 씀', '추천'],
      ['embedding-only', '임베딩만', '앞뒤 문단을 보고 장면에 맞는 소리 · 용어집 안 씀 · OpenRouter 키'],
      ['tag', '글자만', '의성어 글자가 같은 소리 · 무료 · 요청 없음'],
    ], '', 3) : '',
    bgm ? `<div class="nx-qs-q"><h4>BGM</h4><p class="nx-qs-note">예제 187곡이 들어 있고, 채팅 모델이 장면이 바뀔 때 분위기 태그를 써서 곡을 바꿉니다. 더 물어볼 것은 없어요.</p></div>` : '',
  ].filter(Boolean).join('');
}

function modelsPane(v: QuickView): string {
  const a = v.answers;
  return [
    ask('helper', '보조 모델 · Omni가 따로 물어볼 때', a.helper, [
      ['aux', 'Risu 보조 모델', 'Risu 설정의 보조 모델 그대로 · 따로 넣을 것 없음', '추천'],
      ['main', 'Risu 메인 모델', '대화에 쓰는 모델 · 똑똑하지만 비쌈'],
      ['custom', '직접 · OpenRouter', 'OpenRouter 키와 모델 이름'],
    ], '캐릭터 등록, 답장 뒤 태그 쓰기, 감정 고르기 같은 일을 맡습니다.', 3,
      a.helper === 'custom' ? `<label class="nx-qs-line"><span>모델 이름</span><input data-qs-text="helperModel" value="${esc(a.helperModel)}" placeholder="${esc(v.helperDefault)} (비우면 이 모델)" autocomplete="off" spellcheck="false"></label>` : ''),
    quickPicks(a)
      ? ask('picker', '목소리·장소·BGM 자동으로 고르기', a.picker, [
        ['jev', 'JEV', '가장 잘 고름 · 고를 때마다 조금 듦 · OpenRouter 키'],
        ['embedding', '임베딩', '빠르고 거의 안 듦 · OpenRouter 키'],
        ['off', '안 씀', '보조 모델과 이름·태그 글자로 짐작 · 키 없음'],
      ], '새 캐릭터의 목소리, 옴니 뷰어 배경, 장면에 맞는 곡을 고르는 방법입니다.', 3)
      : `<div class="nx-qs-q"><h4>목소리·장소·BGM 자동으로 고르기</h4><p class="nx-qs-note">TTS·BGM·효과음·옴니 뷰어를 켜면 여기서 고릅니다.</p></div>`,
  ].join('');
}

// ── keys ──
interface KeyInfo { title: string; start: string; where: string; placeholder: string }
const KEYS: Record<QuickKey, KeyInfo> = {
  naiKey: { title: 'NovelAI', start: 'pst-', where: 'novelai.net › 설정 › Account › Get Persistent API Token', placeholder: 'pst-…' },
  routerKey: { title: 'OpenRouter', start: 'sk-or-', where: 'openrouter.ai › Keys › Create Key', placeholder: 'sk-or-…' },
  fishKey: { title: 'Fish Audio', start: '', where: 'fish.audio › API › API Keys', placeholder: '32자리 키' },
};
/** What a key's card shows now: the markup below and the refresh while typing (quick-setup.ts) both read it. */
export function keyCardState(key: QuickKey, v: QuickView): { state: string; chip: string; status: string; check: string; busy: boolean } {
  const info = KEYS[key], typed = v.answers[key].trim(), saved = v.saved[key], check = v.checks[key], odd = !quickKeyLooksRight(key, typed);
  const needed = quickKeyNeeds(v.answers).some(row => row.key === key && row.needed);
  return {
    state: typed ? 'typed' : saved ? 'saved' : needed ? 'missing' : 'unused',
    chip: typed ? '새로 넣음' : saved ? '저장돼 있음' : needed ? '필요' : '안 씀',
    status: check.state !== 'idle' ? check.text
      : odd ? `형식이 달라 보여요${info.start ? ` · 보통 ${info.start}로 시작합니다` : ' · 보통 영문·숫자 32자리입니다'}. 그대로 넣어도 됩니다.`
      : `발급: ${info.where}`,
    check: odd && check.state === 'idle' ? 'odd' : check.state, busy: check.state === 'busy',
  };
}
/** One key's card: what it is for, whether one is saved, the field with 👁 and 확인, and a line that says what is wrong. */
function keyCard(key: QuickKey, v: QuickView, why: string): string {
  const info = KEYS[key], saved = v.saved[key], { state, chip, status, check, busy } = keyCardState(key, v);
  return `<div class="nx-qs-key" data-qs-keycard="${key}" data-state="${state}"><div class="nx-qs-key-head"><b>${info.title}</b><span class="nx-qs-chip">${chip}</span><small>${esc(why)}</small></div>
<div class="nx-qs-field"><input type="${v.shown[key] ? 'text' : 'password'}" data-qs-key="${key}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${info.title} API 키" placeholder="${saved ? '저장됨 · 바꿀 때만 입력' : `${info.placeholder} 붙여 넣기`}">
<button type="button" class="nx-qs-eye" data-qs="reveal" data-for="${key}" ${on(v.shown[key])} aria-label="키 보기" title="키 보기">👁</button>
<button type="button" data-qs="check" data-for="${key}"${busy ? ' disabled' : ''}>${busy ? '확인 중…' : '확인'}</button></div>
<small class="nx-qs-status" data-qs-status="${key}" data-check="${check}" role="status">${esc(status)}</small></div>`;
}
function keysPane(v: QuickView): string {
  const needs = quickKeyNeeds(v.answers), wanted = needs.filter(row => row.needed), rest = needs.filter(row => !row.needed);
  return (wanted.length ? wanted.map(row => keyCard(row.key, v, row.why)).join('') : '<p class="nx-qs-note">지금 고른 기능은 키가 필요 없어요. 그대로 다음으로 가세요.</p>')
    + (rest.length ? `<details class="nx-qs-more"><summary>지금은 안 쓰는 키 · ${rest.map(row => KEYS[row.key].title).join(', ')}</summary>${rest.map(row => keyCard(row.key, v, '고른 기능에는 쓰이지 않지만 미리 넣어 둘 수 있어요')).join('')}</details>` : '');
}
/** Keys the answers call for that are neither saved nor typed. */
export function missingKeys(v: Pick<QuickView, 'answers' | 'saved'>): string[] {
  return quickKeyNeeds(v.answers).filter(row => row.needed && !v.saved[row.key] && !v.answers[row.key].trim()).map(row => KEYS[row.key].title);
}

// ── review ──
const IMAGES_TEXT: Record<QuickAnswers['images'], string> = { 1: '1장', 2: '1~2장', 3: '2~3장', 4: '3~4장' };
interface ReviewLine { label: string; value: string; changed: boolean }
/** What will be set, in groups; a line whose answer differs from the one the sheet opened with is `changed`. */
export function reviewGroups(a: QuickAnswers, initial: QuickAnswers, helperDefault: string): Array<{ title: string; lines: ReviewLine[] }> {
  const has = (x: QuickAnswers, f: QuickFeature) => x.features.includes(f), onOff = (b: boolean) => b ? '켬' : '끔';
  const line = (label: string, of: (x: QuickAnswers) => string): ReviewLine => ({ label, value: of(a), changed: of(a) !== of(initial) });
  const groups: Array<{ title: string; lines: ReviewLine[] }> = [];
  const draw = [line('삽화', x => onOff(has(x, 'image'))), line('만화', x => onOff(has(x, 'comic')))];
  if (quickDraws(a)) draw.push(
    line('그림 태그', x => x.tagMode === 'stream' ? '메인 모델이 답장 쓰면서 (스트리밍 태그)' : '답장 뒤 보조 모델이 따로'),
    line('한 답장에', x => IMAGES_TEXT[x.images]),
    ...(has(a, 'comic') ? [line('만화 비율', x => `${has(x, 'image') ? x.comicShare : 100}%`), line('말풍선', x => x.speech ? '대사 넣기' : '무대사')] : []),
    line('퀄리티 향상', x => onOff(x.quality)));
  groups.push({ title: '그림', lines: draw });
  const sound = [line('TTS 음성', x => onOff(has(x, 'tts'))), line('BGM', x => onOff(has(x, 'bgm'))), line('효과음', x => onOff(has(x, 'sfx')))];
  if (has(a, 'tts')) sound.push(line('TTS 읽기', x => `${x.ttsAuto ? '새 답장이 오면 바로' : '▶를 누를 때만'} · ${x.narration ? '대사 + 나레이션' : '대사만'}`));
  if (has(a, 'sfx')) sound.push(line('효과음 고르기', x => x.sfxMatcher === 'auto' ? '자동' : x.sfxMatcher === 'embedding-only' ? '임베딩만' : '글자만'));
  groups.push({ title: '소리', lines: sound });
  groups.push({ title: '화면', lines: [line('옴니 뷰어', x => onOff(has(x, 'viewer')))] });
  const models = [line('보조 모델', x => x.helper === 'aux' ? 'Risu 보조 모델' : x.helper === 'main' ? 'Risu 메인 모델' : `OpenRouter · ${x.helperModel.trim() || helperDefault}`)];
  if (quickPicks(a)) models.push(line('자동 고르기', x => x.picker === 'jev' ? 'JEV' : x.picker === 'embedding' ? '임베딩' : '안 씀 (보조 모델·글자)'));
  groups.push({ title: '모델', lines: models });
  const keys = (['naiKey', 'routerKey', 'fishKey'] as const).filter(k => a[k].trim()).map(k => ({ label: KEYS[k].title, value: '새 키로 바꿈', changed: true }));
  if (keys.length) groups.push({ title: 'API 키', lines: keys });
  return groups;
}
function reviewPane(v: QuickView, done: boolean): string {
  const groups = reviewGroups(v.answers, v.initial, v.helperDefault), missing = missingKeys(v), changes = groups.reduce((n, g) => n + g.lines.filter(l => l.changed).length, 0);
  return (missing.length ? `<p class="nx-qs-warn" role="alert">${missing.join(', ')} 키가 없습니다. 적용은 되지만 키를 넣기 전에는 그 기능이 동작하지 않아요. <button type="button" data-qs-step="keys">키 넣으러 가기</button></p>` : '')
    + (done ? '' : `<p class="nx-qs-count">${changes ? `바뀌는 항목 ${changes}개` : '지금 설정과 같습니다'}</p>`)
    + `<div class="nx-qs-review">${groups.map(g => `<section><h4>${g.title}</h4><dl>${g.lines.map(l => `<div${l.changed && !done ? ' data-changed="1"' : ''}><dt>${esc(l.label)}</dt><dd>${esc(l.value)}${l.changed && !done ? '<mark>변경</mark>' : ''}</dd></div>`).join('')}</dl></section>`).join('')}</div>`;
}

// ── frame ──
/** What a step holds so far, under its name in the rail. */
function railNote(step: QuickStep, v: QuickView): string {
  const a = v.answers;
  if (quickStepSkipped(step, a)) return '해당 없음';
  if (step === 'features') return a.features.length ? a.features.map(f => FEATURE_NAMES[f]).join(' · ') : '고른 것 없음';
  if (step === 'draw') return `${IMAGES_TEXT[a.images]} · ${a.tagMode === 'stream' ? '답장과 함께' : '답장 뒤'}`;
  if (step === 'sound') return [a.features.includes('tts') && (a.ttsAuto ? '자동 읽기' : '눌러 듣기'), a.features.includes('sfx') && (a.sfxMatcher === 'auto' ? '효과음 자동' : a.sfxMatcher === 'embedding-only' ? '효과음 임베딩만' : '효과음 글자만'), a.features.includes('bgm') && 'BGM'].filter(Boolean).join(' · ');
  if (step === 'models') return `${a.helper === 'aux' ? 'Risu 보조' : a.helper === 'main' ? 'Risu 메인' : 'OpenRouter'}${quickPicks(a) ? ` · ${a.picker === 'jev' ? 'JEV' : a.picker === 'embedding' ? '임베딩' : '고르기 안 씀'}` : ''}`;
  if (step === 'keys') { const missing = missingKeys(v), wanted = quickKeyNeeds(a).filter(row => row.needed).length; return !wanted ? '필요 없음' : missing.length ? `${missing.length}개 없음` : '모두 준비됨'; }
  return '';
}
export function paneBody(v: QuickView): string {
  const body = v.step === 'features' ? featuresPane(v.answers) : v.step === 'draw' ? drawPane(v) : v.step === 'sound' ? soundPane(v.answers)
    : v.step === 'models' ? modelsPane(v) : v.step === 'keys' ? keysPane(v) : reviewPane(v, v.step === 'done');
  return `<h3 class="nx-qs-title">${v.step === 'done' ? '✓ 완료' : STEP_TITLES[v.step]}</h3><p class="nx-qs-lead">${STEP_LEADS[v.step]}</p>${body}`;
}
/** The steps that ask something, in order. */
export const activeSteps = (a: QuickAnswers): QuickStep[] => QUICK_STEPS.filter(step => !quickStepSkipped(step, a));
/** The rail's steps: on its own, so typing a key refreshes it without touching the pane being typed in. */
export function railHtml(v: QuickView): string {
  const steps = activeSteps(v.answers), done = v.step === 'done', at = done ? steps.length : steps.indexOf(v.step as QuickStep);
  return QUICK_STEPS.map(step => {
    const skipped = quickStepSkipped(step, v.answers), index = steps.indexOf(step), state = skipped ? 'skip' : done || index < at ? 'past' : index === at ? 'now' : 'next';
    const warn = step === 'keys' && !skipped && missingKeys(v).length > 0;
    return `<button type="button" class="nx-qs-step" data-qs-step="${step}" data-state="${state}"${warn ? ' data-warn="1"' : ''}${skipped || done ? ' disabled' : ''}${state === 'now' ? ' aria-current="step"' : ''}><i>${skipped ? '–' : state === 'past' ? '✓' : index + 1}</i><span><b>${STEP_TITLES[step]}</b><small>${esc(railNote(step, v))}</small></span></button>`;
  }).join('');
}
export function sheetHtml(v: QuickView): string {
  const steps = activeSteps(v.answers), done = v.step === 'done', at = done ? steps.length : steps.indexOf(v.step as QuickStep), last = v.step === 'review', rail = railHtml(v);
  return `<div class="nx-qs-card"><header class="nx-qs-head"><b id="nx-qs-title">⚡ 빠른 설정</b><span class="nx-qs-sub">몇 가지만 고르면 나머지는 맞춰 드려요</span><button type="button" class="nx-qs-close" data-qs="close" aria-label="닫기">✕</button></header>
<div class="nx-qs-main"><nav class="nx-qs-rail" aria-label="단계">${rail}</nav><div class="nx-qs-body" tabindex="-1">${paneBody(v)}</div></div>
<footer class="nx-qs-foot">${done ? '<span class="nx-qs-steps">완료</span><button type="button" class="primary" data-qs="close">닫기</button>'
    : `${at > 0 ? '<button type="button" data-qs="back">이전</button>' : '<button type="button" data-qs="close">나중에</button>'}<span class="nx-qs-steps">${at + 1} / ${steps.length} · ${STEP_TITLES[v.step]}</span><button type="button" class="primary" data-qs="${last ? 'apply' : 'next'}">${last ? '적용' : '다음'}</button>`}</footer></div>`;
}

export const QUICK_SETUP_CSS = `
.nx-qs{position:fixed;inset:0;z-index:100500;display:flex;align-items:center;justify-content:center;background:rgba(4,8,16,.66);backdrop-filter:blur(3px);font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#e8eaf2;--qs-line:#283046;--qs-soft:#9aa3b5;--qs-accent:#8b5cf6;--qs-panel:#161c2a}
.nx-qs *{box-sizing:border-box}
/* One size from the first step to the last: the body scrolls, the window never grows or shrinks. */
.nx-qs-card{width:min(920px,94vw);height:min(660px,92vh);display:flex;flex-direction:column;border:1px solid var(--qs-line);border-radius:16px;background:#10141e;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden}
.nx-qs-head{flex:none;display:flex;align-items:center;gap:10px;height:54px;padding:0 10px 0 18px;border-bottom:1px solid var(--qs-line)}
.nx-qs-head b{font-size:16px;white-space:nowrap}.nx-qs-sub{color:var(--qs-soft);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nx-qs-close{margin-left:auto;width:38px;height:38px;flex:none}
.nx-qs-main{flex:1;min-height:0;display:flex}
.nx-qs-rail{flex:none;width:214px;display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid var(--qs-line);background:#0d111a;overflow:auto}
.nx-qs-body{flex:1;min-width:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding:18px 20px 22px;display:flex;flex-direction:column;gap:16px;outline:0}
.nx-qs-foot{flex:none;display:flex;align-items:center;gap:10px;height:66px;padding:0 16px;padding-bottom:env(safe-area-inset-bottom);border-top:1px solid var(--qs-line)}
.nx-qs-foot button{min-height:42px;min-width:108px;padding:0 18px}.nx-qs-steps{flex:1;text-align:center;color:var(--qs-soft);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nx-qs button{border:1px solid var(--qs-line);border-radius:10px;background:#1a2132;color:inherit;font:inherit;cursor:pointer}
.nx-qs button:hover:not(:disabled){border-color:#3a4563}
.nx-qs button:focus-visible,.nx-qs input:focus-visible,.nx-qs summary:focus-visible{outline:2px solid var(--qs-accent);outline-offset:1px}
.nx-qs button:disabled{cursor:default;opacity:.55}
.nx-qs button.primary{background:#7132f5;border-color:#7132f5;color:#fff;font-weight:700}
.nx-qs small{color:var(--qs-soft);font-size:12px}
/* rail */
.nx-qs-step{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:6px 8px;text-align:left;border-color:transparent!important;background:none!important}
.nx-qs-step i{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--qs-line);font-style:normal;font-size:12px;color:var(--qs-soft)}
.nx-qs-step span{min-width:0;display:flex;flex-direction:column}.nx-qs-step b{font-size:13px;font-weight:600}
.nx-qs-step small{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nx-qs-step:hover:not(:disabled){background:#161c2a!important}
.nx-qs-step[data-state="now"]{background:#1b2236!important}.nx-qs-step[data-state="now"] i{background:#7132f5;border-color:#7132f5;color:#fff}
.nx-qs-step[data-state="past"] i{border-color:#3f8f63;color:#7fe0a8}
.nx-qs-step[data-state="skip"]{opacity:.45}.nx-qs-step:disabled{opacity:1}.nx-qs-step[data-state="skip"]:disabled{opacity:.45}
.nx-qs-step[data-warn] small{color:#f2b866}
/* pane */
.nx-qs-title{margin:0;font-size:18px}.nx-qs-lead{margin:-10px 0 0;color:#b9bfd1}
.nx-qs-q{display:flex;flex-direction:column;gap:8px}.nx-qs h4{margin:0;font-size:13px;color:#cfd3e4}
.nx-qs-hint,.nx-qs-note{margin:-4px 0 0;color:var(--qs-soft);font-size:12px}.nx-qs-note{margin:0;padding:12px;border:1px dashed var(--qs-line);border-radius:10px;font-size:13px}
.nx-qs-presets{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.nx-qs-presets span{color:var(--qs-soft);font-size:12px;margin-right:2px}
.nx-qs-presets button{min-height:34px;padding:0 12px;border-radius:999px;font-size:13px}
.nx-qs-feats{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
.nx-qs-feat{display:flex;align-items:center;gap:12px;min-height:74px;padding:10px 12px;text-align:left}
.nx-qs-feat i{flex:none;font-style:normal;font-size:24px;width:30px;text-align:center}
.nx-qs-feat span{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}.nx-qs-feat em{font-style:normal;font-size:11px;color:#8e97ad}
.nx-qs-feat u{flex:none;position:relative;width:38px;height:22px;border-radius:999px;background:#2a3247;transition:background .12s}
.nx-qs-feat u::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#aab1c4;transition:transform .12s,background .12s}
.nx-qs-feat[aria-pressed="true"] u{background:#7132f5}.nx-qs-feat[aria-pressed="true"] u::after{transform:translateX(16px);background:#fff}
.nx-qs-opts{display:grid;grid-template-columns:repeat(var(--nx-qs-cols,3),minmax(0,1fr));gap:8px}
.nx-qs-opts button{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:3px;min-height:60px;padding:10px 12px;text-align:left}
.nx-qs-opts b{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.nx-qs mark{padding:1px 6px;border-radius:999px;background:#7132f533;color:#c9b5ff;font-size:11px;font-weight:600}
.nx-qs [aria-pressed="true"]:not(.nx-qs-eye){border-color:var(--qs-accent);background:#7132f526}
.nx-qs-line{display:flex;align-items:center;gap:10px;margin-top:2px}.nx-qs-line span{flex:none;color:var(--qs-soft);font-size:12px}
.nx-qs input{min-width:0;min-height:44px;padding:0 12px;border:1px solid var(--qs-line);border-radius:10px;background:#0b0f17;color:inherit;font:inherit}
.nx-qs-line input{flex:1}
/* keys */
.nx-qs-key{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--qs-line);border-radius:12px;background:var(--qs-panel)}
.nx-qs-key-head{display:flex;align-items:center;gap:8px;min-width:0}.nx-qs-key-head small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nx-qs-chip{flex:none;padding:1px 8px;border-radius:999px;border:1px solid var(--qs-line);font-size:11px;color:var(--qs-soft)}
.nx-qs-key[data-state="saved"] .nx-qs-chip{border-color:#3f8f63;color:#7fe0a8}.nx-qs-key[data-state="typed"] .nx-qs-chip{border-color:var(--qs-accent);color:#c9b5ff}
.nx-qs-key[data-state="missing"]{border-color:#7a5a2a}.nx-qs-key[data-state="missing"] .nx-qs-chip{border-color:#b8863a;color:#f2b866}
.nx-qs-field{display:flex;gap:6px}.nx-qs-field input{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.nx-qs-field button{flex:none;min-width:44px;min-height:44px;padding:0 12px}.nx-qs-eye[aria-pressed="true"]{border-color:var(--qs-accent)}
.nx-qs-status{min-height:18px;overflow-wrap:anywhere}.nx-qs-status[data-check="ok"]{color:#7fe0a8}.nx-qs-status[data-check="bad"]{color:#ff8f8f}.nx-qs-status[data-check="odd"]{color:#f2b866}
.nx-qs-more{border:1px dashed var(--qs-line);border-radius:12px;padding:0 12px}.nx-qs-more summary{min-height:44px;display:flex;align-items:center;cursor:pointer;color:var(--qs-soft);font-size:13px}
.nx-qs-more[open]{padding-bottom:12px;display:flex;flex-direction:column;gap:8px}
/* review */
.nx-qs-warn{margin:0;padding:10px 12px;border:1px solid #7a5a2a;border-radius:10px;background:#2a2114;color:#f2d19a;font-size:13px}
.nx-qs-warn button{margin-left:6px;min-height:30px;padding:0 10px;font-size:12px}
.nx-qs-count{margin:0;color:var(--qs-soft);font-size:12px}
.nx-qs-review{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.nx-qs-review section{padding:12px;border:1px solid var(--qs-line);border-radius:12px;background:var(--qs-panel)}
.nx-qs-review dl{margin:8px 0 0;display:grid;gap:6px}.nx-qs-review dl div{display:flex;gap:10px;font-size:13px}
.nx-qs-review dt{flex:none;width:96px;color:var(--qs-soft)}.nx-qs-review dd{margin:0;min-width:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.nx-qs-review [data-changed] dd{color:#fff;font-weight:600}
/* A phone: the whole screen; the rail is a strip of steps along the top, as tall whatever the step. */
@media (max-width:700px){
  .nx-qs{align-items:stretch}.nx-qs-card{width:100vw;height:100%;border:0;border-radius:0}
  .nx-qs-sub{display:none}.nx-qs-main{flex-direction:column}
  .nx-qs-rail{width:auto;height:50px;flex-direction:row;gap:4px;padding:6px 8px;border-right:0;border-bottom:1px solid var(--qs-line);overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
  .nx-qs-rail::-webkit-scrollbar{display:none}
  .nx-qs-step{width:auto;flex:none;min-height:38px;padding:4px 10px 4px 6px;gap:6px}.nx-qs-step small{display:none}.nx-qs-step i{width:24px;height:24px}
  .nx-qs-body{padding:14px 14px 18px;scrollbar-gutter:auto}
  .nx-qs-opts{grid-template-columns:1fr}.nx-qs-opts[data-cols="4"]{grid-template-columns:1fr 1fr}.nx-qs-opts button{min-height:54px}.nx-qs-feats{grid-template-columns:1fr}
  .nx-qs-foot{height:auto;min-height:66px;padding-top:10px;padding-bottom:calc(10px + env(safe-area-inset-bottom))}.nx-qs-foot button{min-width:92px;min-height:46px}
  .nx-qs-review dt{width:84px}
}
@media (prefers-reduced-motion:reduce){.nx-qs-feat u,.nx-qs-feat u::after{transition:none}}
`;
