import type { TtsSettings } from '../../core/tts-types';
import { TTS_IGNORED_RANGES, ttsExcludeTerms } from './filter';

function luaString(value: string): string {
  let delimiter = '=';
  while (value.includes(']' + delimiter + ']') || value.endsWith(']' + delimiter)) delimiter += '=';
  return '[' + delimiter + '[' + value + ']' + delimiter + ']';
}

export const OMNI_TTS_MODULE = 'omni-tts';
export const TTS_CUE_PROMPT = `@@depth 0
<OmniTTS>
For spoken dialogue only, write one complete cue per line: Name (delivery): "Dialogue"
Use the established full speaker name consistently. Do not invent identity or gender.
This also applies to the viewpoint character's own speech in a first-person story: even when the prose calls the speaker I, me, 나 or 저, label their spoken dialogue with their established actual name and delivery. Never omit the cue just because that character is narrating the scene.
Example: I said hello -> Harin (happy): "Hello." Only speech receives that cue; first-person actions, descriptions and unspoken narration remain plain prose. If the speaker's identity is not established, do not invent a name or label them I/나 as a character.
Write delivery in short English Fish Audio cues, e.g. happy, sad, angry, calm, curious, soft tone, whispering. Use calm for neutral delivery.
Keep both quotation marks on the same line. Narration remains plain prose without a speaker or delivery prefix.
Never label code, thoughts, images or status panels as spoken dialogue. Preserve the story language.
</OmniTTS>`;

