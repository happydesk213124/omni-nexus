// A display fixture, not a parser for real image metadata.
const illustrationLines=[
  {name:'하린',tone:'',text:'여기서 잠깐 쉬었다 갈까?',illustration:true},
  {name:'도윤',tone:'',text:'좋아. 같이 책을 읽자.',illustration:true}
];
const illustrationSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#283253"/><stop offset="1" stop-color="#111829"/></linearGradient><linearGradient id="light"><stop stop-color="#ffdc9b" stop-opacity=".4"/><stop offset="1" stop-color="#ffdc9b" stop-opacity="0"/></linearGradient></defs><rect width="800" height="450" fill="url(#bg)"/><rect x="470" y="32" width="246" height="247" rx="90" fill="#7391aa"/><circle cx="590" cy="125" r="58" fill="#fbdca4"/><path d="M470 155h246M592 32v247" stroke="#334464" stroke-width="12"/><path d="M500 160L165 410h550z" fill="url(#light)"/><g fill="#182033" stroke="#43506b" stroke-width="5"><path d="M26 52h280v285H26z"/><path d="M26 129h280M26 222h280"/></g><g fill="#957995"><path d="M43 76h22v49H43zM110 153h21v65h-21zM180 246h25v83h-25z"/></g><g fill="#beac8a"><path d="M72 84h19v41H72zM137 153h32v65h-32zM38 256h18v73H38zM218 251h21v78h-21z"/></g><g fill="#788fab"><path d="M99 72h36v53H99zM48 151h29v67H48zM88 251h33v78H88z"/></g><path d="M184 431c-6-133 27-211 111-211s110 78 106 211" fill="#5f557f"/><ellipse cx="294" cy="209" rx="61" ry="80" fill="#352c44"/><ellipse cx="296" cy="215" rx="40" ry="54" fill="#dcb4a3"/><path d="M244 207c0-87 112-90 103 9l-38-40-63 55" fill="#43334c"/><path d="M431 431c2-117 24-191 90-191s112 76 117 191" fill="#3c6170"/><ellipse cx="526" cy="225" rx="45" ry="56" fill="#d8b49e"/><path d="M480 225c-21-93 121-102 92-7l-35-37-59 41" fill="#283039"/><path d="M181 374h480l50 76H133z" fill="#6f544f"/><path d="M321 379l72-15 66 16-10 33-57-13-67 14z" fill="#e2d3b0"/><path d="M392 366v33" stroke="#a99b81" stroke-width="3"/><g fill="#faf2e4"><rect x="130" y="40" width="291" height="64" rx="18"/><rect x="458" y="311" width="253" height="50" rx="16"/></g><g fill="#343344" font-family="Arial,sans-serif" font-size="19"><text x="152" y="79">여기서 잠깐 쉬었다 갈까?</text><text x="478" y="343">좋아. 같이 책을 읽자.</text></g></svg>`;
let illustrationRevealed=false,illustrationPending=null,illustrationTimer=null;
const illustrationCache=new Set();
function cancelIllustrationRequest(){clearTimeout(illustrationTimer);illustrationTimer=null;illustrationPending=null;}
function requestIllustration(i,origin='click'){
  if(!$('tts-power').checked||!$('illustration-read').checked)return;
  illustrationRevealed=true;renderReader();
  if(illustrationPending?.i===i)return;
  if(lines===illustrationLines&&index===i&&playing)return;
  const intent=interruptPlayback();
  if(!audioReady){pendingStart={i,source:illustrationLines,illustration:true,intent};if(origin==='click')$('audio-unlock-dialog').showModal();return;}

  if(illustrationCache.has(i)){startAt(i,'click',illustrationLines);return;}
  playing=false;illustrationPending={i,phase:'waiting',intent};updatePlayer();
  notify(previewBackgroundActive?'삽화 음성 · 요청 자리 대기 · 시안':'삽화 음성 · 생성 중 · 시안');
  if(!previewBackgroundActive)releaseIllustrationSlot();
}
function releaseIllustrationSlot(){
  if(!illustrationPending||illustrationPending.phase!=='waiting')return;
  const request=illustrationPending;request.phase='generating';paintIllustrationPlayback();
  illustrationTimer=setTimeout(()=>{
    if(illustrationPending!==request||request.intent!==playbackIntent)return;
    illustrationCache.add(request.i);illustrationPending=null;illustrationTimer=null;
    startAt(request.i,'click',illustrationLines);
  },650);
}
function renderIllustrationPreview(host){
  const figure=node('figure',undefined,'illustration-preview');figure.id='illustration-preview';
  const image=node('img');image.src='data:image/svg+xml,'+encodeURIComponent(illustrationSvg);image.alt='하린과 도윤이 도서관에서 책을 읽는 검수용 삽화';
  figure.append(image,node('figcaption','검수용 삽화 · 실제 메타데이터/음성 미연결'));
  const bar=node('div',undefined,'illustration-readbar');bar.hidden=!$('illustration-read').checked;
  const play=node('button','▶');play.id='illustration-play';play.type='button';play.setAttribute('aria-label','삽화 대사 재생');play.title='삽화 대사 재생';
  play.onclick=()=>{if($('click-play').checked)requestIllustration(0);};play.onmouseenter=()=>{if($('hover-play').checked)requestIllustration(0,'hover');};bar.append(play);
  illustrationLines.forEach((line,i)=>{
    const button=node('button',line.name,'illustration-chip');button.type='button';button.dataset.illustrationIndex=String(i);button.hidden=!illustrationRevealed;
    button.setAttribute('aria-label',`삽화 ${line.name} 대사 재생`);button.title=`${line.name} 대사 재생`;
    button.onclick=()=>{if($('click-play').checked)requestIllustration(i);};
    button.onmouseenter=()=>{if($('hover-play').checked)requestIllustration(i,'hover');};bar.append(button);
  });
  figure.append(bar);host.append(figure);
}
$('illustration-read').onchange=()=>{
  if(!$('illustration-read').checked){if(illustrationPending||pendingStart?.illustration||lines===illustrationLines)interruptPlayback();if(lines===illustrationLines){playing=false;lines=messageLines;index=eligible()[0];elapsed=0;}}
  renderReader();updateQueue();
};
function paintIllustrationPlayback(){
  const play=$('illustration-play');if(play){play.textContent=illustrationPending?'◌':'▶';play.dataset.phase=illustrationPending?.phase||'ready';play.title=illustrationPending?.phase==='waiting'?'요청 자리 대기':illustrationPending?'음성 생성 중':'삽화 대사 재생';}
  document.querySelectorAll('[data-illustration-index]').forEach(button=>button.setAttribute('aria-pressed',String(lines===illustrationLines&&Number(button.dataset.illustrationIndex)===index&&playing)));
}
