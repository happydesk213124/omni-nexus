/** Covers late-mounted dialogs as well as the current settings pane. */
export function installSearchClear(): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('nx-search-clear-style')) return;
  const style = document.createElement('style');
  style.id = 'nx-search-clear-style';
  style.textContent = `.nx-search-wrap{position:relative;display:flex;min-width:0;flex:1;align-items:center}.nx-search-wrap>input{width:100%;box-sizing:border-box;padding-right:40px!important}.nx-search-wrap>input::-webkit-search-cancel-button{display:none}.nx-search-clear{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:12px;background:transparent;color:var(--muted,#686b82);cursor:pointer;padding:0;font:18px/1 sans-serif}.nx-search-clear[hidden]{display:none!important}`;
  document.head.append(style);
  const bound = new WeakSet<HTMLInputElement>();
  const bind = (root: ParentNode) => {
    const inputs = root instanceof HTMLInputElement ? [root] : [...root.querySelectorAll<HTMLInputElement>('input')];
    for (const input of inputs) {
      if (bound.has(input) || !(/search/i.test(input.type + ' ' + input.id) || /검색/.test(input.placeholder))) continue;
      bound.add(input);
      const wrapper = document.createElement('span'); wrapper.className = 'nx-search-wrap';
      input.before(wrapper); wrapper.append(input);
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'nx-search-clear'; button.textContent = '×';
      button.setAttribute('aria-label', '검색어 지우기');
      const update = () => { button.hidden = !input.value; };
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus(); update();
      });
      input.addEventListener('input', update); input.addEventListener('change', update);
      wrapper.append(button); update();
    }
  };
  bind(document);
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element && node.isConnected) bind(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}
