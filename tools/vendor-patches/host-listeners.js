  const nxHostListenerOptions = new WeakMap();
  async function fe(e, n, o, a = !1) {
    if (!e || typeof e.addEventListener != "function") return null;
    let options = a ? {capture: true, passive: true} : undefined;
    let id = await D(a ? `listenCap:${n}` : `listen:${n}`, () => e.addEventListener(n, o, options), null);
    if (a && id == null) {
      options = true;
      id = await D(`listenCapBool:${n}`, () => e.addEventListener(n, o, options), null);
    }
    if (id != null) {
      let registrations = nxHostListenerOptions.get(e);
      if (!registrations) nxHostListenerOptions.set(e, registrations = new Map());
      registrations.set(id, options);
    }
    return id;
  }
  async function de(e, n, o) {
    if (!e || o == null || typeof e.removeEventListener != "function") return;
    const registrations = nxHostListenerOptions.get(e);
    // Risu drops its listener ID even when native removal misses. The first
    // removal must match capture; retrying with another flag cannot recover it.
    await D("rmListen", () => e.removeEventListener(n, o, registrations?.get(o)), null);
    registrations?.delete(o);
    if (registrations?.size === 0) nxHostListenerOptions.delete(e);
  }
