/** Display-only controls. Lua never dispatches jobs or writes plugin settings. */
export const MESSAGE_CONTROLS_COMMENT = 'omni-message-controls';
export function messageControlsDisplayScript() {
  const kinds = [['tag','⚛️','태그 생성'],['regen','🔃','전체 이미지 리롤'],['char','👨‍👩‍👧‍👦','캐릭터'],['stop','🟥','중지'],['preset','📚','프리셋'],['note','✒️','작가 노트'],['counts','🔢','생성 장수']];
  const buttons = kinds.map(([kind, icon, label]) => `<button type="button" data-omni-action="${kind}" title="${label}" aria-label="${label}">${icon}</button>`).join('');
  const css = '[data-omni-footer]{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:4px;width:max-content;max-width:100%;min-height:40px;margin:.75rem auto .1rem 0;padding:4px;box-sizing:border-box;border:1px solid #344052;border-radius:12px;background:#161e2c;color:#eee;overflow-anchor:none}[data-omni-edge="top"]{margin:.1rem auto .75rem 0}[data-omni-footer] button{display:inline-grid;place-items:center;width:38px;height:38px;flex:0 0 38px;padding:0;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;box-shadow:none;cursor:pointer;font:18px/1 system-ui}[data-omni-footer] button:hover,[data-omni-footer] button:focus-visible{background:#7132f533;border-color:#7132f5;outline:none}[data-omni-footer] button:active{background:#7132f566}';
  return { comment: 'omni-message-controls-display', type: 'editdisplay', ableFlag: true, flag: 'g<order -10090>',
    in: 'OMNI([0-9]{1,7})(top|bottom)',
    out: `<style>${css}</style><div data-omni-footer="$1" data-omni-edge="$2">${buttons}</div>` };
}
export function messageControlsTrigger(enabled: boolean, userchat: boolean) {
  return { comment: MESSAGE_CONTROLS_COMMENT, type: 'start', conditions: [], lowLevelAccess: false,
    effect: [{ type: 'triggerlua', code: `listenEdit("editDisplay", function(tid, data, meta)
  if not ${enabled} or not meta or type(meta.index) ~= "number" or meta.index < 0 or not data or data == "" then return data end
  if data:find('data-omni-footer=', 1, true) or data:find('OMNI', 1, true) then return data end
  local role = getChatRole(tid, meta.index)
  if role ~= "char" and not (${userchat} and role == "user") then return data end
  local token = tostring(meta.index)
  local function bar(edge)
    return 'OMNI' .. token .. edge .. ''
  end
  -- External CoT rules hide everything before the response header. Keep the
  -- top control inside the visible response without reviving hidden reasoning.
  local position, offset = nil, 1
  for line in (data .. "\\n"):gmatch("([^\\n]*)\\n") do
    local title = line:gsub('^[#*%s]+', ''):gsub('[*%s]+$', '')
    if line:find('^%s*#') and (title == 'Response' or title == '응답' or title == '応答' or title == '响应' or title == 'OOC') then
      position = offset + #line
      break
    end
    offset = offset + #line + 1
  end
  if not position then
    local _, ending = data:find('</Thoughts>', 1, true)
    position = ending
  end
  if position then
    return data:sub(1, position) .. "\\n\\n" .. bar("top") .. "\\n\\n" .. data:sub(position + 1) .. "\\n\\n" .. bar("bottom")
  end
  return bar("top") .. "\\n\\n" .. data .. "\\n\\n" .. bar("bottom")
end)` }] };
}
