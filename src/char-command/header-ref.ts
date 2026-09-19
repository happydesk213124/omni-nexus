import type { CharacterRecord } from '../core/types';
import { readCharacterFromForm } from './form';
import { openImagePeek } from './peek';
import { setGenSpin } from './ui-bits';

type NativeFetch = (path: string, init?: Record<string, unknown>, timeout?: number) => Promise<Record<string, unknown>>;

function fetchFn(): NativeFetch {
  const n = (globalThis as { __INLAY_NATIVE__?: { fetch?: NativeFetch } }).__INLAY_NATIVE__;
  if (!n?.fetch) throw new Error('Inlay Nexus backend unavailable');
  return n.fetch.bind(n);
}

function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      resolve(s.includes(',') ? s.split(',', 2)[1] || '' : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export interface HeaderRefOpts {
  characterId: () => string;
  scope: () => string;
  sessionId: () => string;
  character: () => Partial<CharacterRecord>;
}

export function bindCharacterHeaderRef(root: ParentNode, opts: HeaderRefOpts): void {
  const slot = root.querySelector('[data-ce-ref-slot], [data-char-ref-preview]') as HTMLElement | null;
  const uploadBtn = root.querySelector('[data-ce-ref-upload]') as HTMLElement | null;
  const genBtn = root.querySelector('[data-ce-ref-gen], [data-char-ref-gen]') as HTMLElement | null;
  if (!slot) return;
  if (slot.getAttribute('data-ref-bound') === '1') return;
  slot.setAttribute('data-ref-bound', '1');

  const owner={id:opts.characterId(),scope:opts.scope(),sessionId:opts.sessionId()};
  const paint = (url: string) => {
    slot.innerHTML = url ? `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">` : '';
    slot.setAttribute('data-has-img', url ? '1' : '0');
  };

  const postRef = async (imageB64: string) => {
    const id = owner.id;
    if (!id) throw new Error('character_id required');
    const res = await fetchFn()('/v1/characters/ref', {
      method: 'POST',
      body: {
        character_id: id,
        scope: owner.scope,
        session_id: owner.sessionId,
        image_b64: imageB64,
      },
    }, 60000);
    paint(String(res?.preview_url || ''));
    return res;
  };

  slot.addEventListener('click', () => {
    const img = slot.querySelector('img');
    if (img?.src) openImagePeek(img.src);
  });

  uploadBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,.webp';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return;
      try {
        await postRef(await fileToB64(f));
      } catch {
        /* toast lives on the parent form */
      }
    });
    inp.click();
  });

  genBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setGenSpin([genBtn, slot], true);
    try {
      const prefix = root.querySelector('[data-ce-appearance]') ? 'ce' : 'char';
      const res = await fetchFn()('/v1/characters/preview-shot', {
        method: 'POST',
        body: { character: readCharacterFromForm(root, prefix, opts.character()) },
      }, 180000);
      const b64 = String(res?.image_b64 || '');
      if (!b64) return;
      await postRef(b64);
    } catch {
      /* parent form */
    } finally {
      setGenSpin([genBtn, slot], false);
    }
  });

  document.addEventListener('paste', (ev) => {
    if (!root.contains(document.activeElement) && !slot.matches(':hover')) return;
    const file = ev.clipboardData?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    ev.preventDefault();
    void fileToB64(file).then((b64) => postRef(b64)).catch(() => undefined);
  });
}

export function paintHeaderRefSlot(root: ParentNode, url: string): void {
  const slot = root.querySelector('[data-ce-ref-slot], [data-char-ref-preview]') as HTMLElement | null;
  if (!slot) return;
  slot.innerHTML = url ? `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">` : '';
}
