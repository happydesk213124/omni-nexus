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
export const genderLabel = (value: string) => value === 'female' ? '여성' : value === 'male' ? '남성' : '미지정';
export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function run(action: () => void | Promise<unknown>): void { try { Promise.resolve(action()).catch(error => { omniTts.report(error); alert(String((error as Error)?.message || error)); }); } catch (error) { omniTts.report(error); alert(String((error as Error)?.message || error)); } }
export function on(id: string, action: (event: Event) => void | Promise<unknown>, type = 'click'): void { el(id)?.addEventListener(type, event => { event.preventDefault(); run(() => action(event)); }); }
export function dialog(id: string, show = true): void { const node = el<HTMLDialogElement>(id); if (!node) return; if (show && !node.open) node.showModal(); else if (!show && node.open) node.close(); }
export function button(label: string, action: () => void | Promise<unknown>): HTMLButtonElement { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.addEventListener('click', event => { event.stopPropagation(); run(action); }); return node; }
export function download(value: unknown, name: string): void { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function readJson(file: File): Promise<unknown> { if (file.size > 5 * 1024 * 1024) throw new Error('JSON 파일은 5 MB 이하로 가져와 주세요.'); return JSON.parse(await file.text()); }
export async function persist(): Promise<void> { omniTts.stop(); await saveTtsData(); document.dispatchEvent(new Event('omnitts-library')); }
export async function audition(fishId: string, gain = 0): Promise<void> {
  if (!fishId) throw new Error('Fish 음성을 먼저 선택해 주세요.');
  const reservation = omniTts.reservePlayback();
  await omniTts.player.unlock();
  if (!omniTts.player.ready) return;
  const context = await currentTtsContext().catch(()=>({scope:'audition',characterId:'',chatId:'',sessionId:'',character:{},chat:{},messages:[]}));
  await omniTts.play([{ context, messageId: 'audition', fishId, gain, segment: { id: fishId, text: '안녕하세요, こんにちは, Nice to meet you.', speaker: '', tone: '', kind: 'audition', start: 0, end: 0 } }], 0, reservation);
}
