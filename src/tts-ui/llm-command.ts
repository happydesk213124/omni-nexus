import type { LlmSettings } from '../core/types';
import { callLlm } from '../providers/llm/client';
import { parseLlmJson } from '../providers/tts/translation';
import { LLM_MODEL_CHOICES, llmForChoice } from './llm-actions';
import { el, esc, notify, run } from './common';

/** One proposed change; nothing happens until the user leaves it ticked and applies. */
export interface LlmProposal { label: string; apply: () => void; stale?: () => boolean }
/**
 * 「LLM에게 시키기」 for one list (voices, BGM, effects, the glossary): a request,
 * optional pasted source, the model's proposals as ticked rows, and one apply.
 * Adding, renaming, moving between folders and retagging are one request.
 */
export interface LlmCommand {
  title: string;
  scope: string;
  placeholder: string;
  /** Pasted source to add from (a site's list of voices or sounds). */
  source: boolean;
  propose: (request: string, source: string, llm: LlmSettings) => Promise<LlmProposal[]>;
  /** Saves and repaints after the applied changes. */
  commit: () => Promise<void>;
}
export const askLlmJson = async (llm: LlmSettings, messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<unknown> => parseLlmJson(await callLlm(llm, messages));

let current: LlmCommand | undefined, proposals: LlmProposal[] = [];
const ID = 'llm-command-dialog';
function sheet(): HTMLDialogElement {
  const old = el<HTMLDialogElement>(ID);
  if (old) return old;
  const node = document.createElement('dialog'); node.id = ID; node.className = 'editor-sheet';
  node.innerHTML = `<div class="dialog-head"><button type="button" class="editor-fold" data-llm-close aria-label="닫기"><span id="llm-command-title">LLM에게 시키기</span> ▾</button></div>`
    + `<div class="editor-scroll"><p id="llm-command-scope"></p>`
    + `<label class="field"><span>모델</span><select id="llm-command-model">${LLM_MODEL_CHOICES.map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select></label>`
    + `<label class="field full"><span>요청</span><textarea id="llm-command-request" rows="3"></textarea></label>`
    + `<label class="field full" id="llm-command-source-wrap"><span>붙여 넣을 자료 (선택)</span><textarea id="llm-command-source" rows="4" placeholder="사이트에서 복사한 목록을 붙여 넣으면 그 안의 항목을 추가로 제안합니다"></textarea></label>`
    + `<div class="dialog-actions"><button type="button" class="primary" id="llm-command-run">제안 받기</button></div>`
    + `<small id="llm-command-status" role="status"></small><div id="llm-command-results"></div></div>`
    + `<div class="dialog-actions"><button type="button" data-llm-close>닫기</button><button type="button" class="primary" id="llm-command-apply" disabled>선택한 것 적용</button></div>`;
  (el('tts-dialogs') || document.body).append(node);
  for (const close of node.querySelectorAll('[data-llm-close]')) close.addEventListener('click', () => node.close());
  const status = (message: string) => { el('llm-command-status').textContent = message; };
  el('llm-command-run').addEventListener('click', () => run(async () => {
    const command = current; if (!command) return;
    const request = (el<HTMLTextAreaElement>('llm-command-request').value || '').trim(), source = command.source ? el<HTMLTextAreaElement>('llm-command-source').value || '' : '';
    if (!request && !source.trim()) { status('무엇을 할지 적어 주세요.'); return; }
    const runButton = el<HTMLButtonElement>('llm-command-run'); runButton.disabled = true; status('제안 받는 중…');
    el('llm-command-results').replaceChildren(); el<HTMLButtonElement>('llm-command-apply').disabled = true;
    try { proposals = await command.propose(request, source, llmForChoice(el<HTMLSelectElement>('llm-command-model').value)); }
    catch (error) { status(`제안을 받지 못했습니다: ${String((error as Error)?.message || error)}`); proposals = []; return; }
    finally { runButton.disabled = false; }
    el('llm-command-results').innerHTML = proposals.map((row, i) => `<label class="llm-command-row" style="display:flex;gap:10px;padding:9px 4px;border-bottom:1px solid #ffffff18"><input type="checkbox" data-row="${i}" checked><span>${row.label}</span></label>`).join('');
    el<HTMLButtonElement>('llm-command-apply').disabled = !proposals.length;
    status(proposals.length ? `${proposals.length}개 제안 · 선택한 것만 적용합니다` : '바꿀 것이 없다는 답입니다.');
  }));
  el('llm-command-apply').addEventListener('click', () => run(async () => {
    const command = current; if (!command) return;
    const picked = [...el('llm-command-results').querySelectorAll<HTMLInputElement>('input[data-row]:checked')].map(box => proposals[Number(box.dataset.row)]!).filter(Boolean);
    if (!picked.length) { status('적용할 항목을 골라 주세요.'); return; }
    // Proposals describe the list as it was; a list changed meanwhile asks again.
    if (picked.some(row => row.stale?.())) { status('그사이 목록이 바뀌었습니다. 제안을 다시 받아 주세요.'); return; }
    for (const row of picked) row.apply();
    await command.commit(); node.close(); notify(`${picked.length}개를 적용했습니다.`);
  }));
  return node;
}
export function openLlmCommand(command: LlmCommand): void {
  const node = sheet(); current = command; proposals = [];
  el('llm-command-title').textContent = `LLM에게 시키기 · ${command.title}`;
  el('llm-command-scope').textContent = command.scope;
  el<HTMLTextAreaElement>('llm-command-request').placeholder = command.placeholder;
  el('llm-command-source-wrap').hidden = !command.source;
  el('llm-command-results').replaceChildren(); el('llm-command-status').textContent = '';
  el<HTMLButtonElement>('llm-command-apply').disabled = true;
  if (!node.open) node.showModal();
}
/** The list's own 「LLM에게 시키기」 button, placed before `before` in its tool row. */
export function placeLlmCommandButton(id: string, before: HTMLElement | null, command: () => LlmCommand): void {
  if (!before || el(id)) return;
  const node = document.createElement('button'); node.type = 'button'; node.id = id; node.textContent = 'LLM에게 시키기';
  node.title = '추가·이름·폴더·태그 정리를 한 번에 맡깁니다 (적용 전에 확인)';
  node.addEventListener('click', () => openLlmCommand(command()));
  before.before(node);
}
