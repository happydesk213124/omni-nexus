/**
 * YouTube links as BGM. A video is known by its 11-character id, whatever form
 * the link takes; the list keeps one plain watch link for it.
 */
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = /^(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com$/i;

/** A YouTube link's video id (watch, youtu.be, embed, shorts, live, music); '' for any other link. */
export function youtubeVideoId(link: string): string {
  let url: URL;
  try { url = new URL(String(link || '').trim()); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  const host = url.hostname.toLowerCase();
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || '';
  else if (HOSTS.test(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    id = parts[0] === 'watch' ? url.searchParams.get('v') || '' : ['embed', 'shorts', 'live', 'v'].includes(parts[0] || '') ? parts[1] || '' : '';
  }
  return ID.test(id) ? id : '';
}
export const youtubeWatchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
