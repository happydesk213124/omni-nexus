// The dropdown and settings slider share one review-session rate selection.
const defaultSpeedPresets=[.5,.75,1,1.25,1.5,1.75,2,2.5,3,3.5];
let speedPresets=[...defaultSpeedPresets];
function updateSpeedLimits(value){
  $('speed').min=String(Math.min(.5,value,...speedPresets));
  $('speed').max=String(Math.max(3.5,value,...speedPresets));
}
function applySpeedPresets(){
  const input=$('speed-presets'),text=input.value.trim();
  const tokens=text.split(',').map(part=>part.trim());
  const values=text?tokens.map(Number):defaultSpeedPresets;
  if(text&&tokens.some((part,i)=>!/^\d*\.?\d+$/.test(part)||!Number.isFinite(values[i])||values[i]<=0)){
    input.setAttribute('aria-invalid','true');input.setCustomValidity('쉼표로 구분한 0보다 큰 배속 숫자를 입력해 주세요.');
    $('speed-presets-error').hidden=false;return;
  }
  input.removeAttribute('aria-invalid');input.setCustomValidity('');$('speed-presets-error').hidden=true;
  speedPresets=[...new Set(values)].sort((a,b)=>a-b);
  const current=Number($('speed').value),select=$('player-speed');
  select.replaceChildren(...speedPresets.map(value=>new Option((Number.isInteger(value)?value.toFixed(1):String(value))+'×',String(value))));
  setSpeed(current);
}
$('speed-presets').onchange=applySpeedPresets;
applySpeedPresets();
