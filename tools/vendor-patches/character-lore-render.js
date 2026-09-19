// Markup retained from the character lore picker; only this region repaints.
function omniLoreHtml(state) {
      const _lf = state, _lfSel = new Set(Array.isArray(_lf.selected) ? _lf.selected : []), _lfCat = Array.isArray(_lf.catalog) ? _lf.catalog : [];
      const _lfPicked = _lfCat.filter((row) => _lfSel.has(row.id));
      const _lfTrigPrev = (keys) => {
        const s = (Array.isArray(keys) ? keys : []).join(", ");
        if (!s) return "";
        return s.length <= 14 ? s : s.slice(0, 14) + "...";
      };
      const _lfSelectedHtml = (_lfPicked.length ? _lfPicked : Array.from(_lfSel).map((id) => ({ id, title: id, keys: [] }))).map((row) => {
        const trig = _lfTrigPrev(row.keys);
        return `<span data-lorefilter-chip="${h(row.id)}" style="display:inline-flex;align-items:stretch;max-width:100%;border-radius:999px;border:1px solid var(--border2);background:rgba(255,255,255,.04);overflow:hidden"><button type="button" data-lorefilter-peek="${h(row.id)}" title="${h(trig || row.title || row.id)}" style="appearance:none;border:0;background:transparent;color:inherit;font-size:12px;padding:6px 10px;min-height:36px;max-width:11rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;cursor:pointer">${h(row.title || row.id)}</button><button type="button" data-lorefilter-remove="${h(row.id)}" aria-label="삭제" title="선택에서 제거" style="appearance:none;border:0;border-left:1px solid var(--border2);background:rgba(248,113,113,.12);color:#fecaca;min-width:40px;min-height:36px;font-size:20px;line-height:1;cursor:pointer;flex-shrink:0">×</button></span>`;
      }).join("") || '<span class="muted" style="font-size:12px">아직 없음 · 자동채우기 또는 추가로 고르세요</span>';
      const _lfAddHtml = _lfCat.filter((row) => !_lfSel.has(row.id)).map((row) => {
        const trig = _lfTrigPrev(row.keys);
        return `<button type="button" data-lorefilter-add="${h(row.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;min-height:40px;padding:8px 10px;margin:0 0 4px;border-radius:10px;border:1px solid var(--border2);background:transparent;color:inherit;font-size:12px;cursor:pointer"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(row.title || row.id)}</span><span class="muted" style="flex:0 0 auto;font-size:11px;color:#8995aa;max-width:7.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(trig)}</span></button>`;
      }).join("") || '<div class="muted" style="font-size:12px;padding:6px 0">추가할 로어 없음</div>';
      const _lfPeek = state.peek && typeof state.peek === "object" ? state.peek : null;
      const _lfPeekHtml = _lfPeek ? `
        <div id="nx-lorefilter-peek" style="position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box">
          <div role="dialog" aria-modal="true" style="width:min(520px,100%);max-height:min(80vh,640px);overflow:auto;-webkit-overflow-scrolling:touch;background:#0b0f18;border:1px solid var(--border);border-radius:14px;padding:14px;box-sizing:border-box">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
              <strong style="font-size:14px">로어 보기</strong>
              <button type="button" class="secondary" id="nx-lorefilter-peek-close" style="min-height:32px;padding:4px 10px">닫기</button>
            </div>
            <label style="display:grid;gap:4px;margin-bottom:10px"><span class="muted" style="font-size:11px">제목</span><textarea readonly rows="1" style="width:100%;resize:none;font:12px/1.4 Segoe UI,sans-serif;padding:8px 10px;border-radius:10px;border:1px solid var(--border2);background:rgba(0,0,0,.25);color:var(--text)">${h(_lfPeek.title || "")}</textarea></label>
            <label style="display:grid;gap:4px;margin-bottom:10px"><span class="muted" style="font-size:11px">트리거</span><textarea readonly rows="2" style="width:100%;resize:vertical;min-height:48px;font:12px/1.4 Segoe UI,sans-serif;padding:8px 10px;border-radius:10px;border:1px solid var(--border2);background:rgba(0,0,0,.25);color:var(--text)">${h(Array.isArray(_lfPeek.keys) ? _lfPeek.keys.join(", ") : String(_lfPeek.keys || ""))}</textarea></label>
            <label style="display:grid;gap:4px;margin-bottom:12px"><span class="muted" style="font-size:11px">내용</span><textarea readonly rows="10" style="width:100%;resize:vertical;min-height:140px;font:12px/1.45 Consolas,Segoe UI,monospace;padding:8px 10px;border-radius:10px;border:1px solid var(--border2);background:rgba(0,0,0,.25);color:var(--text)">${h(_lfPeek.content || "")}</textarea></label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end">
              <button type="button" class="secondary" id="nx-lorefilter-peek-remove" data-lorefilter-remove="${h(_lfPeek.id || "")}" style="min-height:36px;padding:6px 12px;color:#fecaca">선택에서 제거</button>
              <button type="button" class="secondary" id="nx-lorefilter-peek-close2" style="min-height:36px;padding:6px 12px">닫기</button>
            </div>
          </div>
        </div>` : "";
      const LfHtml = `
        <details class="card" id="nx-lorefilter" ${_lf.folded ? "" : "open"} style="margin-top:10px;padding:0">
          <summary style="cursor:pointer;list-style:none;padding:10px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
            <div style="min-width:0;flex:0 1 auto">
              <div class="prompt-title" style="font-size:13px">캐릭터 로어북</div>
              <div class="muted" style="font-size:11px;margin-top:2px;line-height:1.35">${_lfSel.size}개 선택 · 태거·에셋만</div>
            </div>
            <div id="nx-lorefilter-hover" class="muted" style="flex:1 1 100px;min-width:72px;font-size:11px;color:#8995aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35"></div>
            <div data-lorefilter-actions style="display:flex;flex-wrap:wrap;gap:6px;flex:0 0 auto">
              <button type="button" class="secondary" id="nx-lorefilter-toggle-add" style="min-height:32px;padding:4px 10px">${_lf.open ? "닫기" : "추가"}</button>
              <button type="button" class="secondary" id="nx-lorefilter-rescan" ${state.busy ? 'disabled' : ''} style="min-height:32px;padding:4px 10px">${state.busy ? '처리 중…' : '자동채우기'}</button>
            </div>
            <span class="muted" style="font-size:11px;flex:0 0 auto">접기/펼치기</span>
          </summary>
          <div style="padding:0 10px 10px">
            <div role="status" style="font-size:12px;margin-bottom:6px">${h(state.message || '')}</div>
            <div data-lorefilter-chips style="display:flex;flex-wrap:wrap;gap:6px;max-height:9.5rem;overflow:auto;-webkit-overflow-scrolling:touch">${_lfSelectedHtml}</div>
            <div id="nx-lorefilter-catalog" style="display:${_lf.open ? "block" : "none"};margin-top:8px;max-height:11rem;overflow:auto;-webkit-overflow-scrolling:touch;padding-right:2px">${_lfAddHtml}</div>
          </div>
        </details>${_lfPeekHtml}`;

  return LfHtml;
}
