/**
 * 옴니 뷰어's look: the frame, its static style, and the two things a scene
 * rewrites (one style text, one box). Pure strings, so a scene costs Risu two
 * calls whatever happens on stage.
 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One stable hue per name, for its nameplate and silhouette. */
export function accentOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h} 62% 60%)`;
}

const SERIF = '"Gowun Batang","Nanum Myeongjo","Noto Serif KR","Noto Serif CJK KR",serif';
export const STATIC_CSS = `
[x-omni-vn]{position:fixed;z-index:2147482000;isolation:isolate;overflow:hidden;color:#f4f1ea;font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation;
  background:radial-gradient(120% 90% at 50% 0%,#2a2340 0%,#141224 45%,#07070c 100%);--gold:#e3c27a;--line:rgba(227,194,122,.38)}
[x-omni-vn] *{box-sizing:border-box}
[x-omni-vn] [data-vn-bg]{position:absolute;inset:0}
[x-omni-vn] [data-vn-bg]::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 100% at 50% 40%,transparent 50%,rgba(0,0,0,.55) 100%),linear-gradient(transparent 55%,rgba(5,5,10,.55))}
[x-omni-vn] div[x-vn-bg]{display:none;position:absolute;inset:0;animation:vn-fade .6s ease}
[x-omni-vn] div[x-vn-bg] img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.72) saturate(1.05)}
[x-omni-vn] img[x-vn-bg]{display:none;position:absolute;inset:0;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important;object-fit:cover;filter:brightness(.7) saturate(1.05)}
[x-omni-vn] [data-vn-cast]{position:absolute;inset:0;pointer-events:none}
[x-omni-vn] [x-vn-p]{display:none;position:absolute;bottom:0;height:90%;aspect-ratio:13/19;max-width:82%;translate:-50% 0;transform-origin:50% 100%;
  transition:left .45s cubic-bezier(.2,.8,.25,1),filter .3s ease,transform .3s ease,opacity .3s ease;animation:vn-enter .55s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [x-vn-p] [data-vn-sil]{position:absolute;inset:0;transition:opacity .3s}
[x-omni-vn] [x-vn-p] [data-vn-sil]::before{content:"";position:absolute;left:31%;right:31%;top:6%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 45% 40%,var(--c) 0%,rgba(20,18,32,.95) 70%);opacity:.55;box-shadow:0 0 22px -6px var(--c)}
[x-omni-vn] [x-vn-p] [data-vn-sil]::after{content:"";position:absolute;left:12%;right:12%;top:31%;bottom:0;border-radius:46% 46% 8% 8%/30% 30% 8% 8%;background:linear-gradient(180deg,var(--c) -60%,rgba(18,16,30,.96) 55%);opacity:.5;box-shadow:0 -6px 26px -12px var(--c)}
[x-omni-vn] [x-vn-sp]{position:absolute;inset:0;opacity:0;transition:opacity .28s ease}
[x-omni-vn] [x-vn-sp] img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%;filter:drop-shadow(0 6px 18px rgba(0,0,0,.45))}
[x-omni-vn] [data-vn-cg]{position:absolute;inset:0;pointer-events:none}
[x-omni-vn] img[x-vn-cg]{display:none;position:absolute;left:50%;top:9%;width:84%!important;height:auto!important;max-width:none!important;max-height:52%!important;object-fit:contain;translate:-50% 0;rotate:-1.2deg;margin:0!important;border:4px solid #f3efe6!important;border-radius:4px!important;box-shadow:0 18px 50px rgba(0,0,0,.6);animation:vn-photo .6s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-hud]{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:6px;padding:10px 10px 18px;background:linear-gradient(rgba(5,5,10,.7),transparent);z-index:4}
[x-omni-vn] [data-vn-clock]{flex:1;min-width:0;display:flex;align-items:center;gap:6px;font-size:12px;letter-spacing:.02em;color:#ece6d6}
[x-omni-vn] [data-vn-clock]:not(:empty)::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 8px var(--gold)}
[x-omni-vn] [data-vn-clock] span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[x-omni-vn] button{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:32px;padding:0 10px;border-radius:999px;font-size:12px;letter-spacing:.04em;color:#efe9da;background:rgba(14,12,22,.55);border:1px solid rgba(255,255,255,.14)}
[x-omni-vn] [data-vn-box]{position:absolute;left:12px;right:12px;bottom:12px;height:clamp(136px,26%,200px);padding:22px 18px 44px;border-radius:16px;z-index:3;
  background:linear-gradient(180deg,rgba(22,19,34,.88),rgba(10,9,17,.95));border:1px solid var(--line);box-shadow:0 10px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06);transition:opacity .25s}
[x-omni-vn] [data-vn-box]::before{content:"";position:absolute;left:14px;right:14px;top:8px;height:1px;background:linear-gradient(90deg,transparent,var(--line),transparent)}
[x-omni-vn] [data-vn-name]{position:absolute;left:16px;top:-15px;max-width:70%;padding:4px 16px 5px;border-radius:10px 10px 10px 2px;font:700 15px/1.3 ${SERIF};color:#fff;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  background:linear-gradient(135deg,var(--c,#7c5cf5),color-mix(in srgb,var(--c,#7c5cf5) 55%,#100c1c));box-shadow:0 4px 14px -4px var(--c,#7c5cf5)}
[x-omni-vn] [data-vn-name]:empty{display:none}
[x-omni-vn] [data-vn-text]{height:100%;overflow:auto;font:16.5px/1.78 ${SERIF};word-break:keep-all;overflow-wrap:anywhere;white-space:pre-wrap;scrollbar-width:none}
[x-omni-vn] [data-vn-text][data-narr]{color:#cfc8dc;font-style:italic}
[x-omni-vn] [data-vn-text] span{opacity:0;animation:vn-ch .12s ease forwards}
[x-omni-vn] [data-vn-next]{position:absolute;right:18px;bottom:52px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--gold);opacity:0;animation:vn-next 1s ease-in-out infinite}
[x-omni-vn] [data-vn-menu]{position:absolute;left:12px;right:12px;bottom:18px;display:flex;justify-content:flex-end;gap:4px;z-index:4}
[x-omni-vn] [data-vn-menu] button{height:28px;min-width:30px;padding:0 9px;font-size:11px;background:transparent;border-color:transparent;color:#d8cfb4}
[x-omni-vn] [data-vn-menu] [data-vn-act="next"],[x-omni-vn] [data-vn-menu] [data-vn-act="prev"]{color:var(--gold);font-size:13px}
[x-omni-vn] [data-vn-count]{position:absolute;left:22px;bottom:24px;font-size:10px;letter-spacing:.08em;color:#9c93ad;z-index:4}
[x-omni-vn] [data-vn-act="strip"]{position:absolute;right:0;top:38%;z-index:4;height:auto;min-width:0;padding:12px 7px;border-radius:12px 0 0 12px;writing-mode:vertical-rl;letter-spacing:.2em;font-size:11px;color:var(--gold);background:rgba(10,9,17,.72);border:1px solid var(--line);border-right:0}
[x-omni-vn] [data-vn-strip]{position:absolute;top:56px;right:0;width:min(42%,210px);max-height:calc(100% - 56px - clamp(136px,26%,200px) - 24px);overflow:hidden;padding:10px;z-index:5;display:flex;flex-direction:column;gap:8px;
  background:rgba(10,9,17,.94);border:1px solid var(--line);border-right:0;border-radius:14px 0 0 14px;translate:105% 0;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-strip] [x-vn-thumb]{flex:none;display:block;width:100%!important;height:auto!important;max-width:none!important;max-height:none!important;aspect-ratio:3/2;object-fit:cover;margin:0!important;border-radius:8px!important;border:1px solid rgba(255,255,255,.18)!important}
[x-omni-vn] [data-vn-strip] div[x-vn-thumb]{display:flex;align-items:center;justify-content:center;font-size:11px;color:#bdb4cf;background:rgba(255,255,255,.05)}
[x-omni-vn] [data-vn-log]{display:none;position:absolute;inset:56px 12px 12px;overflow:auto;padding:16px 16px 24px;border-radius:16px;z-index:5;background:rgba(10,9,17,.96);border:1px solid var(--line);font:14px/1.7 ${SERIF}}
[x-omni-vn] [data-vn-log] p{margin:0 0 10px}
[x-omni-vn] [data-vn-log] b{color:var(--gold);margin-right:6px}
[x-omni-vn] [data-vn-log] [data-now]{color:#fff;border-left:2px solid var(--gold);padding-left:8px}
@keyframes vn-enter{from{opacity:0;translate:-50% 7%}to{opacity:1;translate:-50% 0}}
@keyframes vn-photo{from{opacity:0;translate:-30% 4%;rotate:3deg}to{opacity:1;translate:-50% 0;rotate:-1.2deg}}
@keyframes vn-ch{to{opacity:1}}
@keyframes vn-fade{from{opacity:0}to{opacity:1}}
@keyframes vn-next{0%,100%{opacity:.25;translate:0 0}50%{opacity:1;translate:0 3px}}
@media (min-width:700px){[x-omni-vn] [data-vn-box]{left:50%;right:auto;width:min(980px,92%);height:clamp(150px,24%,200px);translate:-50% 0}[x-omni-vn] [data-vn-menu]{left:auto;right:calc(50% - min(490px,46%) + 8px)}[x-omni-vn] [x-vn-p]{height:94%;max-width:40%}}
`;

export const FRAME = `<div data-vn-bg></div><div data-vn-cast></div><div data-vn-cg></div>
<div data-vn-hud><div data-vn-clock></div><button data-vn-act="log" type="button">기록</button><button data-vn-act="chat" type="button">채팅</button><button data-vn-act="close" type="button" aria-label="닫기">✕</button></div>
<div data-vn-box></div><div data-vn-log></div><button data-vn-act="strip" type="button">삽화</button><div data-vn-strip></div>
<div data-vn-menu><button data-vn-act="older" type="button">이전 답장</button><button data-vn-act="newest" type="button">최신</button><button data-vn-act="voice" type="button">VOICE</button><button data-vn-act="auto" type="button">AUTO</button><button data-vn-act="prev" type="button" aria-label="이전">◀</button><button data-vn-act="next" type="button" aria-label="다음">▶</button></div>`;

/** A person's place on stage: a silhouette until their picture comes. */
export const personHtml = (name: string): string => `<div data-vn-sil style="--c:${accentOf(name)}"></div>`;

export interface StageState {
  /** Present, left to right: person key, its face key ('' while none), and whether they speak now. */
  cast: Array<{ key: string; face: string; speaking: boolean }>;
  narration: boolean;
  bg: string;
  cg: string;
  /** The box shows its whole text at once (a tap during the reveal). */
  revealed: boolean;
  log: boolean;
  /** The right-hand strip of illustrations is open. */
  strip?: boolean;
  auto: boolean;
  voice: boolean;
}
// Phones are narrow: people overlap, the speaker in front, as a portrait VN stages them.
const SPOTS: Record<number, number[]> = { 1: [50], 2: [33, 67], 3: [24, 50, 76] };
/** The one style text a scene sets: who stands where, who is lit, which picture, which background. */
export function stageCss(s: StageState): string {
  const spots = SPOTS[Math.min(3, s.cast.length)] ?? [];
  const rules = s.cast.slice(0, 3).map((p, i) => {
    const lit = s.cg ? 'filter:brightness(.28) blur(2px)' : p.speaking ? 'filter:none;transform:scale(1.035);z-index:3' : s.narration ? 'filter:brightness(.62) saturate(.85);z-index:1' : 'filter:brightness(.4) saturate(.6) blur(1.2px);transform:scale(.96);z-index:1';
    return `[x-omni-vn] [x-vn-p="${p.key}"]{display:block;left:${spots[i]}%;${lit}}`
      + (p.face ? `[x-omni-vn] [x-vn-p="${p.key}"] [x-vn-sp="${p.face}"]{opacity:1}[x-omni-vn] [x-vn-p="${p.key}"] [data-vn-sil]{opacity:0}` : '');
  });
  return [
    ...rules,
    s.bg ? `[x-omni-vn] [x-vn-bg="${s.bg}"]{display:block}` : '',
    s.cg ? `[x-omni-vn] img[x-vn-cg="${s.cg}"]{display:block}[x-omni-vn] [data-vn-box]{opacity:0}[x-omni-vn] [x-vn-bg]{filter:brightness(.45) blur(3px)}` : '',
    s.revealed ? '[x-omni-vn] [data-vn-text] span{animation:none!important;opacity:1!important}[x-omni-vn] [data-vn-next]{animation-delay:0s!important}' : '',
    s.log ? '[x-omni-vn] [data-vn-log]{display:block}' : '',
    s.strip ? '[x-omni-vn] [data-vn-strip]{translate:0 0}[x-omni-vn] [data-vn-act="strip"]{opacity:0}' : '',
    `[x-omni-vn] [data-vn-act="auto"]{color:${s.auto ? 'var(--gold)' : '#d8cfb4'}${s.auto ? ';text-shadow:0 0 8px var(--gold)' : ''}}[x-omni-vn] [data-vn-act="voice"]{opacity:${s.voice ? 1 : .4}}`,
  ].filter(Boolean).join('\n');
}

/** Letters appear one by one (CSS only); the arrow shows once they all have. Returns the reveal time. */
export function boxHtml(input: { speaker: string; text: string; narration: boolean }): { html: string; revealMs: number } {
  const chars = [...input.text];
  const step = Math.max(8, Math.min(26, Math.floor(2600 / Math.max(1, chars.length))));
  const shown = input.narration || !input.speaker ? chars : ['“', ...chars, '”'];
  const letters = shown.map((ch, i) => ch === '\n' ? '\n' : `<span style="animation-delay:${i * step}ms">${esc(ch)}</span>`).join('');
  const revealMs = shown.length * step;
  const name = input.narration ? '' : esc(input.speaker);
  return {
    html: `<div data-vn-name style="--c:${accentOf(input.speaker || '?')}">${name}</div><div data-vn-text${input.narration ? ' data-narr' : ''}>${letters}</div><div data-vn-next style="animation-delay:${revealMs}ms"></div>`,
    revealMs,
  };
}
