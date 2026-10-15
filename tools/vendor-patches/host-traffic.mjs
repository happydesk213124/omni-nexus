/**
 * Host traffic repairs, applied to the finished UI bundle (after every other
 * patch), so each needle is exactly the code that runs.
 *
 * Every SafeDOM call is a postMessage round trip, and Risu v3 attaches every
 * listener to the document whatever element it was registered on. On a slow
 * bridge (RisuNest) the pieces below were pure background cost: they served the
 * retired sticky pins, repeated a document listener, or re-read a whole
 * character to learn that nothing had changed.
 */
export function repairHostTraffic(source) {
  let out = source;
  const replace = (needle, patch) => {
    const found = out.split(needle).length - 1;
    if (found !== 1) throw new Error(`[host traffic] expected 1, got ${found}: ${needle.slice(0, 100)}`);
    out = out.replace(needle, () => patch);
  };
  const pinsOff = 't.backendSettings?.card?.overlay_markers === !1';

  // 1. Pins bound scroll + scrollend on the chat and 7 ancestors: 16 more
  //    document listeners, i.e. 16 extra messages per scroll event.
  replace('  async function Ha(e) {\n    const n = t.overlayUi;\n    if (!n?.onStickyScroll || !e) return;\n    await zt();\n',
    '  async function Ha(e) {\n    const n = t.overlayUi;\n    if (!n?.onStickyScroll || !e) return;\n    await zt();\n' +
    '    // Pin-only; the document scroll listener already sees every scroll.\n' +
    `    if (${pinsOff}) { n.extraScrollBindings = []; return; }\n`);

  // 2. The pin segment watch ticked every 400ms forever and re-read the whole
  //    character every ~10s; scope changes are caught by pointer/scroll events.
  replace('  function Gt() {\n    const e = t.overlayUi;\n',
    `  function Gt() {\n    if (${pinsOff}) return;\n    const e = t.overlayUi;\n`);

  // 3. Scroll settle re-read the message list and rects only to hand them to a
  //    scroll selection that returns at once (Da ignores source "scroll").
  replace('        settleScrollTrackNow();\n        nxScheduleStickyScrollSnap("settle");\n      };',
    `        if (${pinsOff}) return;\n        settleScrollTrackNow();\n        nxScheduleStickyScrollSnap("settle");\n      };`);

  // 4. A second document scroll listener for the same handler.
  replace('b = await fe(n, "scroll", u, !0), C = await fe(e, "scroll", u, !0)',
    'b = null, C = await fe(e, "scroll", u, !0)');

  // 5. Risu settings were polled every 400ms (two host calls each time). They
  //    open with a tap, so poll while open or right after a tap, else every 3.2s.
  replace('    t._risuSettingsWatch = setInterval(() => {\n      if (t.unloading) {\n        clearInterval(t._risuSettingsWatch), t._risuSettingsWatch = null;\n        return;\n      }\n      syncFloatingViewerForRisuSettings().catch(() => {\n      });\n    }, 400);',
    '    let tick = 0;\n    t._risuSettingsWatch = setInterval(() => {\n      if (t.unloading) {\n        clearInterval(t._risuSettingsWatch), t._risuSettingsWatch = null;\n        return;\n      }\n' +
    '      tick++;\n      const tapped = Date.now() - (Number(t._hostTapAt) || 0) < 1600;\n      if (!t._viewerHiddenForRisuSettings && !tapped && tick % 8) return;\n' +
    '      syncFloatingViewerForRisuSettings().catch(() => {\n      });\n    }, 400);');

  // 6. Session bookkeeping. A failed character/chat read used to invent ids
  //    (char_<index>, chat_<index>): a fake session switch that cleared the
  //    selection and reloaded the gallery. A click selection also writes the live
  //    chat into lastScope, so the unified UI session is compared on its own.
  replace('    }, S = t.lastScope?.sessionId || "";\n    if (e.useOverride === !1) return C;\n',
    '    }, S = t._uiSessionId || "";\n' +
    '    if ((o >= 0 && !s) || (!unified && o >= 0 && a >= 0 && !c)) {\n' +
    '      if (t.lastScope?.sessionId) return y("warn", "session.skip", "host read failed · keep " + String(t.lastScope.sessionId).slice(-8)), t.lastScope;\n' +
    '    }\n' +
    '    if (e.useOverride === !1) return C;\n');
  replace('      if (t.pendingSessionCount >= 2) return t.pendingSessionId = "", t.pendingSessionCount = 0, t.lastScope = C, await oa(S, b),',
    '      if (t.pendingSessionCount >= 2) return t.pendingSessionId = "", t.pendingSessionCount = 0, t._uiSessionId = b, t.lastScope = C, await oa(S, b),');
  replace('    return t.pendingSessionId = "", t.pendingSessionCount = 0, t.lastScope = C, C;\n  }',
    '    return t.pendingSessionId = "", t.pendingSessionCount = 0, t._uiSessionId = b, t.lastScope = C, C;\n  }');

  // 7. The scope check ran Z() (whole character + chat) on every throttled
  //    pointer move and scroll. The UI session is per character, so an unchanged
  //    character index means nothing to re-read.
  replace('    if (t._nxScopeFromScroll && typeof nxScrollDbg == "function") nxScrollDbg("scopeCheck", "Z() host index (from scroll)");\n    Z().catch(() => {});\n  }',
    '    if (t._nxScopeFromScroll && typeof nxScrollDbg == "function") nxScrollDbg("scopeCheck", "Z() host index (from scroll)");\n' +
    '    const pinned = t.scopeOverride && t.scopeOverride.charIndex != null && t.scopeOverride.charIndex !== "live";\n' +
    '    if (pinned || !t.lastScope || t.pendingSessionId) {\n      Z().catch(() => {});\n      return;\n    }\n' +
    '    Promise.resolve(k.getCurrentCharacterIndex?.()).then((index) => Number(index) === Number(t.lastScope?.charIndex) ? null : Z()).catch(() => {});\n  }');
  return out;
}
