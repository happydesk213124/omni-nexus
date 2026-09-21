type AutotagBridge = { __OMNI_AUTOTAG_CARD__?: (card: HTMLElement, file: File) => Promise<void> };
let current: HTMLElement | undefined;
let installed = false;
const busy = new WeakSet<HTMLElement>();

export function selectPasteCharacter(card: HTMLElement | undefined): void { current = card; }

export function bindCharacterPaste(): void {
  if (installed) return;
  installed = true;
  // Capture before the legacy bubbling handler; handle images only.
  window.addEventListener('paste', event => {
    const target = event.target as Element | null;
    if (!current?.isConnected || !target?.closest?.('#nx-char-edit-body')) return;
    const file = Array.from(event.clipboardData?.files || []).find(f => f.type.startsWith('image/'))
      || Array.from(event.clipboardData?.items || []).find(i => i.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const card = current;
    if (busy.has(card)) return;
    const run = (globalThis as AutotagBridge).__OMNI_AUTOTAG_CARD__;
    if (!run) return;
    busy.add(card);
    void run(card, file).finally(() => {
      busy.delete(card);
      card.dispatchEvent(new Event('omni-autotag'));
    });
  }, true);
}
