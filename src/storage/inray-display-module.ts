import { moduleCurrent, moduleMark, noteModuleMark, serializeModuleWrite } from './module-write';
import { messageControlsCss, messageControlsDisplayScript, messageControlsRules, MESSAGE_CONTROLS_COMMENT } from '../domain/message-controls';
import { measureWrite } from '../core/write-metrics';
/**
 * Ensures the Inray display-modify module exists and is enabled.
 * Display controls and regex — gallery bytes stay on ⚛️Omni Nexus 갤러리.
 */
import { dbg } from '../core/debug';
import { hostHas, risuHost, writeHostDatabase } from '../core/host';
import { sleep } from '../core/util/async';
import { cleanText } from '../core/util/text';
import {
  INRAY_DISPLAY_MODULE_ID,
  INRAY_DISPLAY_MODULE_NAME,
  INRAY_DISPLAY_MODULE_NS,
  INRAY_DISPLAY_SCRIPT_COMMENT,
  inrayDisplayRegexScript,
  spinnerDisplayRegexScript,
  framedAssetDisplayRegexScript,
  historyDisplayRegexScript,
  requestMarkerStripScript,
  waitDisplayRegexScript,
  waitBlockDisplayScripts,
  waitBlockRequestScript,
  tokenGuardScripts,
  chatDisplayCss,
  moduleRule,
  quietFlag,
} from '../domain/inray-display';
import { asShotAssetRows } from '../domain/gallery/shot-assets';

type ModuleRow = {
  id?: string;
  name?: string;
  description?: string;
  namespace?: string;
  hideIcon?: boolean;
  lorebook?: unknown[];
  regex?: unknown[];
  assets?: unknown[];
  trigger?: unknown[];
  backgroundEmbedding?: string;
};

/** Older builds asked the model not to imitate markers; the request regex removes them instead. */
const displayMarkerLoreComment = 'omni-display-marker-instructions';

function readModules(db: { modules?: unknown }): ModuleRow[] {
  return asShotAssetRows(db.modules).filter((row) => row && typeof row === 'object') as ModuleRow[];
}

function findModuleIndex(modules: ModuleRow[]): number {
  return modules.findIndex(
    (m) =>
      cleanText(m?.id, 80) === INRAY_DISPLAY_MODULE_ID ||
      cleanText(m?.namespace, 80) === INRAY_DISPLAY_MODULE_NS,
  );
}

function scriptComment(row: unknown): string {
  if (!row || typeof row !== 'object') return '';
  return cleanText((row as { comment?: unknown }).comment, 80);
}

const displayOrders: Record<string, number> = { 'omni-image-history-display': -10010, 'omni-framed-asset-display': -10020, 'inray-shot-display': -10030, 'omni-spinner-display': -10040, 'omni-wait-display': -10045 };
const orderFlag = (order: number): string => quietFlag(`g<order ${order}>`);
function afterExternalRules<T extends {comment: string; flag: string}>(script: T): T {
  return { ...script, flag: orderFlag(displayOrders[script.comment]!) };
}
/** The module's one stylesheet: every picture's and the message row's (see `chatDisplayCss`). */
export function displayModuleCss(scalePct: unknown, rowFolded: boolean): string {
  return `<style>${chatDisplayCss(scalePct)}${messageControlsCss(rowFolded)}</style>`;
}

