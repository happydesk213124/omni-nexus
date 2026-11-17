// ⭐ and ✕ on a picture in the chat. ⭐ is 이미지 탐색's favourite (one list, the same /v1/gallery/favorites the explorer
// and 크게보기 write); ✕ takes the picture out of its message (its card and file stay), asked twice, since one slip of a
// finger would take a picture out of the story.
let omniFavIds = null, omniFavAt = 0, omniFavWork = Promise.resolve();
const omniDelArmed = new Map();
async function omniFavoriteIds(fresh = false) {
  if (!fresh && omniFavIds && Date.now() - omniFavAt < 3000) return omniFavIds;
  const result = await K('/v1/gallery/favorites');
  omniFavIds = new Set(Array.isArray(result?.ids) ? result.ids.map(String) : []);
  omniFavAt = Date.now();
  return omniFavIds;
}
// One at a time: two quick presses must not both read the list before either writes it back.
function omniToggleFavorite(id) {
  const task = omniFavWork.catch(() => {}).then(async () => {
    const ids = await omniFavoriteIds(true);
    const on = !ids.has(id);
    if (on) ids.add(id); else ids.delete(id);
    const result = await K('/v1/gallery/favorites', { method: 'POST', body: { ids: [...ids] } });
    if (result?.ok === false) throw new Error(result.error?.message || '즐겨찾기를 저장하지 못했습니다.');
    // 이미지 탐색 keeps its own copy of the list once it has been opened: it must not write the old one back.
    try { ensureExplorerState().favorites = [...ids]; } catch {}
    return on;
  });
  omniFavWork = task.catch(() => {});
  return task;
}
/** The ⭐ of one picture shows whether it is a favourite (lit) or not (grey). */
async function omniPaintFavoriteIn(wrap, id) {
  if (!wrap || !id) return;
  const button = await wrap.querySelector('[data-inray-fav],[x-inray-fav]');
  try { if (button) await button.setAttribute('x-inray-fav-on', (await omniFavoriteIds()).has(id) ? '1' : '0'); }
  finally { await omniRelease(button); }
}
async function omniChatImageAction(root, event) {
  if (!root || t._nxHostInspectOpen || !Number.isFinite(event?.clientX)) return false;
  for (const kind of ['fav', 'del']) {
    // Only the button under the finger or pointer: every query crosses the host bridge, and every tap runs this.
    const nodes = await nxUnwrapSafeNodes(await root.querySelectorAll(':is([x-inray-' + kind + '],[data-inray-' + kind + ']):is(:active,:hover,:focus)'));
    try {
      for (const node of nodes) {
        if (!await hitEl(node, event.clientX, event.clientY)) continue;
        // x- first: an image history preview points ⭐ at the picture it shows (✕ stays the message's own). Risu
        // reads x- attributes only; the data- one comes from the markup (omniHistoryAttr).
        const id = String(await omniHistoryAttr(node, 'inray-' + kind) || '');
        if (!id) continue;
        if (kind === 'fav') {
          const on = await omniToggleFavorite(id);
          await node.setAttribute('x-inray-fav-on', on ? '1' : '0');
        } else if ((omniDelArmed.get(id) || 0) > Date.now()) {
          omniDelArmed.delete(id);
          const result = await K('/v1/cards/' + encodeURIComponent(id) + '/unbake', { method: 'POST', body: {} });
          if (result?.ok === false) throw new Error(result.error?.message || '채팅에서 빼지 못했습니다.');
        } else {
          // The first press asks (the button says what a second one does); four seconds later it asks no more.
          omniDelArmed.set(id, Date.now() + 4000);
          await node.setAttribute('x-inray-del-armed', '1');
          setTimeout(() => { void omniDisarmDelete(root).catch(() => {}); }, 4100);
        }
        return true;
      }
    } catch (error) { Pe(kind === 'fav' ? '즐겨찾기' : '채팅에서 빼기', error); return true; }
    finally { for (const node of nodes) await omniRelease(node); }
  }
  return false;
}
async function omniDisarmDelete(root) {
  const nodes = await nxUnwrapSafeNodes(await root.querySelectorAll('[x-inray-del-armed="1"]'));
  try {
    for (const node of nodes) {
      const id = String(await omniHistoryAttr(node, 'inray-del') || '');
      if ((omniDelArmed.get(id) || 0) > Date.now()) continue;
      omniDelArmed.delete(id);
      await node.setAttribute('x-inray-del-armed', '0');
    }
  } finally { for (const node of nodes) await omniRelease(node); }
}
