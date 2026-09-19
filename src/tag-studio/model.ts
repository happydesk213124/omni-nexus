import { composeCharacterCaptionTags } from '../domain/character/tags.ts';
import { resolveCharacter } from '../domain/character/roster.ts';
import type { CharacterInput } from '../domain/character/identity.ts';
import { QUALITY_TAGS } from '../config/defaults.ts';
import { GLOBAL_SCOPE } from '../core/constants.ts';
import { cleanText, joinTags } from '../core/util/text.ts';
import { peelMain, peelStudioCharFields } from './peel.ts';

export const CHAR_SLOTS: Array<[number, number]> = [
  [0.3, 0.5], [0.7, 0.5], [0.5, 0.28], [0.22, 0.78], [0.78, 0.78], [0.5, 0.55],
];

export interface StudioChar {
  rosterId: string;
  charName: string;
  costume: string;
  costumeName: string;
  costumeTags: string;
  costumeNote: string;
  tags: string;
  post: string;
  uc: string;
  x: number;
  y: number;
  auto: boolean;
  lock: boolean;
  slim: Record<string, unknown>;
}

export interface StudioTab {
  id: string;
  kind: 'main' | 'llm' | 'char';
  label: string;
}

export interface StudioState {
  cardId: string;
  comic: boolean;
  sessionId: string;
  characterId: string;
  imageUrl: string;
  metaError: string;
  active: string;
  tabs: StudioTab[];
  main: {
    presetId: string;
    presetName: string;
    presetPrompt: string;
    post: string;
    neg: string;
    presetPane: 'pos' | 'neg';
    autoPerson: boolean;
    personMode: '' | 'off' | 'gender' | 'girls' | 'people';
    personWeight: string;
    personSolo: boolean;
    quality: boolean;
  };
  gen: {
    model: string;
    w: number;
    h: number;
    steps: string;
    cfg: number;
    rescale: number;
    sampler: string;
    scheduler: string;
    seed: number;
    seedLock: boolean;
  };
  llm: { presetId: string; presetName: string; cmd: string; cmdPost: string };
  chars: Record<string, StudioChar>;
  fold: Record<string, boolean>;
  history: Array<{ url: string; seed: number }>;
  historySel: number;
  coordMode: 'ai' | 'manual';
  coordVisible: boolean;
  leftFold: boolean;
  rightFold: boolean;
  peek: boolean;
  loop: boolean;
  busy: number;
  selChar: string;
}

export interface AssembledChar {
  no: number;
  name: string;
  prompt: string;
  uc: string;
  center_x: number;
  center_y: number;
  slim: Record<string, unknown>;
}

