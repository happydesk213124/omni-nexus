/**
 * 「ElevenLabs 묶음 만들기」: effects no free library has (입맞춤, 츄릅, 찔걱…), made with the reader's own ElevenLabs
 * key in one go and kept in one folder. Each comes with the sound words it is heard as and its 상황, like the
 * examples, so matching knows it at once; the prompt is English, which the effect model follows best. Durations stay
 * short: a cue plays for a few seconds at most (설정 › 효과음 최대 길이).
 */
export const ELEVEN_PACK_FOLDER = '친밀 (ElevenLabs)';
export interface ElevenPackItem { name: string; tags: readonly string[]; note: string; prompt: string; duration: number }
export const ELEVEN_PACK: readonly ElevenPackItem[] = Object.freeze([
  { name: '딥키스', tags: ['츄', '츄읍', '하읍', '쪼옥', '츄릅'], note: '깊고 길게 입을 맞춤', prompt: 'a slow deep passionate kiss, wet lips, intimate, close-up, no music, no speech', duration: 3 },
  { name: '입맞춤 연속', tags: ['쪽쪽', '쪽', '쪼옥', '뽀뽀', '쮸'], note: '볼·목에 여러 번 가볍게 입을 맞춤', prompt: 'several quick soft kisses on skin, lip smacks, close-up, no music, no speech', duration: 2.5 },
  { name: '츄릅', tags: ['츄릅', '쭈릅', '후릅', '츄르릅', '쭙'], note: '입으로 젖은 것을 빨아들임', prompt: 'a wet slurping suck, close-up mouth sound, no music, no speech', duration: 2 },
  { name: '핥기', tags: ['할짝', '할짝할짝', '날름', '낼름', '츄읍'], note: '혀로 핥음', prompt: 'wet licking sounds, tongue on skin, close-up, no music, no speech', duration: 2.5 },
  { name: '쪽쪽 빨기', tags: ['쪽쪽', '쭙쭙', '쭈읍', '쪼옥쪼옥', '빨기'], note: '입으로 빨기를 되풀이함', prompt: 'rhythmic wet sucking sounds, close-up mouth, no music, no speech', duration: 3 },
  { name: '찔걱 (젖은 소리)', tags: ['찔걱', '찔걱찔걱', '찌걱', '질걱', '찔꺽'], note: '끈적하고 젖은 것이 부딪고 문질러짐', prompt: 'rhythmic wet squelching, sticky slippery sound, close-up, no music, no speech', duration: 3 },
  { name: '질척', tags: ['질척', '질척질척', '찌걱찌걱', '철퍽', '질퍽'], note: '끈적한 액체가 섞이며 질척임', prompt: 'slow thick sticky squishing, gooey liquid being stirred, no music, no speech', duration: 3 },
  { name: '찰싹 리듬', tags: ['팡팡', '찰싹찰싹', '철썩철썩', '탁탁', '퍽퍽'], note: '살과 살이 리듬 있게 부딪힘', prompt: 'rhythmic skin slapping against skin at a steady pace, no music, no speech', duration: 4 },
  { name: '침대 삐걱 리듬', tags: ['삐걱삐걱', '끼익끼익', '덜컹덜컹', '삐걱'], note: '침대가 리듬 있게 흔들리며 삐걱임', prompt: 'an old wooden bed frame creaking rhythmically at a steady pace, no music, no speech', duration: 4 },
  { name: '이불 부스럭', tags: ['부스럭', '사락사락', '바스락', '뒤척'], note: '이불 속에서 몸을 뒤척임', prompt: 'bed sheets and a blanket rustling as someone moves under them, no music, no speech', duration: 3 },
  { name: '옷 벗기', tags: ['스르륵', '사락', '스륵', '툭'], note: '옷을 벗어 바닥에 떨어뜨림', prompt: 'clothes being taken off, fabric sliding over skin, then dropped on the floor, no music, no speech', duration: 3 },
  { name: '거친 숨', tags: ['하아하아', '헉헉', '하악', '흐읏', '하앗'], note: '가까이서 거칠게 숨을 몰아쉼', prompt: 'heavy breathless breathing up close, panting, no words, no music', duration: 4 },
  { name: '두근두근', tags: ['두근두근', '두근', '쿵쿵', '콩닥콩닥'], note: '심장이 빠르게 뜀, 설렘·긴장', prompt: 'a fast pounding heartbeat, close and muffled, no music', duration: 3 },
  { name: '꿀꺽', tags: ['꿀꺽', '꼴깍', '꿀떡', '꼴딱'], note: '침이나 음료를 삼킴, 긴장해 침을 삼킴', prompt: 'a single loud gulp, swallowing, close-up, no music, no speech', duration: 1.5 },
  { name: '끈적한 방울', tags: ['주르륵', '또옥', '뚝뚝', '주룩', '똑'], note: '끈적한 액체가 흘러 떨어짐', prompt: 'thick viscous liquid dripping slowly, heavy drops falling, no music', duration: 2.5 },
  { name: '젖은 손', tags: ['찰박', '찰싹', '철벅', '찰방'], note: '젖은 손이 피부를 쓸고 두드림', prompt: 'wet hands patting and sliding on wet skin, close-up, no music, no speech', duration: 2.5 },
  { name: '오일 마사지', tags: ['미끌', '스윽', '쓱쓱', '미끄덩'], note: '오일 바른 피부를 손으로 문지름', prompt: 'slippery oil massage, hands rubbing oiled skin, close-up, no music, no speech', duration: 3 },
]);