let displayTail:Promise<unknown>=Promise.resolve();
const displayPending=new Map<string,Promise<boolean>>();
type MessageControls = { enabled: boolean; userchat: boolean; folded?: boolean };
export function ensureInrayDisplayModule(folded = false, scalePct: unknown = 100, controls?: MessageControls): Promise<boolean> {
  const key=JSON.stringify([folded,scalePct,controls]);
  const existing=displayPending.get(key);if(existing)return existing;
  const pending=displayTail.then(async()=>{
    // Written before as it would be written now, and still switched on: every module in Risu is not read to learn
    // that. (It was, at every start and before every bake.)
    const mark=controls ? displayMark(folded,scalePct,controls) : '';
    if(mark && await moduleCurrent([INRAY_DISPLAY_MODULE_ID,INRAY_DISPLAY_MODULE_NS],mark,true)) return true;
    const ok=await updateInrayDisplayModule(folded,scalePct,controls);
    if(ok && mark) await noteModuleMark(INRAY_DISPLAY_MODULE_ID,mark);
    return ok;
  });
  displayPending.set(key,pending);displayTail=pending.catch(()=>false);
  void pending.finally(()=>displayPending.delete(key));return pending;
}
/** Everything of ours the module holds for these settings: equal when nothing would be written. */
function displayMark(folded: boolean, scalePct: unknown, controls: MessageControls): string {
  return moduleMark([
    [inrayDisplayRegexScript(folded, scalePct), requestMarkerStripScript(), spinnerDisplayRegexScript(scalePct), waitDisplayRegexScript(scalePct),
      ...waitBlockDisplayScripts(scalePct), waitBlockRequestScript(), ...tokenGuardScripts(), framedAssetDisplayRegexScript(folded, scalePct),
      historyDisplayRegexScript(folded, scalePct), messageControlsDisplayScript(controls.folded === true)].map(moduleRule),
    messageControlsRules(controls.enabled, controls.userchat), displayOrders, displayModuleCss(scalePct, controls.folded === true),
  ]);
}
async function updateInrayDisplayModule(folded = false, scalePct: unknown = 100, controls?: MessageControls): Promise<boolean> {
  if (!hostHas('getDatabase') || !hostHas('setDatabase')) return false;
  const host = risuHost();
  if (!host?.getDatabase || !host.setDatabase) return false;
  return serializeModuleWrite(async () => {
  try {
    if (typeof host.requestPluginPermission === 'function') {
      try {
        await host.requestPluginPermission('db');
      } catch {
        /* older hosts */
      }
    }
    const db = await host.getDatabase!(['modules', 'enabledModules']);
    if (!db) return false;
    const modules = readModules(db);
    const wanted = moduleRule(afterExternalRules(inrayDisplayRegexScript(folded, scalePct)));
    let idx = findModuleIndex(modules);
    let changed = false;
    if (idx < 0) {
      modules.push({
        id: INRAY_DISPLAY_MODULE_ID,
        name: INRAY_DISPLAY_MODULE_NAME,
        description: '채팅에 박제한 Inray 그림을 가운데 정렬하고 전체화면 버튼을 붙입니다.',
        namespace: INRAY_DISPLAY_MODULE_NS,
        hideIcon: false,
        lorebook: [],
        assets: [],
        regex: [wanted],
      });
      idx = modules.length - 1;
      changed = true;
    } else {
      const cur = modules[idx]!;
      const regex = Array.isArray(cur.regex) ? [...cur.regex] : [];
      const hit = regex.findIndex((row) => scriptComment(row) === INRAY_DISPLAY_SCRIPT_COMMENT);
      const nextJson = JSON.stringify(wanted);
      const prevJson = hit >= 0 ? JSON.stringify(regex[hit]) : '';
      if (hit < 0) {
        regex.push(wanted);
        changed = true;
      } else if (prevJson !== nextJson) {
        regex[hit] = wanted;
        changed = true;
      }
      if (
        cur.hideIcon ||
        cur.id !== INRAY_DISPLAY_MODULE_ID ||
        cur.namespace !== INRAY_DISPLAY_MODULE_NS ||
        cur.name !== INRAY_DISPLAY_MODULE_NAME
      ) {
        changed = true;
      }
      if (changed) {
        modules[idx] = {
          ...cur,
          id: INRAY_DISPLAY_MODULE_ID,
          name: INRAY_DISPLAY_MODULE_NAME,
          namespace: INRAY_DISPLAY_MODULE_NS,
          hideIcon: false,
          regex,
        };
      }
    }
    const lorebook = Array.isArray(modules[idx]!.lorebook) ? [...modules[idx]!.lorebook!] : [];
    // Only our own retired entry goes; a user's lore in this module stays.
    if (lorebook.some((row) => scriptComment(row) === displayMarkerLoreComment)) {
      modules[idx] = { ...modules[idx], lorebook: lorebook.filter((row) => scriptComment(row) !== displayMarkerLoreComment) };
      changed = true;
    }
    const strip = moduleRule(requestMarkerStripScript());
    const stripRegex = [...(modules[idx]!.regex || [])];
    const stripIndex = stripRegex.findIndex(row => scriptComment(row) === strip.comment);
    if (stripIndex < 0 || JSON.stringify(stripRegex[stripIndex]) !== JSON.stringify(strip)) {
      if (stripIndex < 0) stripRegex.push(strip); else stripRegex[stripIndex] = strip;
      modules[idx] = { ...modules[idx], regex: stripRegex }; changed = true;
    }
    const spinner=moduleRule(afterExternalRules(spinnerDisplayRegexScript(scalePct)));
    const regex=[...(modules[idx]!.regex || [])];
    const spinnerIndex=regex.findIndex(row=>scriptComment(row)===spinner.comment);
    if(spinnerIndex<0 || JSON.stringify(regex[spinnerIndex])!==JSON.stringify(spinner)) {
      if(spinnerIndex<0)regex.push(spinner);else regex[spinnerIndex]=spinner;
      modules[idx]={...modules[idx],regex};changed=true;
    }
    // Waiting slots outlive the streaming-tag switch: old replies keep a tappable pink frame.
    const wait=moduleRule(afterExternalRules(waitDisplayRegexScript(scalePct)));
    const waitRegex=[...(modules[idx]!.regex || [])];
    const waitIndex=waitRegex.findIndex(row=>scriptComment(row)===wait.comment);
    if(waitIndex<0 || JSON.stringify(waitRegex[waitIndex])!==JSON.stringify(wait)) {
      if(waitIndex<0)waitRegex.push(wait);else waitRegex[waitIndex]=wait;
      modules[idx]={...modules[idx],regex:waitRegex};changed=true;
    }
    // Waiting blocks keep their JSON in the message: drawn pink, and stripped from requests.
    for (const script of [...waitBlockDisplayScripts(scalePct), waitBlockRequestScript(), ...tokenGuardScripts()].map(moduleRule)) {
      const rows = [...(modules[idx]!.regex || [])], at = rows.findIndex(row => scriptComment(row) === script.comment);
      if (at < 0 || JSON.stringify(rows[at]) !== JSON.stringify(script)) {
        if (at < 0) rows.push(script); else rows[at] = script;
        modules[idx] = { ...modules[idx], regex: rows }; changed = true;
      }
    }
    const pair = moduleRule(afterExternalRules(framedAssetDisplayRegexScript(folded,scalePct)));
    const history = moduleRule(afterExternalRules(historyDisplayRegexScript(folded, scalePct)));
    const paired = [history, pair,...(modules[idx]!.regex || []).filter(row=>scriptComment(row)!==pair.comment && scriptComment(row)!==history.comment)];
    // A write that does not say how the row is (no controls) keeps it folded or not, as the module has it.
    const shownRow = paired.find(row => scriptComment(row) === 'omni-message-controls-display') as { out?: unknown } | undefined;
    const rowFolded = controls ? controls.folded === true : String(shownRow?.out ?? '').includes('data-omni-folded');
    // The rules that say where the row goes (messageControlsRules): as the settings have them, or as the module
    // has them when this write does not say.
    const placing = (row: unknown) => { const name = scriptComment(row); return name.startsWith('omni-message-controls-') && name !== 'omni-message-controls-display'; };
    const places = controls ? messageControlsRules(controls.enabled, controls.userchat).map(moduleRule) : paired.filter(placing);
    const late = paired.filter(row => scriptComment(row) !== 'omni-message-controls-display' && !placing(row)).map(row => {
      const order = displayOrders[scriptComment(row)];
      return order === undefined ? row : { ...(row as Record<string, unknown>), ableFlag: true, flag: orderFlag(order) };
    });
    late.push(moduleRule(messageControlsDisplayScript(rowFolded)), ...places);
    if(JSON.stringify(late)!==JSON.stringify(modules[idx]!.regex)) {
      modules[idx]={...modules[idx],regex:late};changed=true;
    }
    // The sheet the rules above no longer carry: once here, for the whole chat screen.
    const sheet = displayModuleCss(scalePct, rowFolded);
    if (modules[idx]!.backgroundEmbedding !== sheet) { modules[idx] = { ...modules[idx], backgroundEmbedding: sheet }; changed = true; }
    // The Lua trigger that used to place the row is retired with the rules above in its place: Risu ran it for
    // every message drawn and every streamed chunk, switched on or not. Ours goes; a trigger of the user's stays.
    const triggers = modules[idx]!.trigger || [];
    if (controls && triggers.some(row => scriptComment(row) === MESSAGE_CONTROLS_COMMENT)) {
      modules[idx] = {...modules[idx], trigger: triggers.filter(row => scriptComment(row) !== MESSAGE_CONTROLS_COMMENT)}; changed = true;
    }
    const before = asShotAssetRows(db.enabledModules).map((row) => cleanText(row, 200)).filter(Boolean);
    const ours = (id: string) => id === INRAY_DISPLAY_MODULE_ID || id === INRAY_DISPLAY_MODULE_NS;
    const wasOn = before.some(ours);
    const enabled = wasOn ? before : [...before, INRAY_DISPLAY_MODULE_ID];
    if (!changed && wasOn) return true;
    await measureWrite('module','display',async()=>{
      // Risu keeps the modules that are on by the list of their ids (getModules): rewritten under the same ids, the
      // new rules and stylesheet would wait for the next start, while the page's copy of the sheet
      // (image-ui/display-css) is already the new one. Off for a frame, as ⚛️ omni tts and 스트리밍태그 do theirs.
      if (changed && wasOn) {
        await writeHostDatabase({ modules: modules as never, enabledModules: before.filter(id => !ours(id)) });
        await sleep(16);
        await writeHostDatabase({ enabledModules: enabled });
      } else await writeHostDatabase({ modules: modules as never, enabledModules: enabled });
    });
    return true;
  } catch (err) {
    dbg('inray-display.ensure.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return false;
  }
  });
}
