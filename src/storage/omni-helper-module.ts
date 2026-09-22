import { risuHost } from '../core/host';
import { serializeModuleWrite } from './module-write';
import { asShotAssetRows } from '../domain/gallery/shot-assets';

export const OMNI_HELPER_ID = 'omni-nexus-helper';
export const OMNI_HELPER_PROMPT = '이번 응답의 이야기와 대사를 모두 작성한 뒤, 상태창·요약·진행상황 같은 부가 내용 전에 별도 줄로 [[imgstart]]를 한 번 출력하세요. 생각·추론 구간에는 출력하지 마세요.';
const promptComment = 'omni-imgstart-prompt';
const regexComment = 'omni-imgstart-display';
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => asShotAssetRows(value).filter((v): v is Row => !!v && typeof v === 'object');

export function ensureOmniHelperModule(enabled: boolean): Promise<boolean> {
  return serializeModuleWrite(async () => {
    const host = risuHost();
    if (!host?.getDatabase || !host.setDatabase) return false;
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
    const regex = [...rows(previous.regex)];
    const regexIndex = regex.findIndex(row => row.comment === regexComment);
    const script = {comment:regexComment,in:'\\[\\[imgstart\\]\\]',out:'',type:'editdisplay',ableFlag:true,flag:'gi'};
    if (regexIndex < 0) regex.push(script); else regex[regexIndex] = script;
    const module = {...previous,id:OMNI_HELPER_ID,namespace:OMNI_HELPER_ID,name:'⚛️ omni 보조 프롬',hideIcon:false,lorebook,regex};
    if (index < 0) modules.push(module); else modules[index] = module;
    const current = asShotAssetRows(db.enabledModules);
    const next = current.filter(id => id !== OMNI_HELPER_ID);
    if (enabled) next.push(OMNI_HELPER_ID);
    if (JSON.stringify(db.modules) !== JSON.stringify(modules) || JSON.stringify(current) !== JSON.stringify(next)) {
      await host.setDatabase({modules:modules as never,enabledModules:next as string[]});
    }
    return true;
  });
}
