import { resetCharacterPreviewIndex } from './character-preview-index';

/** Keep navigation mounted while the vendor replaces the selected bot's form. */
export function replaceMain(main: HTMLElement, html: string, tab: string): void {
  resetCharacterPreviewIndex();
  if (tab !== 'characters' || main.dataset.nxUxTab !== 'characters') {
    main.innerHTML = html;
    return;
  }
  const keep = ['nx-risu-pick', 'nx-risu-pick-bg', 'nx-char-risu-open']
    .map(id => main.querySelector<HTMLElement>(`#${id}`)).filter((node): node is HTMLElement => !!node);
  const scroll = [main, ...main.querySelectorAll<HTMLElement>('[id]')]
    .filter(node => node.scrollTop || node.scrollLeft)
    .map(node => ({ id: node.id, top: node.scrollTop, left: node.scrollLeft }));
  const held = document.createDocumentFragment();
  held.append(...keep);
  main.innerHTML = html;
  for (const node of keep) main.querySelector(`#${node.id}`)?.replaceWith(node);
  for (const saved of scroll) {
    const node = saved.id === main.id ? main : main.querySelector<HTMLElement>(`#${saved.id}`);
    if (node) { node.scrollTop = saved.top; node.scrollLeft = saved.left; }
  }
}
