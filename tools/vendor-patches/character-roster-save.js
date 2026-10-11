  async function omniSaveCharacterRows(scope, rows, repaint = false) {
    const body = JSON.parse(JSON.stringify(withRootSessions({
      session_id: scope?.sessionId || "", character_id: scope?.characterId || "",
      characters: oe("session"), global: oe("global"), ...rows
    }, scope)));
    const revision = (t._omniRosterRevision || 0) + 1;
    t._omniRosterRevision = revision;
    // Imported rows must be visible before saving, so edits made while waiting
    // include those rows instead of replacing the import with the old form.
    const merge = (incoming, previous) => incoming.map(row => ({ ...previous?.find(old => old.id === row.id), ...row }));
    if (body.characters) t.charactersSession = merge(JSON.parse(JSON.stringify(body.characters)), t.charactersSession);
    if (body.global) t.charactersGlobal = merge(JSON.parse(JSON.stringify(body.global)), t.charactersGlobal);
    t._charsDirty = true;
    t._omniRosterCache?.set(scope?.sessionId, {
      characters: t.charactersSession, global: t.charactersGlobal, appearance: t.appearance, dirty: true, revision
    });
    omniEnqueueLiveWrite("characters:" + body.session_id, async () => {
      const saved = await K("/v1/characters", { method: "POST", body });
      const cached = t._omniRosterCache?.get(body.session_id);
      if (cached?.revision === revision) {
        cached.characters = saved?.characters || cached.characters;
        cached.global = saved?.global || cached.global;
        cached.appearance = saved?.appearance || cached.appearance;
        cached.dirty = false;
      }
      if (t.lastScope?.sessionId === body.session_id && t._omniRosterRevision === revision) {
        t.charactersSession = saved?.characters || t.charactersSession;
        t.charactersGlobal = saved?.global || t.charactersGlobal;
        t.appearance = saved?.appearance || t.appearance;
        t._charsDirty = false;
      }
    });
    if (repaint) await P();
    await omniFlushLiveWrites();
  }
