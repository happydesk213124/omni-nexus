import { readFileSync } from 'node:fs';

/** Manual saves/imports share the live queue and its newer-edit ownership. */
export function repairCharacterRosterSave(source) {
  let out = source;
  const replace = (needle, patch) => {
    if (out.split(needle).length !== 2) throw new Error('[character roster save] needle drift: ' + needle.slice(0,100));
    out = out.replace(needle, () => patch);
  };
  const region = (start, end, patch) => {
    const a=out.indexOf(start), b=out.indexOf(end,a);
    if(a<0 || b<0 || out.indexOf(start,a+1)>=0)throw new Error('[character roster save] region drift: '+start);
    out=out.slice(0,a)+patch+out.slice(b);
  };
  region('  async function importCharactersFromFile(file, preferScope) {', '  function wt(', `
${readFileSync(new URL('./character-roster-save.js',import.meta.url),'utf8')}
  async function importCharactersFromFile(file, preferScope) {
    const scope = t.lastScope || await Z();
    const parsed = parseCharactersImportJson(await file.text(), preferScope);
    if (t.lastScope?.sessionId !== scope.sessionId) throw new Error("불러오는 동안 선택한 봇이 바뀌었습니다");
    const rows = {};
    if (Array.isArray(parsed.session)) rows.characters = mergeCharacterLists(oe("session"), parsed.session);
    if (Array.isArray(parsed.global)) rows.global = mergeCharacterLists(oe("global"), parsed.global);
    if (!("characters" in rows) && !("global" in rows)) throw new Error("가져올 캐릭터가 없습니다");
    await omniSaveCharacterRows(scope, rows, true);
    return {sessionCount:rows.characters?.length || 0, globalCount:rows.global?.length || 0};
  }
`);
  for(const [id,kind,next] of [['nx-save-chars','session','nx-save-global-chars'],['nx-save-global-chars','global','nx-export-session-chars']]) {
    region(`document.getElementById("${id}")?.addEventListener("click", async () => {`, `document.getElementById("${next}")`, `document.getElementById("${id}")?.addEventListener("click", async () => {
      try {
        const scope = t.lastScope || await Z();
        await omniSaveCharacterRows(scope, {${kind==='session'?'characters':'global'}:oe("${kind}")});
        t.uiMessage = {type:"success", text:"캐릭터 저장됨"};
      } catch (error) { t.uiMessage = {type:"error", text:z(error?.message || error)}; }
      await P();
    }), `);
  }
  // The UI cache and an in-flight request must not share nested costume arrays.
  replace('        enqueue("characters:" + scope.sessionId, async () => {', '        const snapshot = JSON.parse(JSON.stringify(body));\n        enqueue("characters:" + scope.sessionId, async () => {');
  replace('          const saved = await K("/v1/characters", { method: "POST", body });', '          const saved = await K("/v1/characters", { method: "POST", body: snapshot });');
  return out;
}
