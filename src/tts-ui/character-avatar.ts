import type { TtsGender } from '../core/tts-types';

const backgrounds = { female: '#f8d6e6', male: '#cfe5fa', unknown: '#f1f3f5' };

export function characterAvatar(gender: TtsGender): string {
  const hair = gender === 'female' ? '<path fill="#818791" d="M61 167V96a59 59 0 0 1 118 0v71l-30 12H91z"/>' : '';
  const fringe = gender === 'female' ? '<path fill="#818791" d="M73 97c-3-58 99-64 94 0-22-1-38-13-49-29-7 16-24 27-45 29z"/>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><path fill="${backgrounds[gender]}" d="M0 0h240v240H0z"/>${hair}<path fill="#a7acb5" d="M38 240v-27c0-34 34-59 82-59s82 25 82 59v27z"/><rect x="105" y="129" width="30" height="44" rx="12" fill="#a7acb5"/><ellipse cx="120" cy="102" rx="43" ry="51" fill="#b9bdc5"/>${fringe}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Narrator and monologue cards: a flat colour with the role as plain text. */
export function roleAvatar(role: 'narrator' | 'monologue'): string {
  const [color, label] = role === 'narrator' ? ['#7c5cd6', '나레이션'] : ['#2f9e62', '혼잣말'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><path fill="${color}" d="M0 0h240v240H0z"/><text x="120" y="120" fill="#fff" font-family="sans-serif" font-size="34" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