export interface Assembled {
  main: string;
  neg: string;
  chars: AssembledChar[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rosterList(payload: Record<string, unknown>): CharacterInput[] {
  const session = Array.isArray(payload.characters) ? payload.characters : [];
  const global = Array.isArray(payload.global) ? payload.global : [];
  return [...session, ...global].filter((c) => c && typeof c === 'object') as CharacterInput[];
}

export function emptyState(): StudioState {
  return {
    cardId: '',
    comic: false,
    sessionId: '',
    characterId: '',
    imageUrl: '',
    metaError: '',
    active: 'main',
    tabs: [
      { id: 'main', kind: 'main', label: 'main' },
      { id: 'llm', kind: 'llm', label: 'LLM 명령수정' },
    ],
    main: {
      presetId: '',
      presetName: '',
      presetPrompt: '',
      post: '',
      neg: '',
      presetPane: 'pos',
      autoPerson: false,
      personMode: '',
      personWeight: '',
      personSolo: false,
      quality: true,
    },
    gen: {
      model: '', w: 832, h: 1216, steps: '', cfg: 5, rescale: 0,
      sampler: '', scheduler: '', seed: 0, seedLock: false,
    },
    llm: { presetId: '', presetName: '', cmd: '', cmdPost: '' },
    chars: {},
    fold: {},
    history: [],
    historySel: -1,
    coordMode: 'ai',
    coordVisible: false,
    leftFold: false,
    rightFold: true,
    peek: false,
    loop: false,
    busy: 0,
    selChar: '',
  };
}

export function charList(state: StudioState): Array<StudioChar & { tab: StudioTab; i: number; id: string }> {
  return state.tabs
    .filter((t) => t.kind === 'char')
    .map((tab, i) => ({ tab, i, id: tab.id, ...state.chars[tab.id]! }))
    .filter((c) => c && state.chars[c.id]);
}

function personTag(state: StudioState): string {
  const m = state.main;
  if (!m.autoPerson || m.personMode === 'off' || !m.personMode) return '';
  const list = charList(state).filter((c) => c.rosterId || String(c.tags || '').trim() || String(c.post || '').trim());
  const n = list.length;
  if (!n) return '';
  const wrap = (t: string) => {
    const w = Number(m.personWeight);
    return Number.isFinite(w) && w >= 1 ? `${w}::${t}::` : t;
  };
  if (m.personSolo && n === 1) return wrap('solo');
  if (m.personMode === 'people') return wrap(`${n}people`);
  if (m.personMode === 'girls') return wrap(n === 1 ? '1girl' : `${n}girls`);
  return wrap(n === 1 ? '1girl' : `${n}people`);
}

/** One filled field is the file text — do not retokenize it. */
function joinOrRaw(...parts: unknown[]): string {
  const filled = parts.map((p) => (p == null ? '' : String(p))).filter((s) => s.trim());
  if (filled.length <= 1) return filled[0] || '';
  return joinTags(...parts);
}

function verbatimPrompt(value: unknown, limit: number): string {
  if (value == null) return '';
  return String(value).replace(/\x00/g, '').slice(0, limit);
}

function qualityTail(state: StudioState): string {
  if (!state.main.quality) return '';
  const model = state.gen.model || '';
  const key = Object.keys(QUALITY_TAGS).find((k) => model.toLowerCase().includes(k.replace('naid', '')))
    || (model.includes('nai-diffusion-4-5') || model.includes('4.5') ? 'naid4.5f' : '')
    || (model.includes('nai-diffusion-4') ? 'naid4f' : 'naid5f');
  return String(QUALITY_TAGS[key] || QUALITY_TAGS.naid5f || '').replace(/^,/, '').trim();
}

export function assemble(state: StudioState, _roster: CharacterInput[]): Assembled {
  const quality = qualityTail(state);
  const main = joinOrRaw(personTag(state), state.main.presetPrompt, state.main.post, quality);
  const chars = charList(state).map((c) => {
    if (state.comic) {
      const prompt = joinOrRaw(c.tags, c.post);
      if (!prompt) return null;
      return {
        no: c.i + 1,
        name: '',
        prompt,
        uc: c.uc,
        center_x: c.x,
        center_y: c.y,
        slim: { ...c.slim, center_x: c.x, center_y: c.y },
      };
    }
    const prompt = joinOrRaw(c.tags, c.costumeTags, c.post);
    if (!prompt && !String(c.uc || '').trim()) return null;
    return {
      no: c.i + 1,
      name: c.charName || '',
      prompt: prompt || 'girl',
      uc: c.uc,
      center_x: c.x,
      center_y: c.y,
      slim: {
        ...c.slim,
        name: c.charName || undefined,
        costume: c.costume || c.costumeName || undefined,
        action: c.post || undefined,
        center_x: c.x,
        center_y: c.y,
      },
    };
  }).filter((c): c is NonNullable<typeof c> => !!c && !!c.prompt);
  return { main, neg: state.main.neg, chars };
}

export function assembleOverrides(state: StudioState, roster: CharacterInput[]): Record<string, unknown> {
  const a = assemble(state, roster);
  return {
    main_prompt: a.main,
    negative_prompt: a.neg,
    characters: a.chars.map((c) => ({
      name: state.comic ? '' : c.name,
      prompt: c.prompt,
      uc: c.uc,
      center_x: state.coordMode === 'ai' ? undefined : c.center_x,
      center_y: state.coordMode === 'ai' ? undefined : c.center_y,
      ...(state.comic ? {} : {
        costume: c.slim.costume || undefined,
        action: c.slim.action || undefined,
      }),
    })),
    seed: state.gen.seedLock && state.gen.seed > 0 ? state.gen.seed : undefined,
    ...(state.gen.model ? { model: state.gen.model } : {}),
    width: state.gen.w,
    height: state.gen.h,
    ...(String(state.gen.steps || '').trim() ? { steps: state.gen.steps } : {}),
    cfg_scale: state.gen.cfg,
    cfg_rescale: state.gen.rescale,
    ...(state.gen.sampler ? { sampler: state.gen.sampler } : {}),
    ...(state.gen.scheduler ? { scheduler: state.gen.scheduler } : {}),
    use_coords: state.coordMode !== 'ai',
  };
}

/** Map PNG / settings model ids onto the two studio family buttons. */
export function studioModelChoice(raw: unknown): string {
  const s = cleanText(raw, 200).toLowerCase();
  if (!s) return '';
  if (s.includes('4-5') || s.includes('4.5') || s.includes('v4.5')) return 'nai-diffusion-4-5-full';
  if (s.includes('nai-diffusion-5') || s.includes('v5') || s.includes('nai diffusion 5')) {
    return 'nai-diffusion-5-full';
  }
  return cleanText(raw, 200);
}

export function hasPlacedCoords(chars: Array<{ center_x?: unknown; center_y?: unknown; x?: unknown; y?: unknown }>): boolean {
  return chars.some((c) => {
    const x = Number(c.center_x ?? c.x);
    const y = Number(c.center_y ?? c.y);
    return Number.isFinite(x) && Number.isFinite(y) && (x !== 0.5 || y !== 0.5);
  });
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

export function hydrateFromNai(args: {
  state: StudioState;
  nai: Record<string, unknown>;
  settings: Record<string, unknown>;
  rosterPayload: Record<string, unknown>;
  card: Record<string, unknown>;
}): void {
  const { state, nai, settings, rosterPayload, card } = args;
  const cardCfg = asRecord(settings.card);
  const presets = Array.isArray(cardCfg.presets) ? cardCfg.presets : [];
  const roster = rosterList(rosterPayload);
  const mainText = verbatimPrompt(nai.main_prompt, 8000);
  const peeled = peelMain(mainText, presets as Array<{ id?: unknown; name?: unknown; positive?: unknown; negative?: unknown }>);
  const hit = presets.find((p) => p && typeof p === 'object' && cleanText((p as Record<string, unknown>).id, 120) === peeled.preset.id) as Record<string, unknown> | undefined;
  if (peeled.preset.id) {
    state.main.presetId = peeled.preset.id;
    state.main.presetName = peeled.preset.name || cleanText(hit?.name, 200);
    state.main.presetPrompt = peeled.preset.positive || cleanText(hit?.positive, 8000);
    state.main.post = peeled.post;
    state.main.neg = peeled.preset.negative || verbatimPrompt(nai.negative_prompt, 8000);
    state.main.autoPerson = Boolean(peeled.person);
    state.main.personMode = peeled.personMode || '';
    state.main.personWeight = peeled.personWeight;
    state.main.personSolo = peeled.personSolo;
    state.main.quality = peeled.quality;
  } else {
    state.main.presetId = '';
    state.main.presetName = '';
    state.main.presetPrompt = '';
    state.main.post = mainText;
    state.main.neg = verbatimPrompt(nai.negative_prompt, 8000);
    state.main.autoPerson = false;
    state.main.personMode = '';
    state.main.personWeight = '';
    state.main.personSolo = false;
    state.main.quality = false;
  }

  const kind = cleanText(card.kind || asRecord(card.meta).kind, 20);
  state.comic = kind === 'comic';

  const rawChars = Array.isArray(nai.characters) ? nai.characters : [];
  state.chars = {};
  state.tabs = [
    { id: 'main', kind: 'main', label: 'main' },
    { id: 'llm', kind: 'llm', label: 'LLM 명령수정' },
  ];
  let slotNo = 0;
  rawChars.slice(0, 6).forEach((raw) => {
    const ch = asRecord(raw);
    const caption = verbatimPrompt(ch.prompt, 4000);
    const uc = verbatimPrompt(ch.uc, 2000);
    const rawName = state.comic ? '' : cleanText(ch.name, 200);
    if (!caption && !uc && !rawName) return;
    const id = nextId('c');
    const slot = CHAR_SLOTS[slotNo] || [0.5, 0.5];
    slotNo += 1;
    const stored = rawName ? resolveCharacter(rawName, roster) : null;
    const name = stored ? (stored.name || rawName) : '';
    const costumePick = ch.costume ?? asRecord(ch.raw).costume;
    const look = stored ? composeCharacterCaptionTags(stored, { costume: costumePick }) : '';
    const costumes = Array.isArray(stored?.costumes) ? stored.costumes : [];
    const cos = costumes.find((c) => cleanText(c.name, 200) === cleanText(costumePick, 200))
      || costumes[0];
    const peeledChar = state.comic
      ? { tags: caption, costumeTags: '', post: '' }
      : stored
        ? peelStudioCharFields({
          slim: ch,
          caption: ch.prompt,
          lookTags: look,
          costumeAttire: cos?.attire,
        })
        : { tags: '', costumeTags: '', post: caption };
    state.chars[id] = {
      rosterId: cleanText(stored?.id || stored?.name, 80),
      charName: name,
      costume: cleanText(cos?.name || costumePick, 200),
      costumeName: cleanText(cos?.name || costumePick, 200),
      costumeTags: peeledChar.costumeTags,
      costumeNote: cleanText(cos?.note, 400),
      tags: peeledChar.tags,
      post: peeledChar.post,
      uc,
      x: Number(ch.center_x ?? slot[0]),
      y: Number(ch.center_y ?? slot[1]),
      auto: false,
      lock: false,
      slim: { ...ch, prompt: undefined },
    };
    state.tabs.push({
      id,
      kind: 'char',
      label: state.comic ? `C${slotNo}` : `C${slotNo}${name ? ` ${name}` : ''}`,
    });
  });
  state.selChar = state.tabs.find((t) => t.kind === 'char')?.id || '';
  const model = studioModelChoice(nai.model);
  if (model) state.gen.model = model;
  const width = Math.floor(Number(nai.width));
  const height = Math.floor(Number(nai.height));
  if (Number.isFinite(width) && width >= 64) state.gen.w = width;
  if (Number.isFinite(height) && height >= 64) state.gen.h = height;
  if (nai.steps != null && nai.steps !== '') state.gen.steps = String(Math.floor(Number(nai.steps)) || '');
  const cfg = Number(nai.cfg_scale);
  if (Number.isFinite(cfg)) state.gen.cfg = cfg;
  const rescale = Number(nai.cfg_rescale);
  if (Number.isFinite(rescale)) state.gen.rescale = rescale;
  if (cleanText(nai.sampler, 80)) state.gen.sampler = cleanText(nai.sampler, 80);
  if (cleanText(nai.scheduler, 80)) state.gen.scheduler = cleanText(nai.scheduler, 80);
  const seed = Math.floor(Number(nai.seed));
  if (Number.isFinite(seed) && seed > 0) state.gen.seed = seed;
  const placed = hasPlacedCoords(Object.values(state.chars));
  if (placed) {
    state.coordMode = 'manual';
    state.coordVisible = true;
  }
  if (!state.comic && !rawChars.length) {
    /* illustration with no slots stays on main */
  }
}

export function mergedRoster(payload: Record<string, unknown>): CharacterInput[] {
  return rosterList(payload);
}

/** Session vs global is by id/scope — a shared display name is not enough. */
export function studioRowIsGlobal(
  row: CharacterInput | null | undefined,
  globals: unknown[],
): boolean {
  if (!row) return false;
  const scope = cleanText(row.scope, 200);
  if (scope === GLOBAL_SCOPE || scope === 'global') return true;
  const id = cleanText(row.id, 80);
  if (!id) return false;
  return globals.some((g) => {
    if (!g || typeof g !== 'object') return false;
    return cleanText((g as CharacterInput).id, 80) === id;
  });
}

function rowKey(row: CharacterInput): string {
  return cleanText(row.id, 80) || cleanText(row.name, 200);
}

/** Union session lists (first id wins). Last non-empty `global` list is kept. */
export function mergeStudioRosterPayloads(
  ...parts: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const seen = new Set<string>();
  const characters: CharacterInput[] = [];
  let global: unknown[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (Array.isArray(part.global) && part.global.length) global = part.global;
    const rows = Array.isArray(part.characters) ? part.characters : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as CharacterInput;
      const key = rowKey(row);
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      characters.push(row);
    }
  }
  return { characters, global };
}
