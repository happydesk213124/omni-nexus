import type { TtsSettings } from '../../core/tts-types';

export const OMNI_TTS_MODULE = 'omni-tts';
export const TTS_CUE_PROMPT = `@@depth 0
<OmniTTS>
For spoken dialogue only, write one complete cue per line: Name (delivery): "Dialogue"
Use the established full speaker name consistently. Do not invent identity or gender.
Write delivery in short English Fish Audio cues, e.g. happy, sad, angry, calm, curious, soft tone, whispering. Use calm for neutral delivery.
Keep both quotation marks on the same line. Narration remains plain prose without a speaker or delivery prefix.
Never label code, thoughts, images or status panels as spoken dialogue. Preserve the story language.
</OmniTTS>`;

export function ttsModule(settings: Pick<TtsSettings, 'hideName' | 'hideTone' | 'narration' | 'illustration' | 'passageLine'>) {
  const css = `[data-omnitts-line]{position:relative;border-left:2px solid transparent;padding-left:4px}[data-omnitts-line]:has(button:hover){border-color:${settings.passageLine ? '#a38adb35' : 'transparent'}}[data-omnitts-play]{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;min-width:36px;min-height:36px;padding:4px;margin-left:4px;border:1px solid #8262bb55;border-radius:8px;background:#22192f99;color:#c6afff;cursor:pointer}[data-omnitts-play]:hover{background:#7132f566;border-color:#a483fb}[data-omnitts-play]:active{background:#7132f5}[data-omnitts-speaker]{${settings.hideName ? 'display:none' : 'font-size:.8em;color:#aa93d0'}}[data-omnitts-tone]{${settings.hideTone ? 'display:none' : 'font-size:.8em;color:#aa93d0'}}[data-omnitts-kind="narration"] [data-omnitts-play]{${settings.narration ? '' : 'display:none'}}[data-omnitts-image]{display:${settings.illustration ? 'flex' : 'none'};align-items:center;gap:6px;max-width:100%;overflow-x:auto}[data-omnitts-image] [data-omnitts-cast]{display:flex;gap:6px}[data-omnitts-kind="narration"]{color:inherit}`;
  // Rendering only: no API calls, playback, storage, timers, or mutation of chat data.
  // Lua scans each line once, avoiding backtracking over partially streamed messages.
  const code = `listenEdit("editDisplay", function(tid, data, meta)
  if not data or not meta or type(meta.index) ~= "number" or meta.index < 0 then return data end
  if getChatRole(tid, meta.index) ~= "char" then return data end
  if data:find('data-omnitts-line=', 1, true) or data:find('OMNITTS', 1, true) then return data end
  local function trim(s) return (s:gsub('^%s+', ''):gsub('%s+$', '')) end
  local function linekey(s)
    local a, b = 0.0, 0.0
    for i = 1, #s do local byte = s:byte(i); a = (a * 131.0 + byte) % 2147483647.0; b = (b * 137.0 + byte) % 2147483629.0 end
    return string.format('%.0f-%.0f', a, b)
  end
  local function response(line)
    local title = line:match('^#[*%s]*(.-)[*%s]*$')
    return title == 'Response' or title == '응답' or title == '応答' or title == '响应' or title == 'OOC'
  end
  local before = false
  for line in (data .. "\\n"):gmatch("([^\\n]*)\\n") do if response(trim(line)) then before = true; break end end
  local out, index, fence, html, hidden, post = {}, 0, false, false, nil, false
  for line in (data .. "\\n"):gmatch("([^\\n]*)\\n") do
    index = index + 1
    local rendered, trimmed = line, trim(line)
    local lower = trimmed:lower()
    for _, tag in ipairs({'thoughts', 'think', 'analysis', 'reasoning'}) do
      if lower:sub(1, #tag + 1) == '<' .. tag and (lower:sub(#tag + 2, #tag + 2) == '>' or lower:sub(#tag + 2, #tag + 2):match('%s')) then hidden = tag end
    end
    if trimmed:match('^#[*%s]*Post%-response') or trimmed:match('^#[*%s]*사후응답') or trimmed:match('^#[*%s]*事後応答') then post = true end
    if before or hidden or post then
      if response(trimmed) then before = false end
      if hidden and lower:find('</' .. hidden .. '>', 1, true) then hidden = nil end
    elseif trimmed:sub(1, 3) == '\x60\x60\x60' or trimmed:sub(1, 3) == '~~~' then
      fence = not fence
    elseif not fence then
      if trimmed:sub(1, 1) == '<' then html = true end
      if trimmed == '' then html = false end
      if not html and #line <= 24000 and trimmed ~= '' and not line:find('OMNI', 1, true) and not line:find('[<>]') and not line:find('{{', 1, true) and not line:find('[[@', 1, true) and not trimmed:match('^[|#!]') then
        local name, tone, speech = nil, nil, nil
        local opening = trimmed:find('(', 1, true)
        local closing = opening and trimmed:find(')', opening + 1, true)
        if opening and closing and opening <= 241 and closing - opening <= 101 then
          local candidate = trim(trimmed:sub(closing + 1))
          if candidate:sub(1, 1) == ':' then candidate = trim(candidate:sub(2)) end
          if candidate:sub(1, 1) == '"' and candidate:sub(-1) == '"' then speech = candidate:sub(2, -2)
          elseif candidate:sub(1, 3) == '“' and candidate:sub(-3) == '”' then speech = candidate:sub(4, -4) end
          if speech then
            name, tone = trim(trimmed:sub(1, opening - 1)), trimmed:sub(opening + 1, closing - 1)
            if tone:find('[^a-zA-Z ,%-]') or name == '' then name = nil end
          end
        end
        local kind, content = 'narration', line
        if name and #name <= 240 and #tone <= 100 and speech ~= '' then
          kind = 'dialogue'
          content = ${settings.hideName ? "''" : "name .. ' '"} .. ${settings.hideTone ? "''" : "'(' .. tone .. ') '"} .. '“' .. speech .. '”'
        else
          -- Unfinished cues must never become narration while streaming.
          if line:find('%(') or line:find('"', 1, true) or line:find('“', 1, true) then kind = nil end
          content = line
        end
        if kind then
          rendered = 'OMNITTS' .. meta.index .. 'L' .. index .. 'H' .. linekey(trimmed) .. (kind == 'dialogue' and 'D' or 'N') .. '' .. content .. 'OMNITTS'
        end
      end
    end
    table.insert(out, rendered)
  end
  local result = table.concat(out, "\\n")
  return result
end)`;
  return {
    id: OMNI_TTS_MODULE, namespace: OMNI_TTS_MODULE, name: 'OmniTTS',
    description: '이름·영문 억양 규칙과 채팅 재생 버튼. 음성 처리는 Omni Nexus 플러그인이 담당합니다.',
    hideIcon: false, lowLevelAccess: false, assets: [], backgroundEmbedding: `<style>${css}[data-inlay-inline-shot]:has(>[data-omnitts-image]){display:flex;flex-direction:column}[data-omnitts-image]{order:2}</style>`,
    lorebook: [{ key: '', secondkey: '', comment: 'omnitts-cues', content: TTS_CUE_PROMPT, mode: 'normal', insertorder: 999, alwaysActive: true, selective: false, useRegex: false, bookVersion: 2 }],
    trigger: [{ comment: 'omnitts-display-only', type: 'start', conditions: [], lowLevelAccess: false, effect: [{ type: 'triggerlua', code }] }],
    regex: [
      ...(['dialogue', 'narration'] as const).map(kind => ({ comment: `omnitts-${kind}`, type: 'editdisplay', ableFlag: true, flag: 'g<order -10100>',
        in: `OMNITTS([0-9]{1,7})L([0-9]{1,7})H([0-9]{1,10}-[0-9]{1,10})${kind === 'dialogue' ? 'D' : 'N'}([^]{1,24000})OMNITTS`,
        out: `<div data-omnitts-line="$2" x-omnitts-line="$2" x-omnitts-message="$1" x-omnitts-source="$3" data-omnitts-kind="${kind}" x-omnitts-kind="${kind}"><span data-omnitts-text="1" x-omnitts-text="1">$4</span><button type="button" data-omnitts-play="1" x-omnitts-play="1" title="재생" aria-label="재생">▶</button></div>` })),
      { comment: 'omnitts-image-controls', type: 'editdisplay', ableFlag: true, flag: 'g<order -10110>',
        in: '(<div class="inray-shot"[^>]{1,3000}>)',
        out: '$1<div data-omnitts-image="1" x-omnitts-image="1"><button type="button" data-omnitts-play="1" x-omnitts-play="1" title="삽화 대사 재생" aria-label="삽화 대사 재생">▶</button><span data-omnitts-cast="1" x-omnitts-cast="1"></span></div>' },
      { comment: 'omnitts-incomplete-markers', type: 'editdisplay', ableFlag: true, flag: 'g<order -10120>', in: 'OMNITTS[0-9]{1,7}L[0-9]{1,7}H[0-9]{1,10}-[0-9]{1,10}[DN]|OMNITTS', out: '' },
    ],
  };
}
