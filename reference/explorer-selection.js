/** Pure explorer selection + sort helpers (no DOM). */

export function createSelectionState(ids = []) {
  return {
    selected: new Set((ids || []).map(String).filter(Boolean)),
    anchorId: "",
    focusId: "",
  };
}

export function visibleIds(items = []) {
  return (items || []).map((item) => String(item?.id || "")).filter(Boolean);
}

export function applyExplorerClick(state, id, { index, ids, shift = false, ctrl = false } = {}) {
  const next = {
    selected: new Set(state?.selected || []),
    anchorId: String(state?.anchorId || ""),
    focusId: String(state?.focusId || ""),
  };
  const target = String(id || "");
  if (!target) return next;
  const list = Array.isArray(ids) ? ids.map(String) : [];
  const idx = Number.isFinite(index) ? index : list.indexOf(target);

  if (shift && next.anchorId && list.length) {
    const a = list.indexOf(next.anchorId);
    const b = idx >= 0 ? idx : list.indexOf(target);
    if (a >= 0 && b >= 0) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      next.selected = new Set(list.slice(lo, hi + 1));
      next.focusId = target;
      return next;
    }
  }

  if (ctrl) {
    if (next.selected.has(target)) next.selected.delete(target);
    else next.selected.add(target);
    next.anchorId = target;
    next.focusId = target;
    return next;
  }

  next.selected = new Set([target]);
  next.anchorId = target;
  next.focusId = target;
  return next;
}

export function selectAll(state, ids = []) {
  return {
    selected: new Set((ids || []).map(String).filter(Boolean)),
    anchorId: String(state?.anchorId || ids?.[0] || ""),
    focusId: String(state?.focusId || ids?.[0] || ""),
  };
}

export function clearSelection(state = null) {
  return {
    selected: new Set(),
    anchorId: String(state?.anchorId || ""),
    focusId: "",
  };
}

export function moveFocus(ids = [], focusId = "", delta = 1) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return "";
  const cur = list.indexOf(String(focusId || ""));
  if (cur < 0) return list[0];
  return list[Math.max(0, Math.min(list.length - 1, cur + delta))];
}

export function sortExplorerItems(items = [], mode = "newest") {
  const list = [...(items || [])];
  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  if (mode === "oldest") {
    return list.sort((a, b) => num(a.created_at) - num(b.created_at) || String(a.id).localeCompare(String(b.id)));
  }
  if (mode === "message") {
    return list.sort(
      (a, b) =>
        num(a.message_index, 1e9) - num(b.message_index, 1e9) ||
        num(a.shot_index) - num(b.shot_index) ||
        num(b.created_at) - num(a.created_at),
    );
  }
  if (mode === "shot") {
    return list.sort(
      (a, b) =>
        num(a.shot_index) - num(b.shot_index) ||
        num(a.message_index, 1e9) - num(b.message_index, 1e9) ||
        num(b.created_at) - num(a.created_at),
    );
  }
  // newest (default)
  return list.sort((a, b) => num(b.created_at) - num(a.created_at) || String(b.id).localeCompare(String(a.id)));
}

export function thumbMinWidth(size = "m") {
  if (size === "s") return 96;
  if (size === "l") return 200;
  return 148;
}

export function reorderByIds(list = [], orderedIds = []) {
  const map = new Map((list || []).map((item) => [String(item?.id ?? item), item]));
  const out = [];
  for (const id of orderedIds || []) {
    const key = String(id);
    if (map.has(key)) {
      out.push(map.get(key));
      map.delete(key);
    }
  }
  for (const item of map.values()) out.push(item);
  return out;
}
