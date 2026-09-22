  let nxRerollToastSequence = 0;
  async function withImageRerollToast(e, n, opts = {}) {
    const toastRun = 'reroll-' + (++nxRerollToastSequence);
    let total = Math.max(1, Math.floor(Number(opts.shotCount) || 1)), done = 0;
    const owns = () => t.jobProgress?.toastRun === toastRun;
    const base = () => ({ jobId: 'reroll', kind: 'reroll', toastRun, shot_count: total, shot_done: done, shot_index: done });
    t.jobProgress = { ...base(), state: 'generating', message: String(e || '이미지 재생성 중'), progress: 0 };
    await Se();
    const finish = async (state, message, failed = 0) => {
      if (!owns()) return;
      t.jobProgress = { ...base(), state, message, shot_failed: failed, progress: Math.round(done / total * 100) };
      await Se();
      setTimeout(() => {
        if (!owns()) return;
        t.jobProgress = null;
        Se().catch(() => {});
      }, 1800);
    };
    try {
      const result = await n(patch => {
        if (!owns()) return;
        if (Number.isFinite(Number(patch.shot_count)) && Number(patch.shot_count) > 0) total = Math.floor(Number(patch.shot_count));
        if (Number.isFinite(Number(patch.shot_done))) done = Math.min(total, Math.max(0, Math.floor(Number(patch.shot_done))));
        t.jobProgress = { ...t.jobProgress, ...patch, ...base(), shot_index: patch.shot_index ?? done, progress: Math.round(done / total * 100) };
        Se().catch(() => {});
      });
      const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
      if (Array.isArray(result?.cards)) done = Math.min(total, result.cards.length);
      else if (Number.isFinite(Number(result?.count))) done = Math.min(total, Math.max(0, Math.floor(Number(result.count))));
      else if (result?.ok !== false && !result?.stopped) done = total;
      if (result?.stopped) await finish('cancelled', '사용자 중단', failed);
      else if (result?.ok === false) await finish('error', z(result?.error?.message || '재생성하지 못했습니다.', 180), failed);
      else await finish('done', '리롤 완료', failed);
      return result;
    } catch (error) {
      await finish('error', z(error?.message || error, 180));
      throw error;
    }
  }
