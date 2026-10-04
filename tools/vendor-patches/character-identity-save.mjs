/** Names are drafts until change/blur; a debounce is not an editing boundary. */
export function repairCharacterIdentitySave(source) {
  let out = source;
  const replace = (needle, patch) => {
    if (out.split(needle).length !== 2) throw new Error('[character identity save] needle drift: ' + needle.slice(0, 100));
    out = out.replace(needle, patch);
  };
  const inputSeams = out.match(/    shell.addEventListener\("input", event => \{\n(?:      if\(event.isComposing\)return;\n)?      const field = event.target;/g);
  if (inputSeams?.length !== 1) throw new Error('[character identity save] input handler needle drift');
  replace(inputSeams[0], `    const identityFields = "[data-char-name],[data-char-surname],[data-char-given],[data-char-surname-variants],[data-char-given-variants],[data-char-aliases]";
    shell.addEventListener("change", event => {
      const field = event.target;
      if (field?.closest?.(".char-card[data-char-id]") && field.matches(identityFields)) {
        field.dispatchEvent(new CustomEvent("input", {bubbles:true, detail:{omniIdentityCommit:true}}));
      }
    });
${inputSeams[0]}`);
  replace('      if (field?.closest?.(".char-card[data-char-id]")) {', `      if (field?.closest?.(".char-card[data-char-id]")) {
        if (event.isComposing) return;`);
  replace('        enqueue("characters:" + scope.sessionId, async () => {', `        if (!event.detail?.omniIdentityCommit && (field.matches(identityFields) || document.activeElement?.matches?.(identityFields))) {
          const key = "characters:" + scope.sessionId;
          if (live.timers.has(key)) clearTimeout(live.timers.get(key));
          live.timers.delete(key); live.pending.delete(key);
          return;
        }
        enqueue("characters:" + scope.sessionId, async () => {`);
  replace('          await K("/v1/characters", { method: "POST", body });', '          const saved = await K("/v1/characters", { method: "POST", body });');
  const markedClean = '          if(cached?.revision===revision){cached.dirty=false;if(t.lastScope?.sessionId===scope.sessionId && t._omniRosterRevision===revision)t._charsDirty=false;}';
  replace(markedClean, `${markedClean}
          if (cached?.revision===revision && t.lastScope?.sessionId===scope.sessionId && Array.isArray(saved?.characters)) {
            const sheet=document.getElementById("nx-char-edit-body");
            for (const [kind,rows] of [["session",saved.characters],["global",saved.global || []]]) for (const row of rows) {
              const nodes=[...document.querySelectorAll(".char-card[data-char-id]")].filter(node=>node.dataset.charId===row.id && node.dataset.charScope===kind);
              if(sheet?.dataset.selectedId===row.id && document.getElementById("nx-char-scope-bar")?.dataset.uxSelectedScope===kind)nodes.push(sheet);
              for(const node of nodes) {
                const select=node.querySelector("[data-char-costume]");
                for(const option of select?.options || []) {
                  if(option.value==="__add__")continue;
                  const costume=row.costumes?.[Number(option.value)];
                  if(costume) {option.setAttribute("data-note",costume.note || "");option.textContent=costume.name+"["+option.value+"]"+(costume.note?" · "+costume.note:"");}
                }
                const note=node.querySelector("[data-char-costume-note]");
                const costume=row.costumes?.[Number(select?.value || row.active_costume || 0)];
                if(note && costume)note.value=costume.note || "";
              }
            }
          }
          if (cached?.revision===revision && Array.isArray(saved?.characters) && saved.characters.length < body.characters.length) {
            cached.characters=saved.characters; cached.global=saved.global || cached.global;
            if(t.lastScope?.sessionId===scope.sessionId && t._omniRosterRevision===revision) {
              t.charactersSession=cached.characters; t.charactersGlobal=cached.global; await P();
            }
          }`);
  return out;
}
