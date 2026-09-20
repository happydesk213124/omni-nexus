import preview from './preview-panes.json';

type PreviewPack = { panes: Record<string, string>; overlays: string; chrome: string; help?: {tips:Record<string,{title:string;body:string}>;aliases:Record<string,string>} };

export function previewChrome(): string {
  return pack.chrome || '';
}

const pack = preview as PreviewPack;

function copyNode(dst: Element, src: Element): void {
  // Provider-dependent values can be hidden inputs where the preview has a select.
  // Keep their native type/value so role switches cannot save an empty fallback.
  if (src instanceof HTMLInputElement && src.type === 'hidden' && !(dst instanceof HTMLInputElement)) {
    dst.replaceWith(src.cloneNode(true));
    return;
  }
  // Event delegation uses data attributes as well as ids; layout remains preview-owned.
  for (const attr of src.getAttributeNames()) {
    if (attr.startsWith('data-')) dst.setAttribute(attr, src.getAttribute(attr) || '');
  }
  if (dst.matches('input,select,textarea,button')) dst.toggleAttribute('disabled', src.hasAttribute('disabled'));

  if (dst instanceof HTMLInputElement && src instanceof HTMLInputElement) {
    dst.type = src.type;
    // This tree is serialized before mounting: properties alone are lost.
    if (dst.type === 'checkbox' || dst.type === 'radio') dst.toggleAttribute('checked', src.checked);
    else if (dst.type !== 'file') dst.setAttribute('value', src.value);
    return;
  }
  if (dst instanceof HTMLSelectElement && src instanceof HTMLSelectElement) {
    if (src.options.length) dst.innerHTML = src.innerHTML;
    for (const option of dst.options) option.toggleAttribute('selected', option.value === src.value);
    return;
  }
  if (dst instanceof HTMLTextAreaElement && src instanceof HTMLTextAreaElement) {
    dst.textContent = src.value;
    return;
  }
  if (dst instanceof HTMLButtonElement && src instanceof HTMLButtonElement) {
    // Labels and icons belong to the preview, not the vendor renderer.
    return;
  }
  dst.innerHTML = src.innerHTML;
}

