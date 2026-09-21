  // A confirmed baseline is separate from backendSettings, which viewer and
  // form handlers mutate optimistically before requesting persistence.
  function omniSettingsDelta(patch, baseline) {
    const result = {};
    for (const [key, value] of Object.entries(patch || {})) {
      const before = baseline?.[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = omniSettingsDelta(value, before);
        if (Object.keys(nested).length) result[key] = nested;
      } else if (JSON.stringify(value) !== JSON.stringify(before)) result[key] = value;
    }
    return result;
  }
  function omniSaveError(error) {
    const message = "설정 저장 실패: " + z(error?.message || error);
    y("warn", "settings.save", error?.message || error);
    if (t.uiOpen) $e(message, !1);
    else if (typeof nxHostToast === "function") void Promise.resolve(nxHostToast(message, { ms: 8000 })).catch(() => {});
  }
  function omniLiveWrites() {
    const live = t._omniLiveWrites || (t._omniLiveWrites = { timers: new Map(), pending: new Map(), writes: Promise.resolve() });
    live.queued ||= new Set();
    live.active ||= new Set();
    live.versions ||= new Map();
    live.errors ||= new Map();
    return live;
  }
  function omniScheduleLiveKey(key) {
    const live = omniLiveWrites();
    clearTimeout(live.timers.get(key)); live.timers.delete(key);
    if (live.queued.has(key)) return;
    live.queued.add(key);
    const job = live.writes.catch(() => {}).then(async () => {
      live.queued.delete(key);
      const work = live.pending.get(key), version = live.versions.get(key);
      live.pending.delete(key);
      if (!work) return;
      live.active.add(key);
      try {
        await work();
        live.errors.delete(key);
      } catch (error) {
        if (live.versions.get(key) === version) {
          live.pending.set(key, work);
          live.errors.set(key, error);
        }
        throw error;
      } finally { live.active.delete(key); }
    });
    live.writes = job;
    void job.catch(omniSaveError);
  }
  function omniEnqueueLiveWrite(key, work) {
    const live = omniLiveWrites();
    clearTimeout(live.timers.get(key));
    live.versions.set(key, (live.versions.get(key) || 0) + 1);
    live.pending.set(key, work);
    live.errors.delete(key);
    live.timers.set(key, setTimeout(() => omniScheduleLiveKey(key), 500));
  }
  async function omniFlushLiveWrites() {
    const live = omniLiveWrites();
    for (const key of live.pending.keys()) omniScheduleLiveKey(key);
    let tail, tailError;
    do {
      tail = live.writes; tailError = null;
      try { await tail; } catch (error) { tailError = error; }
    } while (tail !== live.writes);
    if (live.errors.size) throw live.errors.values().next().value;
    if (tailError) throw tailError;
  }
  function omniQueuePromptSave(key, text) {
    omniEnqueueLiveWrite("prompt:" + key, async () => {
      if (text === String(t.prompts?.find(row => row.key === key)?.text ?? "")) return;
      await K("/v1/prompts/" + encodeURIComponent(key), { method: "PUT", body: { text } });
      const current = t.prompts?.find(row => row.key === key);
      if (current) current.text = text;
    });
  }
  async function flushSettingsSave() {
    t._flushSettingsFields?.();
    clearTimeout(t.settingsSaveTimer); t.settingsSaveTimer = null;
    if (t.settingsSaveInFlight) return t.settingsSaveInFlight;
    const run = Promise.resolve().then(async () => {
      do {
        while (t.settingsSavePending) {
          const pending = t.settingsSavePending;
          t.settingsSavePending = null;
          const patch = omniSettingsDelta(pending, t._settingsConfirmed);
          if (!Object.keys(patch).length) continue;
          try {
            await pe(patch);
            t._settingsNeedsCommit = true;
          } catch (error) {
            // Retry the failed values, but edits made during the request win.
            t.settingsSavePending = mergeSettingsPatch(pending, t.settingsSavePending);
            throw error;
          }
          if (patch.card && "show_risu_settings_button" in patch.card) {
            void syncQuickSettingsButton(patch.card.show_risu_settings_button !== !1).catch(omniSaveError);
          }
        }
        if (t._settingsNeedsCommit) {
          await globalThis.__INLAY_NATIVE__?.flushSettings?.();
          t._settingsNeedsCommit = false;
        }
      } while (t.settingsSavePending);
    });
    t.settingsSaveInFlight = run.finally(() => { t.settingsSaveInFlight = null; });
    return t.settingsSaveInFlight;
  }
  function omniCaptureSettingsSave() {
    // All DOM reads happen before hiding/remounting, including IME's last value.
    t._flushSettingsFields?.();
    const patch = {}, card = Mt(), extra = Ct();
    if (card || extra) patch.card = { ...card || {}, ...extra || {} };
    if (document.getElementById("nx-llm-model") || document.getElementById("nx-nai-model") || document.getElementById("nx-llm-provider")) {
      const models = ba();
      if (models) { patch.llm = models.llm; patch.llm_roles = models.llm_roles; patch.nai = models.nai; }
    }
    t.settingsSavePending = mergeSettingsPatch(t.settingsSavePending, patch);
    if (t.backendSettings) t.backendSettings = mergeSettingsPatch(t.backendSettings, patch);
    for (const row of t.prompts || []) {
      const key = row.key;
      if (!key) continue;
      const field = document.getElementById("nx-prompt-" + key);
      const text = field ? field.value || "" : String(t.promptDrafts?.[key] ?? row.text ?? "");
      if (field) (t.promptDrafts ||= {})[key] = text;
      const live = omniLiveWrites();
      // Also replace pending work when a user undoes an edit back to the saved value.
      if (text === String(row.text || "") && !live.pending.has("prompt:" + key) && !live.queued.has("prompt:" + key) && !live.active.has("prompt:" + key)) continue;
      omniQueuePromptSave(key, text);
    }
    const scope = t.lastScope, revision = t._omniRosterRevision || 0;
    const live = omniLiveWrites(), key = "characters:" + scope?.sessionId;
    if (t._charsDirty && scope?.sessionId && !live.pending.has(key) && !live.queued.has(key)) {
      const hasDom = !!document.querySelector('[data-char-scope="session"], [data-char-scope="global"]');
      const body = JSON.parse(JSON.stringify(withRootSessions({ session_id: scope.sessionId, character_id: scope.characterId || "",
        characters: hasDom ? oe("session") : t.charactersSession || [], global: hasDom ? oe("global") : t.charactersGlobal || [] }, scope)));
      omniEnqueueLiveWrite(key, async () => {
        const cached = t._omniRosterCache?.get(scope.sessionId);
        if ((t.lastScope?.sessionId === scope.sessionId && !t._charsDirty) || (cached?.dirty === false && cached.revision === revision)) return;
        const result = await K("/v1/characters", { method: "POST", body });
        if (cached?.revision === revision) cached.dirty = false;
        if (t.lastScope?.sessionId === scope.sessionId && (t._omniRosterRevision || 0) === revision) {
          t._charsDirty = false;
          t.charactersSession = result?.characters || t.charactersSession;
          t.charactersGlobal = result?.global || t.charactersGlobal;
        }
      });
    }
  }
  async function xa(opts) {
    const silent = !!opts?.silent;
    if (!opts?.captured) omniCaptureSettingsSave();
    try {
      // Settings and character/prompt writes have independent storage lanes.
      const results = await Promise.allSettled([flushSettingsSave(), omniFlushLiveWrites()]);
      const failed = results.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
      if (!silent && t.uiOpen) { t.uiMessage = { type: "success", text: "저장됨" }; $e("저장됨"); }
    } catch (error) {
      omniSaveError(error);
      if (!silent) t.uiMessage = { type: "error", text: z(error?.message || error) };
      return false;
    }
    if (!silent && t.uiOpen) await P();
    return true;
  }
