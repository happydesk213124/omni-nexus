/**
 * 옴니 뷰어's 소리 panel, under VOICE: Voice, 나레이션, BGM (with its level while TTS speaks) and 효과음, each with its
 * switch and its level, and whether an effect's word shows while it sounds. The switches are the bottom row's own
 * (나레이션 · BGM · 효과음) and VOICE's old one; the levels are the settings window's (TTS 재생 볼륨, BGM 볼륨,
 * TTS 재생 중 BGM, 효과음 볼륨), so a level moved here is moved there too. Pure markup: the viewer measures it and
 * reads taps by where its controls are (Risu tells a plugin's listener no target).
 */

export type SoundLevel = 'voice' | 'narr' | 'bgm' | 'duck' | 'sfx';
export type SoundSwitch = 'voice' | 'narr' | 'bgm' | 'sfx' | 'sfxtext';
export type SoundLevels = Record<SoundLevel, number>;
/** Each switch on or off; `ready` false: BGM and 효과음 are not loaded yet (their rows do nothing). */
export type SoundSwitches = Record<SoundSwitch, boolean> & { ready: boolean };

/** The panel's controls in document order: what the viewer measures, a rectangle each, in this order. */
export const SOUND_CONTROLS = ['voice-mute', 'voice-bar', 'narr-mute', 'narr-bar', 'bgm-mute', 'bgm-bar', 'duck-bar', 'sfx-mute', 'sfx-bar', 'sfxtext-mute'] as const;
export type SoundControl = typeof SOUND_CONTROLS[number];

const percent = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 100);
const fill = (v: number): string => `<span style="width:${percent(v)}%"></span>`;

function row(key: SoundSwitch & SoundLevel, label: string, on: boolean, level: number): string {
  return `<div data-vn-srow="${key}"${on ? '' : ' data-off'}><button data-vn-snd="${key}-mute" type="button" aria-label="${label} ${on ? '끄기' : '켜기'}">${on ? '🔊' : '🔇'}</button>`
    + `<b>${label}</b><div data-vn-snd="${key}-bar" role="slider" aria-label="${label} 볼륨" aria-valuenow="${percent(level)}">${fill(level)}</div><em>${percent(level)}%</em></div>`;
}

export function soundPanelHtml(on: SoundSwitches, levels: SoundLevels): string {
  const loaded = (v: boolean) => on.ready && v;
  return '<h5>소리</h5>'
    + row('voice', 'Voice', on.voice, levels.voice)
    + row('narr', '나레이션', on.narr, levels.narr)
    + row('bgm', 'BGM', loaded(on.bgm), levels.bgm)
    + `<div data-vn-srow="duck" data-sub${on.ready ? '' : ' data-off'}><i></i><b>TTS 중</b><div data-vn-snd="duck-bar" role="slider" aria-label="TTS 재생 중 BGM 크기" aria-valuenow="${percent(levels.duck)}">${fill(levels.duck)}</div><em>${percent(levels.duck)}%</em></div>`
    + row('sfx', '효과음', loaded(on.sfx), levels.sfx)
    + `<div data-vn-srow="sfxtext" data-sub${on.sfxtext ? '' : ' data-off'}><i></i><b>글자 표시</b><button data-vn-snd="sfxtext-mute" type="button" aria-label="효과음 글자 표시 ${on.sfxtext ? '끄기' : '켜기'}">${on.sfxtext ? '켜짐' : '꺼짐'}</button></div>`;
}

/** A level from where a bar was pressed: its share of the bar's width, to the hundredth. */
export function levelAt(x: number, bar: { left: number; width: number }): number {
  if (!(bar.width > 0)) return 0;
  return Math.round(Math.max(0, Math.min(1, (x - bar.left) / bar.width)) * 100) / 100;
}
export const levelText = (v: number): string => `${percent(v)}%`;
export const levelWidth = (v: number): string => `width:${percent(v)}%`;