export function ttsModule(settings: Pick<TtsSettings, 'hideName' | 'hideTone' | 'narration' | 'illustration' | 'passageLine'> & Partial<Pick<TtsSettings, 'excludeText' | 'skipChars'>>) {
  // Narration controls stay in the display DOM; the plugin owns their live visibility.
  const css = `[data-omnitts-play]{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;min-width:36px;min-height:36px;padding:4px;margin-left:4px;border:1px solid #8262bb55;border-radius:8px;background:#22192f99;color:#c6afff;cursor:pointer}[data-omnitts-play]:hover{background:#7132f566;border-color:#a483fb}[data-omnitts-play]:active{background:#7132f5}[data-omnitts-play][data-omnitts-kind="narration"]{background:#142b4699;border-color:#60a5fa66;color:#93c5fd}[data-omnitts-play][data-omnitts-kind="narration"]:hover{background:#2563eb66;border-color:#93c5fd}[data-omnitts-play][data-omnitts-kind="narration"]:active{background:#2563eb}[data-omnitts-image]{display:${settings.illustration ? 'flex' : 'none'};align-items:center;gap:6px;max-width:100%;overflow-x:auto}[data-omnitts-image] [data-omnitts-cast]{display:flex;gap:6px}`;
  // Only the final character and control share a nonbreaking inline tail;
  // the existing quotation box and the rest of its text remain untouched.
  const overlayCss = '[data-omnitts-tail]{position:relative;display:inline}[data-omnitts-tail]>[data-omnitts-play][data-omnitts-kind]{position:absolute;right:0;bottom:0;box-sizing:border-box;width:36px;height:36px;margin:0;white-space:nowrap;line-height:1;z-index:1}';
  // Rendering only: no API calls, playback, storage, timers, or mutation of chat data.
  // Lua scans each line once, avoiding backtracking over partially streamed messages.
  const code = `listenEdit("editDisplay", function(tid, data, meta)
  if not data or not meta or type(meta.index) ~= "number" or meta.index < 0 then return data end
  if getChatRole(tid, meta.index) ~= "char" then return data end
  if data:find('data-omnitts-play=', 1, true) or data:find('OMNITTS', 1, true) then return data end
  local ignored = {${TTS_IGNORED_RANGES.map(([a,b]) => `{${a},${b}}`).join(',')}}
  local excluded = {${ttsExcludeTerms(settings.excludeText || '').map(luaString).join(',')}}
  local function allowed(text)
    for _, term in ipairs(excluded) do if text:find(term, 1, true) then return false end end
    local count = 0
    for _, cp in utf8.codes(text) do
      local lo, hi, skip = 1, #ignored, false
      while lo <= hi do
        local mid = math.floor((lo + hi) / 2)
        if cp < ignored[mid][1] then hi = mid - 1
        elseif cp > ignored[mid][2] then lo = mid + 1
        else skip = true; break end
      end
      if not skip then count = count + 1; if count > ${settings.skipChars ?? 1} then return true end end
    end
    return false
  end
  local function trim(s) return (s:gsub('^%s+', ''):gsub('%s+$', '')) end
  local function header(s)
    s = trim(s)
    if s:sub(-1) == ':' then s = trim(s:sub(1, -2)) elseif s:sub(-3) == '：' then s = trim(s:sub(1, -4)) end
    local tone = ''
    local a, b = s:find('(', 1, true), nil
    if a then
      b = s:find(')', a + 1, true)
      if b ~= #s then return nil end
      tone = trim(s:sub(a + 1, b - 1))
      if tone == '' or #tone > 100 or tone:find('[^a-zA-Z ,%-]') then return nil end
      s = trim(s:sub(1, a - 1))
    end
    local first = 1
    for pos, cp in utf8.codes(s) do
      if cp == 32 or cp == 9 or cp == 42 or cp == 0xFE0F or cp == 0x200D or (cp >= 0x2600 and cp <= 0x27FF) or (cp >= 0x1F000 and cp <= 0x1FAFF) then first = pos + #utf8.char(cp) else break end
    end
    s = trim(s:sub(first):gsub('%*+$', ''))
    if s == '' or #s > 240 or s:find('[<>:"(){}%[%]|#!]') or s:find('：', 1, true) or s:find('“', 1, true) or s:find('”', 1, true) then return nil end
    return s, tone
  end
  local function quoted(s)
    s = trim(s)
    if #s > 24000 then return nil end
    for _, pair in ipairs({{'"','"'},{'“','”'},{"'","'"},{'‘','’'},{'「','」'},{'『','』'}}) do
      if s:sub(1, #pair[1]) == pair[1] and s:sub(-#pair[2]) == pair[2] and #s > #pair[1] + #pair[2] then return s:sub(#pair[1] + 1, -#pair[2] - 1) end
    end
  end
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
  local out, index, fence, html, hidden, post = {}, 1, false, false, nil, false
  local lines = {}
  for line in (data .. "\\n"):gmatch("([^\\n]*)\\n") do table.insert(lines, line) end
  while index <= #lines do
    local line, consumed = lines[index], false
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
        local name, tone, speech, quotation = nil, nil, nil, nil
        local openings = {}
        for _, quote in ipairs({'"','“',"'",'‘','「','『'}) do local at = trimmed:find(quote, 1, true); if at and at > 1 then table.insert(openings, at) end end
        table.sort(openings)
        for _, opening in ipairs(openings) do
          local speaker, delivery = header(trimmed:sub(1, opening - 1))
          local candidate = quoted(trimmed:sub(opening))
          if speaker and candidate then name, tone, speech, quotation = speaker, delivery, candidate, trimmed:sub(opening); break end
        end
        if not speech and (trimmed:sub(-1) == ':' or trimmed:sub(-3) == '：') and lines[index + 1] then
          name, tone = header(trimmed); speech = quoted(lines[index + 1])
          if name and speech and not speech:find('[<>]') then consumed = true; quotation = trim(lines[index + 1]) end
        end
        local kind, content = 'narration', line
        if name and #name <= 240 and #tone <= 100 and speech and speech ~= '' then
          kind = 'dialogue'
          content = ${!settings.hideName && !settings.hideTone ? "(consumed and line .. '\\n' .. lines[index + 1] or line)" : "" + (settings.hideName ? "''" : "name .. ' '" ) + " .. " + (settings.hideTone ? "''" : "(tone ~= '' and '(' .. tone .. ') ' or '')") + " .. quotation"}
        else
          -- Unfinished cues must never become narration while streaming.
          if line:find('%(') or line:find('"', 1, true) or line:find('“', 1, true) or line:find('‘', 1, true) or line:find('「', 1, true) or line:find('『', 1, true) or line:find(":%s*'") or ((trimmed:sub(-1) == ':' or trimmed:sub(-3) == '：') and header(trimmed)) then kind = nil end
          content = line
        end
        if kind then
          rendered = content
          -- Only a trailing button token is ours. External quotation/name rules
          -- still receive normal prose, without a TTS div/span around it.
          if allowed(kind == 'dialogue' and speech or line) then
            rendered = content .. 'OMNITTS' .. meta.index .. 'L' .. index .. 'H' .. linekey(trim(consumed and line .. '\\n' .. lines[index + 1] or line)) .. (kind == 'dialogue' and 'D' or 'N') .. ''
          end
        end
      end
    end
    table.insert(out, rendered)
    index = index + (consumed and 2 or 1)
  end
  local result = table.concat(out, "\\n")
  return result
end)`;
  return {
    id: OMNI_TTS_MODULE, namespace: OMNI_TTS_MODULE, name: '⚛️ omni tts',
    description: '이름·영문 억양 규칙과 채팅 재생 버튼. 음성 처리는 Omni Nexus 플러그인이 담당합니다.',
    hideIcon: false, lowLevelAccess: false, assets: [], backgroundEmbedding: `<style>${css}${overlayCss}[data-inlay-inline-shot]:has(>[data-omnitts-image]){display:flex!important;flex-direction:column}[data-omnitts-image]{order:10;justify-content:flex-start;margin-top:8px;min-height:40px}[data-omnitts-image] [data-omnitts-play]{background:#137448;color:#e3fff0;border-color:#5ad49b88;margin-left:0}[data-omnitts-image] [data-omnitts-play]:hover{background:#219c63;border-color:#9effcc}</style>`,
    lorebook: [{ key: '', secondkey: '', comment: 'omnitts-cues', content: TTS_CUE_PROMPT, mode: 'normal', insertorder: 999, alwaysActive: true, selective: false, useRegex: false, bookVersion: 2 }],
    trigger: [{ comment: 'omnitts-display-only', type: 'start', conditions: [], lowLevelAccess: false, effect: [{ type: 'triggerlua', code }] }],
    regex: [
      // Some display modules replace quotations with a div plus empty lines.
      // Move only our token into the existing box, never reparse its dialogue.
      { comment: 'omnitts-block-button', type: 'editdisplay', ableFlag: true, flag: 'g<order -10090>',
        in: '</div>([ \\t\\r\\n]{0,200})OMNITTS([0-9]{1,7})L([0-9]{1,7})H([0-9]{1,10}-[0-9]{1,10})D',
        out: 'OMNITTS$2L$3H$4D</div>$1' },
      ...(['dialogue', 'narration'] as const).map(kind => ({ comment: `omnitts-tail-${kind}`, type: 'editdisplay', ableFlag: true, flag: 'gu<order -10099>',
        in: `([^\\s<>])((?:</(?:span|b|i|em|strong)>[ \\t]*){0,8})([ \\t\\r\\n]{0,200})OMNITTS([0-9]{1,7})L([0-9]{1,7})H([0-9]{1,10}-[0-9]{1,10})${kind === 'dialogue' ? 'D' : 'N'}`,
        out: `<span data-omnitts-tail="1">$1<button type="button" data-omnitts-line="$5" data-omnitts-message="$4" data-omnitts-source="$6" data-omnitts-kind="${kind}" data-omnitts-play="1" x-omnitts-play="1" title="재생" aria-label="재생">▶</button></span>$2$3` })),
      ...(['dialogue', 'narration'] as const).map(kind => ({ comment: `omnitts-${kind}`, type: 'editdisplay', ableFlag: true, flag: 'g<order -10100>',
        in: `OMNITTS([0-9]{1,7})L([0-9]{1,7})H([0-9]{1,10}-[0-9]{1,10})${kind === 'dialogue' ? 'D' : 'N'}`,
        out: `<span data-omnitts-tail="1">&#8288;<button type="button" data-omnitts-line="$2" data-omnitts-message="$1" data-omnitts-source="$3" data-omnitts-kind="${kind}" data-omnitts-play="1" x-omnitts-play="1" title="재생" aria-label="재생">▶</button></span>` })),
      { comment: 'omnitts-image-controls', type: 'editdisplay', ableFlag: true, flag: 'g<order -10110>',
        in: '(<div class="inray-shot"[^>]{1,3000}>)',
        out: '$1<div data-omnitts-image="1" x-omnitts-image="1"><button type="button" data-omnitts-play="1" x-omnitts-play="1" title="삽화 대사 재생" aria-label="삽화 대사 재생">▶</button><span data-omnitts-cast="1" x-omnitts-cast="1"></span></div>' },
      { comment: 'omnitts-incomplete-markers', type: 'editdisplay', ableFlag: true, flag: 'g<order -10120>', in: 'OMNITTS[0-9]{1,7}L[0-9]{1,7}H[0-9]{1,10}-[0-9]{1,10}[DN][]|OMNITTS', out: '' },
    ],
  };
}
