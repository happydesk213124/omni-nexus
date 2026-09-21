/** Display-only controls. Lua never dispatches jobs or writes plugin settings. */
export const MESSAGE_CONTROLS_COMMENT = 'omni-message-controls';
export function messageControlsTrigger(enabled: boolean, userchat: boolean) {
  const kinds = [['tag','⚛️','태그 생성'],['regen','🔃','전체 이미지 리롤'],['char','👨‍👩‍👧‍👦','캐릭터'],['stop','🟥','중지'],['preset','📚','프리셋'],['note','✒️','작가 노트'],['counts','🔢','생성 장수']];
  const buttons = kinds.map(([kind, icon, label]) => `<button type="button" data-omni-action="${kind}" title="${label}" aria-label="${label}">${icon}</button>`).join('');
  const css = '[data-omni-footer]{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:4px;width:max-content;max-width:100%;min-height:40px;margin:.75rem auto .1rem 0;padding:4px;box-sizing:border-box;border:1px solid #344052;border-radius:12px;background:#161e2c;color:#eee;overflow-anchor:none}[data-omni-edge="top"]{margin:.1rem auto .75rem 0}[data-omni-footer] button{display:inline-grid;place-items:center;width:38px;height:38px;flex:0 0 38px;padding:0;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;box-shadow:none;cursor:pointer;font:18px/1 system-ui}[data-omni-footer] button:hover,[data-omni-footer] button:focus-visible{background:#7132f533;border-color:#7132f5;outline:none}[data-omni-footer] button:active{background:#7132f566}';
  return { comment: MESSAGE_CONTROLS_COMMENT, type: 'start', conditions: [], lowLevelAccess: false,
    effect: [{ type: 'triggerlua', code: `listenEdit("editDisplay", function(tid, data, meta)
  if not ${enabled} or not meta or type(meta.index) ~= "number" or meta.index < 0 or not data or data == "" then return data end
  if data:find('data-omni-footer=', 1, true) then return data end
  local row = getChat(tid, meta.index)
  if not row or (row.role ~= "char" and not (${userchat} and row.role == "user")) then return data end
  local raw = row.data or ""
  local sum = 0
  for i = 1, #raw do sum = (sum * 31 + raw:byte(i)) % 65521 end
  local token = tostring(meta.index) .. ":" .. tostring(#raw) .. ":" .. tostring(sum)
  local function bar(edge)
    return '<div data-omni-footer="' .. token .. '" data-omni-edge="' .. edge .. '">${buttons}</div>'
  end
  return [=[<style>${css}</style>]=] .. bar("top") .. "\\n\\n" .. data .. "\\n\\n" .. bar("bottom")
end)` }] };
}
