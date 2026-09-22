import { pendingPromptDefaults } from '../services/prompt-revisions';
import { RETIRED_PROMPT_KEYS } from '../core/constants';

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
  for (const editor of document.querySelectorAll<HTMLTextAreaElement>('textarea[id^="nx-prompt-"]')) {
    const key = editor.id.slice('nx-prompt-'.length);
    const section = editor.closest('.block,details,.prompt-card,.group,.card') || editor.parentElement;
    if (RETIRED_PROMPT_KEYS.has(key)) {
      if (section instanceof HTMLElement) section.hidden = true;
      continue;
    }
    const heading = section?.querySelector('summary,h3,h4,strong,[data-prompt-title],span');
    if (heading) dot(heading, pending.has(key));
    if (section && pending.has(key) && !section.querySelector('.nx-prompt-update-notice')) {
      const hint = document.createElement('p'); hint.className = 'nx-prompt-update-notice'; hint.textContent = notice; section.append(hint);
    }
    if (!pending.has(key)) section?.querySelector('.nx-prompt-update-notice')?.remove();
  }
}
