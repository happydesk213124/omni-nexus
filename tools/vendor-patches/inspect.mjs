import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

/** File-backed inspect must not resolve the card through a thumbnail cache again. */
export function repairInspectFullscreen(source) {
  const needle = '}, showFullscreen = async (f) => {\n      await fullscreen.setInnerHTML(`<img src="${Ie(f)}"';
  const patch = '}, showFullscreen = async (f) => {\n      const inspectSrc = typeof f?.image_url === "string" && f.image_url.startsWith("data:image/") ? f.image_url : Ie(f);\n      await fullscreen.setInnerHTML(`<img src="${inspectSrc}"';
  if (source.split(needle).length !== 2) throw new Error('[inspect repair] fullscreen image needle drift');
  return source.replace(needle, patch);
}

export function repairAsyncInspect(source) {
  const start = source.indexOf('showFullscreen = async (f) => {');
  const end = source.indexOf('findActHit = async (x, I) => {', start);
  if (start < 0 || end < start || createHash('sha256').update(source.slice(start, end)).digest('hex') !== '9d1945a09d41e8a92c0ad665604d6d1a746fec4a93938ac0b6d54a73df2557f8') {
    throw new Error('[inspect repair] frozen sheet drift');
  }
  const runtime = readFileSync(new URL('./inspect-surface.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('./inspect-runtime.js', import.meta.url), 'utf8');
  let out = source.slice(0, start) + runtime + '\n    ' + source.slice(end);
  const state = '    const PRESS_MS = 420;';
  if (out.split(state).length !== 2) throw new Error('[inspect repair] sheet state drift');
  // NOTE: the replaced region sits mid-chain of one giant vendor `const`
  // statement (showFullscreen = ..., ..., findActHit = ...), so names added
  // to the runtime file are const declarators there — do NOT also declare
  // them in the injected let below (duplicate declaration breaks the build).
  return out.replace(state, '    const nxInspectDroppedImages = new WeakSet();\n    let nxInspectSurface = null, nxInspectSurfaceBuild = null, nxInspectShell = null, nxInspectBuild = null, nxInspectImageHtml = "", nxInspectMirroredImage = null, nxInspectPaint = Promise.resolve();\n' + state);
}

/** Close must not wait for host hides: fire-and-forget so the tap returns now. */
export function repairInspectCloseNow(source) {
  const needle = '      if (!card || act === "close") {\n        await hideInspect();\n        return;\n      }';
  const patch = '      if (!card || act === "close") {\n        hideInspect().catch(() => {});\n        return;\n      }';
  if (source.split(needle).length !== 2) throw new Error('[inspect repair] close dispatch needle drift');
  return source.replace(needle, patch);
}

/** Open-guard taps still reach 닫기: every other tap waits out the guard. */
export function repairInspectGuardClose(source) {
  const needle = `      if (inspectOpen && await hitEl(actionMenu, x, I)) {
        cancelMobilePress();
        if (Date.now() < inspectGuardUntil) {
          pendingSheetHit = {
            kind: "guard"
          };
          return;
        }`;
  const patch = `      if (inspectOpen && await hitEl(actionMenu, x, I)) {
        cancelMobilePress();
        if (Date.now() < inspectGuardUntil) {
          // Close stays tappable during the open guard so open/close can
          // alternate rapidly; every other tap still waits out the guard.
          try {
            const nxCloseZone = nxInspectShell?.zones?.find(z => z?.act === "close");
            if (nxCloseZone?.el && await hitEl(nxCloseZone.el, x, I)) {
              pendingSheetHit = { kind: "act", act: "close", charI: -1 };
              return;
            }
          } catch {}
          pendingSheetHit = {
            kind: "guard"
          };
          return;
        }`;
  if (source.split(needle).length !== 2) throw new Error('[inspect repair] guard pointerdown needle drift');
  return source.replace(needle, patch);
}

/** A fast down+up inside the guard must still deliver a recorded close tap. */
export function repairInspectGuardCloseUp(source) {
  const needle = `      if (inspectOpen) {
        const hit = pendingSheetHit;
        pendingSheetHit = null;
        if (Date.now() < inspectGuardUntil || hit?.kind === "guard") return;`;
  const patch = `      if (inspectOpen) {
        const hit = pendingSheetHit;
        pendingSheetHit = null;
        if (hit?.kind === "act" && hit.act === "close") { await runInspectAction("close", actionCard, -1); return; }
        if (Date.now() < inspectGuardUntil || hit?.kind === "guard") return;`;
  if (source.split(needle).length !== 2) throw new Error('[inspect repair] guard pointerup needle drift');
  return source.replace(needle, patch);
}
