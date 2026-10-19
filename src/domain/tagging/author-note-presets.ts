// Reusable texts for the main tagger's author's note (`author_note`).
// The examples are written against the tagger's real output contract
// (prompts/tagger.txt, format.txt): `camera` lands in the main prompt, each
// entry of `characters[]` becomes its own NAI character caption with the
// registered looks prepended, and 1girl/1boy are counted from that cast only.

export interface AuthorNotePreset {
  id: string;
  name: string;
  text: string;
  builtin?: boolean;
}

export const AUTHOR_NOTE_PRESET_TEXT_LIMIT = 20_000;
const LIMIT_ITEMS = 100;

/** Stored rows only; examples are never persisted, so a later release can improve them. */
export function normalizeAuthorNotePresets(raw: unknown): AuthorNotePreset[] {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { items?: unknown } : null;
  const rows = Array.isArray(raw) ? raw : Array.isArray(rec?.items) ? rec.items : [];
  const out: AuthorNotePreset[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? '').trim().slice(0, 80);
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    // An example id must never be shadowed by a stored row.
    if (!id || !name || seen.has(id) || id.startsWith('example-')) continue;
    seen.add(id);
    out.push({ id, name, text: String(r.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, AUTHOR_NOTE_PRESET_TEXT_LIMIT) });
    if (out.length >= LIMIT_ITEMS) break;
  }
  return out;
}

// English on purpose: the note rides along on every tagging call, and English
// costs a fraction of the tokens Korean does. Names stay Korean; they are UI labels.
const POV_CORE = `Camera = the viewpoint person's eyes (the first-person narrator, else the user persona).
Every shot: camera gets pov plus framing/angle (close-up, upper body, cowboy shot, from above when looking down, from below when looking up).

The viewpoint person is never a character:
- Never put them in characters[] or new_characters, not even when their hands or body are in frame. Only the people they look at are characters.
- Their visible parts go in camera: pov hands (hands in frame), pov crotch (lower body in frame), plus what those hands do (e.g. pov hands, headpat / holding hands / hand on another's cheek).
- Their body type, from {{user}} Info or their looks, goes in camera too, as gendered tags only so it never lands on the others: dark-skinned male, muscular male, fat man, old man / dark-skinned female. No cue: add none.
- Contact with them has no source/target (they are not in the cast): the act goes in camera, the other person's action carries the reaction (blush, looking at viewer, closed eyes).
- Others get looking at viewer only when they look at the viewpoint person.

V5 natural: call the viewpoint person "the viewer" (e.g. the viewer's hand reaches in from the bottom edge); never describe the viewer's face or head.`;

type Example = [id: string, name: string, text: string];
const EXAMPLES: Example[] = [
  // The user's quality pass, with their additions (keep wear_state, heart eyes, back view,
  // x-ray when it helps an insertion shot, the goal), compacted to English by request.
  ['quality', '퀄리티 향상', `1 Speech text: Korean, ≤6 chars, fits context.
2 Continuity: keep pose, sex position, location (e.g. bed) and wear_state across shots; no random stand/sit jumps, no clothes coming back.
3 Main prompt (natural language): describe layout, poses, hand positions, actions and camera like a hand-made render. Camera view (upper body, dutch angle, from above...) goes in BOTH main and character prompts; vary angles, pick the exact one needed (high/low). Face focus -> close-up. Aroused or ecstatic faces: use heart eyes often, written as "heart-shaped pupils" + a detailed expression.
4 Character tags:
- appearance: always hair_color + hair_style (infer if unknown, e.g. blue clothes -> blue hair); never expressions.
- expression/gaze/pose -> action (e.g. "looking at brown hair boy").
- mostly upper body -> add 2::upper body:: to action.
- seen from behind -> add "back view" to action.
- register every new character/animal/creature/monster; original = Danbooru "character (series)".
5 Contact: source = performer; target = receiver, with the EXACT same English verb (no passive/names, never "being sucked"); mutual = both at once. Expression/gaze/posture stay in action; no unmentioned acts.
6 NSFW: position + NSFW tags in mutual; carry positions over from prior shots; insertion -> "deep penetration"; facing -> "face to face"; when an x-ray view of the insertion would make the shot hotter, add 2::x-ray:: (judge per shot, not always).
7 Structure: spread "line" (L12, L15...) evenly, no bias; precise location ("on bed") so no one stands by accident; keep character coords far apart (real hitboxes), too close merges tags into malformed bodies.
Goal: intensely arousing images with striking composition and mood.`],
  ['pov', 'POV · 1인칭 시점', `[POV]
${POV_CORE}`],
  ['pov-touch', 'POV · 손과 스킨십', `[POV · hands and touch]
${POV_CORE}

Prefer shots where the viewpoint person's hands are in frame:
- When the text has them touching someone (holding, stroking, handing over, hugging), pick that moment.
- Frame hands and partner together (close-up or upper body): camera e.g. pov, pov hands, headpat; the partner's action carries the reaction (blush, surprised, looking at viewer, closed eyes).`],
  ['cinematic', '영화 같은 연출', `[Cinematic]
Cut the message's shots like a film; adjacent shots never repeat the same framing and angle.
- Establishing/location change: wide shot or full body, a readable angle (from above, from side), aspect landscape; place names location, time and light source.
- Action: cowboy shot or upper body; motion blur for big movement, dutch angle for tension, foreshortening for depth.
- Emotional peak: close-up or portrait, depth of field, blurry background, aspect portrait.
- Dialogue: alternate a from behind shot over the listener with a frontal shot of the speaker.
- Lighting: 1-2 that fit the text's time and source: backlighting, rim lighting, sunlight, light rays, sunset, moonlight, dim lighting, silhouette, lens flare.
- Never invent events, people or props for the sake of staging.`],
  ['emotion', '표정 클로즈업', `[Expression close-ups]
Pick shots around the speaker's and the listener's reactions.
- camera: close-up, portrait or upper body; 1-2 people per shot.
- action names the expression: blush, light blush, tearing up, tears, furrowed brow, raised eyebrows, parted lips, pout, smirk, gentle smile, trembling.
- Always give gaze: looking at another, looking away, looking down, averting eyes, eye contact (in each person's action, not mutual).
- Add telling gestures: hand on own chest, covering mouth, clenched hand, fidgeting.
- No emotion or line the text does not have.`],
  ['action', '액션 흐름', `[Action flow]
Pick shots so the key action reads as setup -> strike -> reaction; complexity dynamic.
- camera: setup full body or cowboy shot; strike dutch angle, from below, foreshortening; reaction upper body.
- action names the motion: running, jumping, swinging, lunging, dodging, fighting stance, outstretched arm, dynamic pose.
- Speed: motion blur, motion lines, speed lines. Impact as visible things: debris, dust cloud, sparks.
- weapon: on for whoever wields one. Keep positions, direction of travel and props consistent across shots; never merge different moments into one shot.`],
  ['scenery', '풍경과 공간', `[Scenery]
Prefer shots of the places and atmosphere the text describes.
- camera: wide shot, scenery; from above from a height, from below toward sky or buildings; aspect landscape.
- place gives structure, material, time, weather and light: night sky, starry sky, sunset, overcast, rain, fog, snow, cherry blossoms, city lights, light rays.
- People present in the text appear small (very wide shot, from behind); otherwise leave characters empty (no humans is added automatically).
- No people, buildings or props the text does not have.`],
];

export function authorNotePresetExamples(): AuthorNotePreset[] {
  return EXAMPLES.map(([id, name, text]) => ({ id: `example-${id}`, name, text, builtin: true }));
}
