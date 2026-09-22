  const nxProgress = { nodes: null, cache: {}, run: null, timer: null, pending: null, dirty: false, disposed: false };
  function nxProgressWake(ms) {
    if (nxProgress.timer) clearTimeout(nxProgress.timer);
    nxProgress.timer = null;
    if (ms == null || nxProgress.disposed) return;
    nxProgress.timer = setTimeout(() => {
      nxProgress.timer = null;
      syncProgressToast().catch(error => Pe('progress toast', error));
    }, Math.max(1, ms));
  }
  async function destroyProgressToast() {
    nxProgressWake(null);
    const nodes = nxProgress.nodes;
    nxProgress.nodes = null;
    nxProgress.cache = {};
    nxProgress.run = null;
    t._progressToastRoot = null;
    t._progressToastShown = false;
    if (nodes) await nodes.root.remove();
  }
  async function nxDisposeProgressToast() {
    nxProgress.disposed = true;
    nxProgressWake(null);
    try { await nxProgress.pending; } catch {}
    await destroyProgressToast();
  }
  async function nxProgressField(key, value, write) {
    if (nxProgress.cache[key] === value) return;
    await write(value);
    nxProgress.cache[key] = value;
  }
  async function nxProgressVisible(visible) {
    if (!nxProgress.nodes) return;
    // Pass input through the toast; a status message must never eat chat gestures.
    const style = nxToastPos({ visible, pointerEvents: false, zIndex: 99999 });
    await nxProgressField('position', style, value => nxProgress.nodes.root.setStyleAttribute(value));
    t._progressToastShown = visible;
  }
  async function nxProgressMount() {
    if (nxProgress.nodes) return nxProgress.nodes;
    const doc = await ue();
    const body = doc && await Ee(doc);
    if (!body) return null;
    const styles = globalThis.__INLAY_VIEWER_CORE__.progressToastStyles;
    const root = await H(doc, 'div', { style: nxToastPos({ visible: false, pointerEvents: false }) });
    try {
      await root.setAttribute('id', 'inlay-nx-progress-toast');
      await root.setAttribute('role', 'status');
      await root.setAttribute('aria-live', 'polite');
      await root.setAttribute('aria-atomic', 'true');
      const card = await H(doc, 'div', { style: styles.card });
      const header = await H(doc, 'div', { style: styles.header });
      const icon = await H(doc, 'span', { style: 'flex:none;font:600 12px Arial;width:14px;text-align:center;' });
      await icon.setAttribute('aria-hidden', 'true');
      const title = await H(doc, 'span', { style: styles.title });
      const clock = await H(doc, 'span', { style: styles.clock });
      await clock.setAttribute('aria-hidden', 'true');
      const detail = await H(doc, 'div', { style: styles.detail });
      const rail = await H(doc, 'div', { style: styles.rail });
      await rail.setAttribute('aria-hidden', 'true');
      const fill = await H(doc, 'span');
      await header.appendChild(icon);
      await header.appendChild(title);
      await header.appendChild(clock);
      await card.appendChild(header);
      await card.appendChild(detail);
      await rail.appendChild(fill);
      await card.appendChild(rail);
      await root.appendChild(card);
      await body.appendChild(root);
      nxProgress.nodes = { root, icon, title, clock, detail, rail, fill };
      t._progressToastRoot = root;
      return nxProgress.nodes;
    } catch (error) {
      await root.remove().catch(() => {});
      throw error;
    }
  }
  async function nxProgressRender(view) {
    const nodes = await nxProgressMount();
    if (!nodes || nxProgress.disposed) return;
    const styles = globalThis.__INLAY_VIEWER_CORE__.progressToastStyles;
    const color = { busy: '#7132f5', success: '#026b3f', error: '#b42318', muted: '#686b82' }[view.tone];
    const icon = { busy: '•', success: '✓', error: '!', muted: '–' }[view.tone];
    await nxProgressField('title', view.title, value => nodes.title.setTextContent(value));
    await nxProgressField('detail', view.detail, value => nodes.detail.setTextContent(value));
    await nxProgressField('clock', view.clock, value => nodes.clock.setTextContent(value));
    await nxProgressField('icon', icon, value => nodes.icon.setTextContent(value));
    await nxProgressField('color', color, value => nodes.title.setStyleAttribute(styles.title + 'color:' + value));
    await nxProgressField('detailStyle', view.detail ? styles.detail : 'display:none;', value => nodes.detail.setStyleAttribute(value));
    await nxProgressField('rail', view.showRail ? styles.rail : 'display:none;', value => nodes.rail.setStyleAttribute(value));
    const fillStyle = styles.fill + `background:${color};opacity:${view.measured ? 1 : .3};transform:scaleX(${view.measured ? view.ratio : .24});`;
    await nxProgressField('fill', fillStyle, value => nodes.fill.setStyleAttribute(value));
    await nxProgressVisible(true);
  }
  async function nxProgressFlush() {
    nxProgressWake(null);
    const setting = t.backendSettings?.card?.progress_toast;
    if (![true, 1, 'true', '1'].includes(setting)) {
      if (nxProgress.nodes || nxProgress.run) await destroyProgressToast();
      return;
    }
    const now = Date.now();
    const job = t.jobProgress;
    let run = nxProgress.run;
    if (job) {
      const key = String(job.toastRun || job.jobId || job.kind || 'job');
      const view = globalThis.__INLAY_VIEWER_CORE__.progressToastView(job);
      if (!run || run.key !== key || (run.terminal && !view.terminal)) {
        run = nxProgress.run = { key, started: now, terminal: false, until: 0, shown: false, expired: false, job };
      }
      if (!run.terminal) run.job = { ...job };
      if (view.terminal && !run.terminal) {
        run.job = { ...job };
        run.terminal = true;
        run.until = now + (view.tone === 'error' ? 6000 : 1800);
        // Tiny operations should not flash a completion toast; errors always surface.
        if (!run.shown && now - run.started < 450 && view.tone !== 'error') run.expired = true;
      }
    } else if (run && !run.terminal) {
      nxProgress.run = run = null;
    }
    if (!run || run.expired || (run.terminal && now >= run.until)) {
      if (run) run.expired = true;
      await nxProgressVisible(false);
      return;
    }
    if (!run.terminal && now - run.started < 450) {
      await nxProgressVisible(false);
      nxProgressWake(450 - (now - run.started));
      return;
    }
    const view = globalThis.__INLAY_VIEWER_CORE__.progressToastView(run.job, now - run.started);
    await nxProgressRender(view);
    run.shown = !!nxProgress.nodes;
    // This is the only toast timer. Idle has none; elapsed time changes every 5s.
    nxProgressWake(run.terminal ? run.until - Date.now() : 5000 - ((Date.now() - run.started) % 5000));
  }
  function syncProgressToast() {
    if (nxProgress.disposed) return Promise.resolve();
    nxProgress.dirty = true;
    if (!nxProgress.pending) {
      // Serialize SafeDOM writes and retain updates that arrive during an await.
      nxProgress.pending = Promise.resolve().then(async () => {
        while (nxProgress.dirty && !nxProgress.disposed) {
          nxProgress.dirty = false;
          await nxProgressFlush();
        }
      }).finally(() => { nxProgress.pending = null; });
    }
    return nxProgress.pending;
  }
