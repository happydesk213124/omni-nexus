import type { QuickAnswers, QuickFeature } from '../domain/quick-setup';

/**
 * ⚡ 빠른 설정's look: one card over the settings, full screen on a phone. Each step is markup built from the
 * answers so far; the sheet (quick-setup.ts) listens on its root and paints the step again on every choice.
 */
export type QuickStep = 'features' | 'connect' | 'draw' | 'review' | 'done';
export const STEP_TITLES: Record<QuickStep, string> = { features: '무엇을 쓸까요', connect: '연결', draw: '그림', review: '확인', done: '완료' };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pressed = (on: boolean) => `aria-pressed="${on}"`;

const FEATURES: ReadonlyArray<[QuickFeature, string, string, string]> = [
  ['image', '🖼️', '삽화', '답장 장면을 NovelAI 그림으로'],
  ['comic', '📖', '만화', '대화와 연속 동작을 컷 만화로'],
  ['tts', '🔊', 'TTS 음성', '대사를 캐릭터 목소리로 (Fish Audio)'],
  ['sound', '🎵', 'BGM·효과음', '장면에 맞는 음악과 효과음'],
  ['viewer', '📽️', '옴니 뷰어', '비주얼노벨처럼 · 스탠딩과 배경'],
];
/** Buttons choosing one value of an answer: `data-qs-choice` names it, `data-value` is the value (a number when it reads as one). */
function choices(key: keyof QuickAnswers, current: unknown, rows: ReadonlyArray<[value: string | number | boolean, title: string, note?: string]>): string {
  return `<div class="nx-qs-choices" role="radiogroup">${rows.map(([value, title, note]) => `<button type="button" role="radio" data-qs-choice="${key}" data-value="${esc(String(value))}" ${pressed(current === value)} aria-checked="${current === value}"><b>${esc(title)}</b>${note ? `<small>${esc(note)}</small>` : ''}</button>`).join('')}</div>`;
}
const keyField = (key: 'naiKey' | 'fishKey' | 'routerKey', label: string, saved: boolean, extra = '') => `<div class="nx-qs-block"><h4>${esc(label)}</h4><div class="nx-qs-field"><input type="password" autocomplete="off" data-qs-key="${key}" placeholder="${saved ? '저장돼 있음 · 바꿀 때만 넣기' : '여기에 붙여 넣기'}">${extra}</div><small data-qs-status="${key}"></small></div>`;

export interface QuickView { answers: QuickAnswers; saved: { nai: boolean; fish: boolean; router: boolean }; qualityTokens: number; summary: string[] }

export function stepBody(step: QuickStep, v: QuickView): string {
  const a = v.answers, has = (f: QuickFeature) => a.features.includes(f), draws = has('image') || has('comic');
  if (step === 'features') return `<p class="nx-qs-lead">쓰고 싶은 걸 고르세요. 여러 개 골라도 되고, 고르지 않은 건 꺼 둡니다. 나머지는 기본값으로 맞추고, 나중에 설정에서 언제든 바꿀 수 있어요.</p>
<div class="nx-qs-cards">${FEATURES.map(([key, icon, title, note]) => `<button type="button" data-qs-feature="${key}" ${pressed(has(key))}><i>${icon}</i><b>${title}</b><small>${note}</small></button>`).join('')}</div>`;
  if (step === 'connect') return [
    draws || has('viewer') ? keyField('naiKey', 'NovelAI API 키', v.saved.nai, '<button type="button" data-qs="check-nai">확인</button>') : '',
    draws ? `<div class="nx-qs-block"><h4>그림 태그는 누가 쓸까요</h4>${choices('tagMode', a.tagMode, [
      ['stream', '메인 모델이 답장 쓰면서', '그림삽화·아르곤 삽화모듈 같은 방식 · 추가 키 없음 · 추천'],
      ['tagger', '답장 뒤 보조 모델이 따로', '답장이 끝나면 보조 모델이 장면을 골라 태그를 씀'],
    ])}</div>` : '',
    `<div class="nx-qs-block"><h4>보조 모델 · Omni가 따로 물어볼 때</h4>${choices('helper', a.helper, [
      ['aux', 'Risu 보조 모델', 'Risu 설정의 보조 모델 그대로'],
      ['main', 'Risu 메인 모델', '대화에 쓰는 모델'],
      ['custom', '직접 · OpenRouter', 'OpenRouter 키와 모델'],
    ])}${a.helper === 'custom' ? `<div class="nx-qs-field"><input data-qs-key="helperModel" value="${esc(a.helperModel)}" placeholder="모델 이름 (비우면 기본)"></div>` : ''}</div>`,
    has('tts') || has('sound') || has('viewer') ? `<div class="nx-qs-block"><h4>목소리·장소·BGM 자동으로 고르기</h4>${choices('picker', a.picker, [
      ['jev', 'JEV', '가장 잘 고름 · 쓸 때마다 조금 듦'],
      ['embedding', '임베딩', '빠르고 거의 안 듦'],
      ['off', '안 씀', '보조 모델과 이름으로 짐작'],
    ])}</div>` : '',
    a.helper === 'custom' || ((has('tts') || has('sound') || has('viewer')) && a.picker !== 'off')
      ? keyField('routerKey', 'OpenRouter API 키 · 보조 모델·JEV·임베딩 함께', v.saved.router) : '',
    has('tts') ? keyField('fishKey', 'Fish Audio API 키', v.saved.fish) : '',
  ].filter(Boolean).join('');
  if (step === 'draw') return [
    `<div class="nx-qs-block"><h4>한 답장에 몇 장</h4>${choices('images', a.images, [[1, '1장', '핵심 한 장'], [2, '2~3장', '추천'], [3, '3~4장', '장면이 많을 때']])}</div>`,
    has('image') && has('comic') ? `<div class="nx-qs-block"><h4>삽화와 만화</h4>${choices('comicShare', a.comicShare, [[50, '섞기', '대표 장면은 삽화, 연속 동작은 만화'], [100, '만화만', '모든 그림을 만화로']])}</div>` : '',
    has('comic') ? `<div class="nx-qs-block"><h4>만화 말풍선</h4>${choices('speech', a.speech, [[true, '대사 넣기', '말풍선에 짧은 대사'], [false, '무대사', '표정과 행동만']])}</div>` : '',
    `<div class="nx-qs-block"><h4>퀄리티 향상 프롬프트</h4>${choices('quality', a.quality, [
      [true, '켜기', '구도·연속성·인물 태그 규칙 · 성인 묘사 규칙 포함 · 태그 만들 때마다 약 ' + v.qualityTokens.toLocaleString('ko-KR') + ' 토큰 더 씀'],
      [false, '끄기', '기본 프롬프트만'],
    ])}</div>`,
  ].filter(Boolean).join('');
  if (step === 'review') return `<p class="nx-qs-lead">이렇게 맞출게요. 적용을 누르면 바로 저장됩니다.</p><ul class="nx-qs-review">${v.summary.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`;
  return `<p class="nx-qs-lead">설정했어요. 세부 설정은 왼쪽 메뉴에서 언제든 바꿀 수 있고, 이 도우미는 위의 ⚡ 빠른 설정으로 다시 열 수 있어요.</p><ul class="nx-qs-review">${v.summary.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`;
}

