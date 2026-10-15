import { serializeModuleWrite } from './module-write';
import { messageControlsDisplayScript, messageControlsTrigger, MESSAGE_CONTROLS_COMMENT } from '../domain/message-controls';
import { measureWrite } from '../core/write-metrics';
/**
 * Ensures the Inray display-modify module exists and is enabled.
 * Display controls and regex — gallery bytes stay on ⚛️Omni Nexus 갤러리.
 */
import { dbg } from '../core/debug';
import { hostHas, risuHost } from '../core/host';
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

const displayOrders: Record<string, number> = { 'omni-image-history-display': -10010, 'omni-framed-asset-display': -10020, 'inray-shot-display': -10030, 'omni-spinner-display': -10040 };
function afterExternalRules<T extends {comment: string; flag: string}>(script: T): T {
  return { ...script, flag: `g<order ${displayOrders[script.comment]}>` };
}

let displayTail:Promise<unknown>=Promise.resolve();
const displayPending=new Map<string,Promise<boolean>>();
export function ensureInrayDisplayModule(folded = false, scalePct: unknown = 100, controls?: { enabled: boolean; userchat: boolean }): Promise<boolean> {
  const key=JSON.stringify([folded,scalePct,controls]);
  const existing=displayPending.get(key);if(existing)return existing;
  const pending=displayTail.then(()=>updateInrayDisplayModule(folded,scalePct,controls));
  displayPending.set(key,pending);displayTail=pending.catch(()=>false);
  void pending.finally(()=>displayPending.delete(key));return pending;
}
async function updateInrayDisplayModule(folded = false, scalePct: unknown = 100, controls?: { enabled: boolean; userchat: boolean }): Promise<boolean> {
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
    const wanted = afterExternalRules(inrayDisplayRegexScript(folded, scalePct));
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
    const strip = requestMarkerStripScript();
    const stripRegex = [...(modules[idx]!.regex || [])];
    const stripIndex = stripRegex.findIndex(row => scriptComment(row) === strip.comment);
    if (stripIndex < 0 || JSON.stringify(stripRegex[stripIndex]) !== JSON.stringify(strip)) {
      if (stripIndex < 0) stripRegex.push(strip); else stripRegex[stripIndex] = strip;
      modules[idx] = { ...modules[idx], regex: stripRegex }; changed = true;
    }
    const spinner=afterExternalRules(spinnerDisplayRegexScript(scalePct));
    const regex=[...(modules[idx]!.regex || [])];
    const spinnerIndex=regex.findIndex(row=>scriptComment(row)===spinner.comment);
    if(spinnerIndex<0 || JSON.stringify(regex[spinnerIndex])!==JSON.stringify(spinner)) {
      if(spinnerIndex<0)regex.push(spinner);else regex[spinnerIndex]=spinner;
      modules[idx]={...modules[idx],regex};changed=true;
    }
    const pair = afterExternalRules(framedAssetDisplayRegexScript(folded,scalePct));
    const history = afterExternalRules(historyDisplayRegexScript(folded, scalePct));
    const paired = [history, pair,...(modules[idx]!.regex || []).filter(row=>scriptComment(row)!==pair.comment && scriptComment(row)!==history.comment)];
    const late = paired.filter(row => scriptComment(row) !== 'omni-message-controls-display').map(row => {
      const order = displayOrders[scriptComment(row)];
      return order === undefined ? row : { ...(row as Record<string, unknown>), ableFlag: true, flag: `g<order ${order}>` };
    });
    late.push(messageControlsDisplayScript());
    if(JSON.stringify(late)!==JSON.stringify(modules[idx]!.regex)) {
      modules[idx]={...modules[idx],regex:late};changed=true;
    }
    const triggers = [...(modules[idx]!.trigger || [])];
    const controlIndex = triggers.findIndex(row => scriptComment(row) === MESSAGE_CONTROLS_COMMENT);
    const control = controls ? messageControlsTrigger(controls.enabled, controls.userchat) : controlIndex < 0 ? messageControlsTrigger(false, false) : triggers[controlIndex];
    if (controlIndex < 0 || JSON.stringify(triggers[controlIndex]) !== JSON.stringify(control)) {
      if (controlIndex < 0) triggers.push(control); else triggers[controlIndex] = control;
      modules[idx] = {...modules[idx], trigger: triggers}; changed = true;
    }
    const enabled = asShotAssetRows(db.enabledModules).map((row) => cleanText(row, 200)).filter(Boolean);
    if (!enabled.includes(INRAY_DISPLAY_MODULE_ID) && !enabled.includes(INRAY_DISPLAY_MODULE_NS)) {
      enabled.push(INRAY_DISPLAY_MODULE_ID);
      changed = true;
    }
    if (!changed) return true;
    await measureWrite('module','display',()=>host.setDatabase!({ modules: modules as never, enabledModules: enabled as string[] }));
    return true;
  } catch (err) {
    dbg('inray-display.ensure.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return false;
  }
  });
}
