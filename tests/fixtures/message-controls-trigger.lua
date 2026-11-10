-- The Lua trigger that placed a message's row of buttons up to release 1.4.12 (src/domain/message-controls.ts at
-- 6ac0c678), kept as the reference the rules that replaced it are checked against
-- (tests/message-controls-rules.test.mjs). __ENABLED__ and __USERCHAT__ stand for the two settings.
listenEdit("editDisplay", function(tid, data, meta)
  if not __ENABLED__ or not meta or type(meta.index) ~= "number" or meta.index < 0 or not data or data == "" then return data end
  if data:find('data-omni-footer=', 1, true) or data:find('\u{E004}OMNI', 1, true) then return data end
  local role = getChatRole(tid, meta.index)
  if role ~= "char" and not (__USERCHAT__ and role == "user") then return data end
  local token = tostring(meta.index)
  local function bar(edge)
    return '\u{E004}OMNI' .. token .. edge .. '\u{E005}'
  end
  -- External CoT rules hide everything before the response header. Keep the
  -- top control inside the visible response without reviving hidden reasoning.
  local position, offset = nil, 1
  for line in (data .. "\n"):gmatch("([^\n]*)\n") do
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
    return data:sub(1, position) .. "\n\n" .. bar("top") .. "\n\n" .. data:sub(position + 1) .. "\n\n" .. bar("bottom")
  end
  return bar("top") .. "\n\n" .. data .. "\n\n" .. bar("bottom")
end)
