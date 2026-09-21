import { pendingPromptDefaults } from '../services/prompt-revisions';

const retired = new Set(['autotag', 'char_looks', 'asset_tags_inject', 'asset_author_note']);
const notice = '기본 프롬프트가 업데이트되었습니다. 기본값을 눌러 적용하세요.';
let generation = 0;

function dot(parent: Element, on: boolean): void {
  let mark = parent.querySelector<HTMLElement>(':scope > .nx-prompt-update-dot');
  if (!mark && on) {
    mark = document.createElement('span'); mark.className = 'nx-prompt-update-dot';
    mark.style.cssText = 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;margin-left:5px;vertical-align:middle';
    mark.title = notice; mark.setAttribute('aria-label', notice); parent.append(mark);
  }
  if (mark) mark.hidden = !on;
}

export async function bindPromptUpdates(): Promise<void> {
  const own = ++generation;
  const pending = new Set(await pendingPromptDefaults());
  if (own !== generation) return;
  const promptsTab = document.querySelector('#nx-tabs [data-nx-tab="prompts"]');
  if (promptsTab) dot(promptsTab, pending.size > 0);
  for (const button of document.querySelectorAll<HTMLElement>('[data-reset-prompt]')) {
    const key = button.dataset.resetPrompt || '';
    const section = button.closest('details,.prompt-card,.group,.card') || button.parentElement?.parentElement;
    if (retired.has(key)) {
      if (section instanceof HTMLElement) section.hidden = true;
      continue;
    }
    dot(button, pending.has(key));
    const heading = section?.querySelector('summary,h3,h4,strong,[data-prompt-title]');
    if (key === 'character_common' && heading) heading.childNodes[0]!.textContent = '공통 캐릭터 프롬프트';
    if (heading) dot(heading, pending.has(key));
    if (section && pending.has(key) && !section.querySelector('.nx-prompt-update-notice')) {
      const hint = document.createElement('p'); hint.className = 'nx-prompt-update-notice'; hint.textContent = notice; section.append(hint);
    }
    if (!pending.has(key)) section?.querySelector('.nx-prompt-update-notice')?.remove();
  }
}
