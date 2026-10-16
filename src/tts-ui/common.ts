import type { TtsCharacterGender } from '../core/tts-types';
import { omniTts } from '../services/tts-runtime';
import { currentTtsContext } from '../services/tts-context';
import { saveTtsData } from '../storage/tts-store';

export const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
export const input = (id: string) => el<HTMLInputElement>(id);
export const val = (id: string) => input(id)?.value || '';
export const checked = (id: string) => !!input(id)?.checked;
export const set = (id: string, value: unknown) => { if (input(id)) input(id).value = String(value ?? ''); };
export const text = (id: string, value: string) => { const node=el(id); if (node && node.textContent !== value) node.textContent = value; };
export const list = (value: string) => [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))];
export const gender = (value: string) => value === '여성' ? 'female' : value === '남성' ? 'male' : 'unknown';
export const genderLabel = (value: string) => value === 'female' ? '여성' : value === 'male' ? '남성' : value === 'other' ? '기타' : '미지정';
/** Character gender has a fourth value, 기타, that voices do not. */
export const characterGender = (value: string): TtsCharacterGender => value === '기타' ? 'other' : gender(value);
export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function run(action: () => void | Promise<unknown>): void { try { Promise.resolve(action()).catch(error => { omniTts.report(error); alert(String((error as Error)?.message || error)); }); } catch (error) { omniTts.report(error); alert(String((error as Error)?.message || error)); } }
export function on(id: string, action: (event: Event) => void | Promise<unknown>, type = 'click'): void { el(id)?.addEventListener(type, event => { event.preventDefault(); run(() => action(event)); }); }
export function dialog(id: string, show = true): void { const node = el<HTMLDialogElement>(id); if (!node) return; if (show && !node.open) node.showModal(); else if (!show && node.open) node.close(); }
export function button(label: string, action: () => void | Promise<unknown>): HTMLButtonElement { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.addEventListener('click', event => { event.stopPropagation(); run(action); }); return node; }
export function download(value: unknown, name: string): void { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function readJson(file: File): Promise<unknown> { if (file.size > 5 * 1024 * 1024) throw new Error('JSON 파일은 5 MB 이하로 가져와 주세요.'); return JSON.parse(await file.text()); }
export async function persist(): Promise<void> { omniTts.stop(); await saveTtsData(); document.dispatchEvent(new Event('omnitts-library')); }
export async function audition(fishId: string, gain = 0, voice: { tone?: string; model?: string } = {}): Promise<void> {
  if (!fishId) throw new Error('Fish 음성을 먼저 선택해 주세요.');
  const reservation = omniTts.reservePlayback();
  await omniTts.player.unlock();
  if (!omniTts.player.ready) return;
  const context = await currentTtsContext().catch(()=>({scope:'audition',rosterScope:'global',characterId:'',chatId:'',sessionId:'',character:{},chat:{},messages:[]}));
  await omniTts.play([{ context, messageId: 'audition', fishId, gain, ...voice, segment: { id: fishId, text: '안녕하세요, こんにちは, Nice to meet you.', speaker: '', tone: '', kind: 'audition', start: 0, end: 0 } }], 0, reservation);
  if (omniTts.player.status === 'error' || omniTts.player.status === 'blocked') throw new Error(omniTts.notice || '미리 듣기를 재생하지 못했습니다.');
}
const LISTEN_LABEL = '듣기';
// Fish has to synthesize before anything is heard, so the ▶ turns into a spinner.
export function auditionButton(node: HTMLButtonElement, read: () => { fishId: string; gain?: number; tone?: string; model?: string }): HTMLButtonElement {
  node.classList.add('tts-listen');
  node.innerHTML = `<span class="tts-listen-icon" aria-hidden="true">▶</span> ${LISTEN_LABEL}`;
  node.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (node.getAttribute('aria-busy') === 'true') return;
    const { fishId, gain, tone, model } = read();
    node.setAttribute('aria-busy', 'true'); node.classList.add('is-loading');
    const done = () => { node.removeAttribute('aria-busy'); node.classList.remove('is-loading'); };
    run(async () => { try { await audition(fishId, gain ?? 0, { tone, model }); } finally { done(); } });
  });
  return node;
}
export function listenButton(read: () => { fishId: string; gain?: number }): HTMLButtonElement { const node = document.createElement('button'); node.type = 'button'; return auditionButton(node, read); }
export const LISTEN_CSS = '.tts-listen-icon{display:inline-block;width:1em;text-align:center}.tts-listen.is-loading .tts-listen-icon{width:.85em;height:.85em;box-sizing:border-box;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;font-size:0;vertical-align:-.1em;animation:tts-listen-spin .8s linear infinite}@keyframes tts-listen-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.tts-listen.is-loading .tts-listen-icon{animation-duration:2s}}';
/**
 * Risu sandboxes the plugin frame without allow-forms, so a submit button never
 * fires "submit". Validate and run the action from the button itself instead.
 */
export function onForm(formId: string, action: () => void | Promise<unknown>): void {
  const form = el<HTMLFormElement>(formId); if (!form) return;
  const submit = () => { if (form.reportValidity()) run(action); };
  for (const b of form.querySelectorAll<HTMLButtonElement>('button[type="submit"],button:not([type])')) {
    if (b.dataset.close) continue;
    b.type = 'button'; b.addEventListener('click', event => { event.preventDefault(); submit(); });
  }
  form.addEventListener('submit', event => { event.preventDefault(); submit(); });
  form.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); submit(); }
  });
}
/** A short notice floating at the bottom of the settings window; never reflows the form. */
export function notify(message: string): void {
  let node = document.getElementById('tts-notice');
  if (!node) {
    node = document.createElement('div'); node.id = 'tts-notice'; node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483000;width:max-content;max-width:min(520px,calc(100vw - 32px));box-sizing:border-box;padding:10px 14px;border:1px solid #fcd34d55;border-radius:12px;background:#1f2533f2;color:#fde68a;font:13px/1.5 sans-serif;box-shadow:0 8px 24px #0008;overflow-wrap:anywhere;pointer-events:none';
    document.body.append(node);
  }
  node.textContent = message; node.hidden = false;
  clearTimeout(Number(node.dataset.timer));
  node.dataset.timer = String(setTimeout(() => { if (node) node.hidden = true; }, 6000));
}
/**
 * The plugin frame also lacks allow-popups: a target=_blank click is silently
 * dropped (only a middle click escapes). Try a real window, otherwise copy the
 * address and say so instead of failing quietly.
 */
export function openExternal(link: HTMLAnchorElement, status: (message: string) => void): void {
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    let opened: Window | null = null;
    try { opened = window.open(link.href, '_blank', 'noopener,noreferrer'); } catch { opened = null; }
    if (opened) return;
    const copied = copyText(link.href);
    status(copied ? 'Risu가 새 탭을 막아 주소를 복사했어요 · 휠 클릭(모바일은 길게 누르기)으로도 열 수 있어요' : 'Risu가 새 탭을 막았어요 · 링크를 휠 클릭(모바일은 길게 누르기)해 주세요');
  });
}
function copyText(value: string): boolean {
  const field = document.createElement('textarea');
  field.value = value; field.setAttribute('readonly', ''); field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(field); field.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  field.remove();
  if (!ok) void navigator.clipboard?.writeText(value).catch(() => {});
  return ok;
}