export function tabHtml(tab: string, vendorHtml: string, settings?: {card?: Record<string, unknown>}): string {
  const pane = pack.panes[tab];
  if (!pane || typeof vendorHtml !== 'string') return vendorHtml;
  const vendor = document.createElement('div');
  vendor.innerHTML = vendorHtml;
  if (tab === 'changelog') {
    // Release notes are maintained by the build, not the static preview.
    vendor.querySelectorAll<HTMLElement>('.card').forEach(entry => {
      entry.classList.replace('card', 'block');
    });
    return `<section class="pane active" id="changelog"><div class="stack">${vendor.innerHTML}</div></section>`;
  }
  const out = document.createElement('div');
  out.innerHTML = pane;
  if (tab === 'models') {
    const bar = out.querySelector('#nx-llm-role-tabs');
    const stack = bar?.parentElement;
    if (bar && stack) {
      const template = [...stack.children].filter(el => el !== bar).map(el => el.outerHTML).join('');
      [...stack.children].filter(el => el !== bar).forEach(el => el.remove());
      for (const [role, prefix] of [['main','nx-llm'],['autotag','nx-llm-autotag'],['asset_char','nx-llm-asset'],['comic','nx-llm-comic']]) {
        const body = document.createElement('div');
        body.dataset.uxLlmRole = role;
        body.innerHTML = template.replaceAll('nx-llm-', prefix + '-').replaceAll('nx-test-llm', 'nx-test-' + prefix.slice(3)).replaceAll('nx-test-result-llm', 'nx-test-result-' + prefix.slice(3));
        body.hidden = role !== (vendor.querySelector('[data-llm-role].active')?.getAttribute('data-llm-role') || 'main');
        body.dataset.llmPrefix = prefix;
        stack.appendChild(body);
      }
      const fish = document.createElement('div');
      fish.dataset.uxLlmRole = 'curator';
      fish.className = 'block'; fish.textContent = 'FISHTTS 연결은 다음 업데이트에서 지원합니다.';
      fish.hidden = !(vendor.querySelector('[data-llm-role="curator"]')?.classList.contains('active'));
      stack.appendChild(fish);
    }
  }
  const overlays = document.createElement('div');
  overlays.innerHTML = pack.overlays || '';
  const prefixes = tab === 'characters' ? ['nx-char-', 'nx-risu-']
    : tab === 'explorer' ? ['nx-ex-']
    : tab === 'style_presets' || tab === 'card' ? ['nx-preset-'] : [];
  for (const node of [...overlays.children]) {
    if (prefixes.some(prefix => node.id.startsWith(prefix))) out.appendChild(node);
  }
  const used = new Set<string>();
  out.querySelectorAll('[id]').forEach((dst) => {
    const id = dst.id;
    if (!id) return;
    const src = vendor.querySelector(`#${CSS.escape(id)}`);
    if (!src) return;
    used.add(id);
    copyNode(dst, src);
    const help = src.closest('[data-nx-help-id]');
    if (help) dst.setAttribute('data-nx-help-id', help.getAttribute('data-nx-help-id') || id);
  });
  if (tab === 'characters') {
    const slot = out.querySelector('#nx-lorefilter-slot');
    const lorefilter = vendor.querySelector('#nx-lorefilter');
    if (slot && lorefilter) {
      const clone = lorefilter.cloneNode(true) as Element;
      slot.replaceChildren(clone);
      for (const node of [clone, ...clone.querySelectorAll('[id]')]) if (node.id) used.add(node.id);
    }
    const peek = vendor.querySelector('#nx-lorefilter-peek');
    if (peek && !out.querySelector('#nx-lorefilter-peek')) {
      const clone = peek.cloneNode(true) as Element;
      out.appendChild(clone);
      for (const node of [clone, ...clone.querySelectorAll('[id]')]) if (node.id) used.add(node.id);
    }
  }
  // These controls moved out of the vendor dashboard. Its generation form has
  // no matching nodes, so the preview defaults must never become saved values.
  const card = settings?.card;
  if (card) for (const [id, key, defaultOn] of [
    ['nx-appearance', 'char_appearance', true],
    ['nx-llm-json-retry', 'llm_json_retry', false],
    ['nx-llm-reverse-bar', 'llm_reverse_bar', false],
    ['nx-llm-tag-cal', 'llm_tag_cal', false],
    ['nx-preprocess', 'preprocessing', false],
    ['nx-stream-keywords-on', 'stream_keywords_enabled', false],
  ] as const) {
    out.querySelector<HTMLInputElement>('#' + id)?.toggleAttribute('checked', card[key] == null ? defaultOn : Boolean(card[key]));
  }
  const keywords = out.querySelector('#nx-stream-keywords');
  if (card && keywords) keywords.textContent = String(card.stream_keywords || '');
  const chipRow = vendor.querySelector('.preset-chip-row');
  const tiles = out.querySelector('#nx-preset-chips');
  if (chipRow && tiles && !tiles.childElementCount) {
    tiles.innerHTML = chipRow.innerHTML;
    used.add('nx-preset-chips');
  }
  tiles?.querySelectorAll<HTMLElement>('.preset-chip').forEach(el => {
    el.classList.add('preset-tile');
    // The 2순위 tile keeps its green mark across repaints; nothing else ever painted it.
    const secondId = typeof card?.secondary_preset_id === 'string' ? card.secondary_preset_id : '';
    el.classList.toggle('second', !!secondId && el.dataset.presetSelect === secondId);
    // Isolate the name so live edits never replace the thumbnail or progress UI.
    const text = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE);
    const label = document.createElement('span');
    label.dataset.presetLabel = '1';
    label.textContent = text.map(node => node.textContent || '').join('');
    text.forEach(node => node.remove());
    el.append(label);
    el.title = label.textContent;
    el.setAttribute('aria-label', label.textContent);
  });
  out.querySelectorAll('[data-llm-role="curator"]').forEach(el => { el.textContent = 'FISHTTS'; });
  out.querySelectorAll('#nx-img-backend-bar button,#nx-llm-role-tabs button').forEach(el => el.classList.add('btn-ghost'));
  const grid = vendor.querySelector('.explorer-grid, .explorer-win');
  const ex = out.querySelector('#nx-explorer-grid');
  if (grid && ex && !ex.childElementCount) ex.innerHTML = grid.innerHTML;
  const folders = vendor.querySelector('#nx-explorer-folders');
  const foldOut = out.querySelector('#nx-explorer-folders');
  if (folders && foldOut) foldOut.innerHTML = folders.innerHTML;
  if (tab === 'explorer') {
    for (const id of ['nx-explorer-lightbox','nx-explorer-ctx','nx-explorer-tip','nx-explorer-marquee']) {
      const source = vendor.querySelector('#' + id);
      if (source && !out.querySelector('#' + id)) out.appendChild(source.cloneNode(true));
    }
  }
  if (tab === 'explorer' && document.querySelector('body > #nx-explorer-lightbox')) {
    out.querySelector('#nx-explorer-lightbox')?.remove();
    vendor.querySelector('#nx-explorer-lightbox')?.remove();
  }
  const keep = document.createElement('div');
  keep.hidden = true;
  keep.className = 'nx-vendor-keep';
  vendor.querySelectorAll('[id]').forEach((el) => {
    if (!el.id || used.has(el.id) || out.querySelector(`#${CSS.escape(el.id)}`)) return;
    const clone = el.cloneNode(true) as Element;
    // Ancestors may contain ids already mounted in the visible preview.
    clone.querySelectorAll('[id]').forEach((child) => {
      if (out.querySelector(`#${CSS.escape(child.id)}`) || keep.querySelector(`#${CSS.escape(child.id)}`)) child.remove();
    });
    if (!keep.querySelector(`#${CSS.escape(el.id)}`)) keep.appendChild(clone);
  });
  vendor.querySelectorAll('[data-nx-debug-panel]').forEach(button => keep.appendChild(button.cloneNode(true)));
  if (keep.childElementCount) out.appendChild(keep);
  // Serialized DOM keeps attributes but loses listeners. Never carry binding flags.
  for (const node of out.querySelectorAll('*')) for (const attr of node.getAttributeNames()) {
    if (/^data-nx-.*bound$/.test(attr) || attr === 'data-nx-bound') node.removeAttribute(attr);
  }
  return out.innerHTML;
}

export function previewHelp(id: string): {title:string;body:string} | undefined {
  const help=pack.help;
  return help?.tips[help.aliases[id] || id];
}