export function sheetHtml(step: QuickStep, steps: readonly QuickStep[], v: QuickView): string {
  const at = steps.indexOf(step), last = step === 'review', done = step === 'done';
  return `<div class="nx-qs-card"><header class="nx-qs-head"><b id="nx-qs-title">⚡ 빠른 설정</b><span class="nx-qs-steps">${done ? '완료' : `${at + 1} / ${steps.length - 1} · ${STEP_TITLES[step]}`}</span><button type="button" class="nx-qs-close" data-qs="close" aria-label="닫기">✕</button></header>
<div class="nx-qs-body">${stepBody(step, v)}</div>
<footer class="nx-qs-foot">${done ? '<button type="button" class="primary" data-qs="close">닫기</button>' : `${at > 0 ? '<button type="button" data-qs="back">이전</button>' : '<button type="button" data-qs="close">나중에</button>'}<button type="button" class="primary" data-qs="${last ? 'apply' : 'next'}">${last ? '적용' : '다음'}</button>`}</footer></div>`;
}

export const QUICK_SETUP_CSS = `
.nx-qs{position:fixed;inset:0;z-index:100500;display:flex;align-items:center;justify-content:center;background:rgba(4,8,16,.62);backdrop-filter:blur(3px);font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#e8eaf2}
.nx-qs-card{width:min(640px,94vw);max-height:min(880px,92vh);display:flex;flex-direction:column;border:1px solid #2c3346;border-radius:16px;background:#121722;box-shadow:0 24px 60px rgba(0,0,0,.5)}
@media (max-width:640px){.nx-qs{align-items:stretch}.nx-qs-card{width:100vw;max-height:none;height:100%;border:0;border-radius:0}}
.nx-qs-head{display:flex;align-items:center;gap:10px;padding:12px 14px 12px 16px;border-bottom:1px solid #232a3b}
.nx-qs-head b{font-size:16px}.nx-qs-steps{margin-left:auto;color:#9aa3b5;font-size:12px}
.nx-qs-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:18px}
.nx-qs-foot{display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #232a3b}
.nx-qs-foot button{min-height:46px;flex:1}
.nx-qs button{border:1px solid #2c3346;border-radius:10px;background:#1a2030;color:inherit;font:inherit;cursor:pointer}
.nx-qs button.primary{background:#7132f5;border-color:#7132f5;color:#fff;font-weight:700}
.nx-qs-close{width:38px;height:38px;flex:none}
.nx-qs-lead{margin:0;color:#c9cbe0}
.nx-qs-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.nx-qs-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.nx-qs-cards button,.nx-qs-choices button{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:12px;text-align:left;min-height:64px}
.nx-qs-cards i{font-style:normal;font-size:22px}
.nx-qs [aria-pressed="true"]{border-color:#7132f5;background:#7132f533}
.nx-qs small{color:#9aa3b5;font-size:12px}
.nx-qs-block{display:flex;flex-direction:column;gap:8px}
.nx-qs h4{margin:0;font-size:13px;color:#c9cbe0}
.nx-qs-field{display:flex;gap:6px}
.nx-qs-field input{flex:1;min-width:0;min-height:44px;padding:0 12px;border:1px solid #2c3346;border-radius:10px;background:#0d111a;color:inherit;font:inherit}
.nx-qs-field button{padding:0 14px}
.nx-qs-review{margin:0;padding-left:18px;display:grid;gap:6px}
`;
