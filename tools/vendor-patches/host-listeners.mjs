import { readFileSync } from 'node:fs';

const original = [
  '  async function fe(e, n, o, a = !1) {',
  '    if (!e || typeof e.addEventListener != "function") return null;',
  '    if (a) {',
  '      const r = await D(`listenCap:${n}`, () => e.addEventListener(n, o, {',
  '        capture: !0,',
  '        passive: !0',
  '      }), null);',
  '      return r ?? D(`listenCapBool:${n}`, () => e.addEventListener(n, o, !0), null);',
  '    }',
  '    return D(`listen:${n}`, () => e.addEventListener(n, o), null);',
  '  }',
  '  async function de(e, n, o) {',
  '    !e || o == null || typeof e.removeEventListener != "function" || (await D("rmListen", () => e.removeEventListener(n, o), null), await D("rmListenId", () => e.removeEventListener(o), null));',
  '  }',
].join('\n');

export function repairHostListeners(source) {
  if (source.split(original).length !== 2) throw new Error('[host listeners] patch drift');
  return source.replace(original, () => readFileSync(new URL('./host-listeners.js', import.meta.url), 'utf8').trimEnd());
}
