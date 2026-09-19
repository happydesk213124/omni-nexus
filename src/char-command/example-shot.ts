import type { CharacterRecord } from '../core/types';
import { PRESET_LOOK_WEBP_QUALITY } from '../core/util/char-ref-size';
import { readCharacterFromForm, type FormPrefix } from './form';
import { paintHeaderRefSlot } from './header-ref';
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

export interface ExampleShotOpts {
  characterId: () => string;
  scope: () => string;
  sessionId: () => string;
  character?: () => Partial<CharacterRecord>;
  prefix?: FormPrefix;
  fallbackUrl?: () => string;
  onToast?: (text: string, ok?: boolean) => void;
}

export function paintExampleSlot(root: ParentNode, url: string): void {
  root.querySelectorAll('[data-ce-ex-slot], [data-char-ex-preview], [data-cc-shot]').forEach((slot) => {
    (slot as HTMLElement).innerHTML = url ? `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">` : '';
  });
}

function b64FromDataUrl(url: string): string {
  if (!url.includes(',')) return '';
  return url.split(',', 2)[1] || '';
}

function paintHeadShot(root: ParentNode, url: string): void {
  const head = root.querySelector('[data-char-head-shot]') as HTMLElement | null;
  if (!head) return;
  head.innerHTML = url ? `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">` : '';
}

export function bindCharacterExampleShot(root: ParentNode, opts: ExampleShotOpts): void {
  const slot = root.querySelector('[data-ce-ex-slot], [data-char-ex-preview]') as HTMLElement | null;
  const vibeBtn = root.querySelector('[data-ce-ex-vibe], [data-char-ex-vibe]') as HTMLElement | null;
  const genBtn = root.querySelector('[data-ce-ex-gen], [data-char-ex-gen]') as HTMLElement | null;
  const uploadBtn = root.querySelector('[data-ce-ex-upload], [data-char-ex-upload]') as HTMLElement | null;
  const clearBtn = root.querySelector('[data-ce-ex-clear], [data-char-ex-clear]') as HTMLElement | null;
  if (!slot && !vibeBtn && !genBtn && !uploadBtn) return;
  const host = (slot || genBtn || vibeBtn || uploadBtn) as HTMLElement;
  if (host.getAttribute('data-ex-bound') === '1') return;
  host.setAttribute('data-ex-bound', '1');

  // The binding belongs to this card, even if its roster is no longer selected.
  const owner={id:opts.characterId(),scope:opts.scope(),sessionId:opts.sessionId()};
  let revision=0;
  let shotB64 = '';
  const toast = opts.onToast || (() => undefined);
  const prefix: FormPrefix = opts.prefix || (root.querySelector('[data-ce-appearance]') ? 'ce' : 'char');

  const paint = (url: string, b64 = '') => {
    shotB64 = b64;
    if (url && !shotB64 && url.includes(',')) shotB64 = url.split(',', 2)[1] || '';
    paintExampleSlot(root, url);
    paintHeadShot(root, url || opts.fallbackUrl?.() || '');
  };

  const postShot = async (imageB64: string) => {
    const own=++revision;
    const id = owner.id;
    if (!id) throw new Error('character_id required');
    const res = await fetchFn()('/v1/characters/example-shot', {
      method: 'POST',
      body: {
        character_id: id,
        scope: owner.scope,
        session_id: owner.sessionId,
        image_b64: imageB64,
      },
    }, 60000);
    if(own===revision)paint(String(res?.preview_url || ''), String(res?.image_b64 || imageB64));
    return res;
  };

  slot?.addEventListener('click', () => {
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
        await postShot(await fileToB64(f));
        toast('예제샷 등록됨');
      } catch (err) {
        toast(String((err as Error)?.message || err), false);
      }
    });
    inp.click();
  });

  clearBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const own=++revision;
    try {
      const id = owner.id;
      if (!id) return;
      await fetchFn()('/v1/characters/example-shot/clear', {
        method: 'POST',
        body: { character_id: id, scope: owner.scope, session_id: owner.sessionId },
      });
      if(own===revision)paint('');
      toast('예제샷 삭제됨');
    } catch (err) {
      toast(String((err as Error)?.message || err), false);
    }
  });

  genBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const own=++revision;
    setGenSpin([genBtn, slot], true);
    try {
      const character = opts.character?.() || readCharacterFromForm(root, prefix, {});
      const res = await fetchFn()('/v1/characters/example-shot', {
        method: 'POST',
        body: {
          character,
          character_id: owner.id || character.id,
          scope: owner.scope,
          session_id: owner.sessionId,
          generate: true,
        },
      }, 180000);
      if(own===revision)paint(String(res?.preview_url || ''), String(res?.image_b64 || ''));
      toast(res?.ok ? '예제샷 완료' : '예제샷 실패', !!res?.ok);
    } catch (err) {
      toast(String((err as Error)?.message || err), false);
    } finally {
      if(own===revision)setGenSpin([genBtn, slot], false);
    }
  });

  vibeBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      if (!shotB64) {
        const img = slot?.querySelector('img') as HTMLImageElement | null;
        shotB64 = b64FromDataUrl(img?.src || '');
      }
      if (!shotB64) {
        const cid = owner.id;
        const sc = owner.scope;
        if (cid && sc) {
          const got = await fetchFn()(
            `/v1/characters/example-shot?character_id=${encodeURIComponent(cid)}&scope=${encodeURIComponent(sc)}&session_id=${encodeURIComponent(owner.sessionId)}`,
          );
          shotB64 = String(got?.image_b64 || '') || b64FromDataUrl(String(got?.preview_url || ''));
          if (got?.preview_url) paint(String(got.preview_url), shotB64);
        }
      }
      if (!shotB64) {
        toast('예제샷이 없습니다', false);
        return;
      }
      const id = owner.id;
      if (!id) throw new Error('character_id required');
      const res = await fetchFn()('/v1/characters/ref', {
        method: 'POST',
        body: {
          character_id: id,
          scope: owner.scope,
          session_id: owner.sessionId,
          image_b64: shotB64,
          quality: PRESET_LOOK_WEBP_QUALITY,
        },
      }, 60000);
      const url = String(res?.preview_url || '');
      paintHeaderRefSlot(root, url);
      toast('참고이미지로 등록됨');
    } catch (err) {
      toast(String((err as Error)?.message || err), false);
    }
  });

  const id = owner.id;
  const scope = owner.scope;
  if (id && scope) {
    const own=revision;
    void fetchFn()(
      `/v1/characters/example-shot?character_id=${encodeURIComponent(id)}&scope=${encodeURIComponent(scope)}&session_id=${encodeURIComponent(owner.sessionId)}`,
    ).then((res) => {
      if(own===revision)paint(String(res?.preview_url || ''), String(res?.image_b64 || ''));
    }).catch(() => undefined);
  }
}
