import { risuHost, writeHostDatabase } from '../core/host';
import { moduleCurrent, moduleMark, noteModuleMark, serializeModuleWrite } from './module-write';
import { asShotAssetRows } from '../domain/gallery/shot-assets';
import { isTokenGuardComment, tokenGuardScripts, TOKEN_GUARD_ORDER } from '../domain/inray-display';

export const OMNI_HELPER_ID = 'omni-nexus-helper';
// In English, as every other instruction of ours: the same rule in fewer tokens than the Korean it was.
export const OMNI_HELPER_PROMPT = 'After all of the story and dialogue, before any status panel, summary or progress notes, write [[imgstart]] once on a line of its own. Never in thinking or reasoning.';
const promptComment = 'omni-imgstart-prompt';
const regexComment = 'omni-imgstart-display';
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => asShotAssetRows(value).filter((v): v is Row => !!v && typeof v === 'object');

export function ensureOmniHelperModule(enabled: boolean): Promise<boolean> {
  return serializeModuleWrite(async () => {
    const host = risuHost();
    if (!host?.getDatabase || !host.setDatabase) return false;
    // Already as it would be written, and switched as wanted: no read of every module (module-write).
    const mark = moduleMark([OMNI_HELPER_PROMPT, promptComment, regexComment, TOKEN_GUARD_ORDER, tokenGuardScripts()]);
    if (await moduleCurrent(OMNI_HELPER_ID, mark, enabled)) return true;
    if (host.requestPluginPermission) await host.requestPluginPermission('db');
    const db = await host.getDatabase(['modules', 'enabledModules']);
    if (!db) return false;
    const modules = rows(db.modules);
    const index = modules.findIndex(m => m.id === OMNI_HELPER_ID || m.namespace === OMNI_HELPER_ID);
    const previous = index < 0 ? {} : modules[index]!;
    const lorebook = [...rows(previous.lorebook)];
    const loreIndex = lorebook.findIndex(row => row.comment === promptComment);
    const prompt = {key:'',secondkey:'',comment:promptComment,content:OMNI_HELPER_PROMPT,mode:'normal',insertorder:100,alwaysActive:true,selective:false};
    if (loreIndex < 0) lorebook.push(prompt); else lorebook[loreIndex] = {...lorebook[loreIndex], ...prompt};
    // Right after the token guard gives the marker its brackets back.
    const script = {comment:regexComment,in:'\\[\\[imgstart\\]\\]',out:'',type:'editdisplay',ableFlag:true,flag:`gi<order ${TOKEN_GUARD_ORDER.unguard - 1}>`};
    // A fixed order (a user's rules, then ours), so an unchanged module is never rewritten.
    const regex = [...rows(previous.regex).filter(row => row.comment !== regexComment && !isTokenGuardComment(row.comment)), script, ...tokenGuardScripts()];
    const module = {...previous,id:OMNI_HELPER_ID,namespace:OMNI_HELPER_ID,name:'⚛️ omni 보조 프롬',hideIcon:false,lorebook,regex};
    if (index < 0) modules.push(module); else modules[index] = module;
    const current = asShotAssetRows(db.enabledModules);
    const next = current.filter(id => id !== OMNI_HELPER_ID);
    if (enabled) next.push(OMNI_HELPER_ID);
    if (JSON.stringify(db.modules) !== JSON.stringify(modules) || JSON.stringify(current) !== JSON.stringify(next)) {
      await writeHostDatabase({modules:modules as never,enabledModules:next as string[]});
    }
    await noteModuleMark(OMNI_HELPER_ID, mark);
    return true;
  });
}
