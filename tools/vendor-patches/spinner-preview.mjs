import { readFileSync } from 'node:fs';

export function repairSpinnerPreview(source) {
  const start='  const nxSpinnerPreviews=new Map();',end='  async function paintAllMsgFans()';
  const a=source.indexOf(start),b=source.indexOf(end,a);
  if(source.split(start).length!==2 || source.split(end).length!==2 || b<=a)throw new Error('[spinner preview] boundary drift');
  let out=source.slice(0,a)+readFileSync(new URL('./spinner-preview.js',import.meta.url),'utf8')+'\n'+source.slice(b);
  for(const [needle,replacement] of [
    ['void omniRelease(records);if(nxSpinnerPreviews.size)void nxPaintSpinnerPreviews();','void omniRelease(records);nxScheduleSpinnerPreviews();'],
    ['omniFooterTargets.clear();nxSpinnerPreviews.clear();','omniFooterTargets.clear();nxDisposeSpinnerPreviews();'],
  ]) {
    if(out.split(needle).length!==2)throw new Error('[spinner preview] hook drift: '+needle);
    out=out.replace(needle,replacement);
  }
  return out;
}
