/**
 * Places a story often goes, as tags only: no picture ships with the plugin. A reply
 * with no place of its own is matched to one of these (or to a background the bot
 * already has) by JEV or embedding; the picture is drawn the first time one is used,
 * into that bot's assets, and kept.
 */
export const PLACE_SAMPLES: readonly string[] = Object.freeze([
  // home
  'bedroom, indoors, bed, window, daytime', 'bedroom, indoors, bed, night, lamp light', 'living room, indoors, sofa, television, daytime',
  'living room, indoors, sofa, night, dim lighting', 'kitchen, indoors, counter, daytime', 'dining room, indoors, table, evening',
  'bathroom, indoors, bathtub, tiles', 'entrance hall, indoors, shoe rack, door', 'apartment balcony, outdoors, city view, night',
  'apartment rooftop, outdoors, city skyline, sunset', 'attic, indoors, wooden beams, dusty', 'japanese room, indoors, tatami, sliding door',
  // school and work
  'classroom, indoors, desks, chalkboard, daytime', 'classroom, indoors, desks, sunset, orange light', 'school hallway, indoors, lockers, windows',
  'school rooftop, outdoors, fence, blue sky', 'school library, indoors, bookshelves, quiet', 'school infirmary, indoors, bed, curtain',
  'gymnasium, indoors, basketball court', 'school courtyard, outdoors, trees, benches', 'club room, indoors, cluttered table',
  'university lecture hall, indoors, tiered seats', 'office, indoors, desks, computers, daytime', 'office, indoors, night, city lights, window',
  'meeting room, indoors, long table, chairs', 'laboratory, indoors, equipment, white walls', 'hospital room, indoors, hospital bed, window',
  'hospital corridor, indoors, white walls, fluorescent lights',
  // town
  'cafe, indoors, window, daytime', 'cafe, indoors, warm lighting, evening', 'restaurant, indoors, tables, warm lighting',
  'bar, indoors, counter, bottles, dim lighting', 'izakaya, indoors, lanterns, wooden counter', 'convenience store, indoors, shelves, fluorescent lights',
  'supermarket, indoors, aisles, shelves', 'shopping mall, indoors, shops, crowd free', 'bookstore, indoors, bookshelves, warm lighting',
  'karaoke room, indoors, screen, neon lights', 'arcade, indoors, game machines, neon lights', 'movie theater, indoors, seats, screen, dark',
  'city street, outdoors, buildings, daytime', 'city street, outdoors, night, neon lights', 'city street, outdoors, rain, night, reflections',
  'alley, outdoors, narrow, night, dim', 'crosswalk, outdoors, traffic lights, city', 'bus stop, outdoors, bench, evening',
  'train station platform, outdoors, train, daytime', 'train interior, indoors, seats, window', 'subway station, indoors, platform, tiles',
  'park, outdoors, trees, benches, daytime', 'park, outdoors, night, street lamps', 'playground, outdoors, swings, sunset',
  'riverside, outdoors, river, bridge, sunset', 'bridge, outdoors, river, city lights, night', 'parking lot, outdoors, cars, night',
  'shrine, outdoors, torii, stone path', 'temple, outdoors, wooden building, garden', 'festival, outdoors, stalls, lanterns, night',
  'amusement park, outdoors, ferris wheel, daytime', 'aquarium, indoors, fish tanks, blue light', 'museum, indoors, exhibits, quiet',
  'church, indoors, stained glass, pews', 'police station, indoors, desks', 'hotel room, indoors, bed, window, city view',
  'hotel lobby, indoors, chandelier, marble floor', 'gym, indoors, exercise equipment', 'swimming pool, indoors, water, tiles',
  // nature
  'beach, outdoors, ocean, sand, daytime', 'beach, outdoors, ocean, sunset', 'forest, outdoors, trees, sunlight filtering',
  'forest, outdoors, night, moonlight', 'mountain path, outdoors, trees, rocks', 'mountain top, outdoors, sky, clouds, vista',
  'field, outdoors, grass, blue sky', 'flower field, outdoors, flowers, daytime', 'lake, outdoors, water, reflections, calm',
  'snowy field, outdoors, snow, winter', 'countryside road, outdoors, rice fields, summer', 'cherry blossoms, outdoors, petals, spring',
  'campsite, outdoors, tent, campfire, night', 'cave, indoors, rocks, dim light', 'desert, outdoors, sand dunes, heat',
  'waterfall, outdoors, mist, rocks', 'starry sky, outdoors, night, stars, open field',
  // fantasy
  'castle hall, indoors, throne, banners', 'castle corridor, indoors, stone walls, torches', 'royal bedroom, indoors, canopy bed, luxurious',
  'medieval town, outdoors, cobblestone, market', 'medieval tavern, indoors, wooden tables, fireplace', 'magic academy, indoors, library, magic circles',
  'dungeon, indoors, stone walls, chains, dark', 'throne room, indoors, red carpet, pillars', 'ancient ruins, outdoors, broken pillars, overgrown',
  'enchanted forest, outdoors, glowing plants, mist', 'village, outdoors, wooden houses, fields', 'blacksmith, indoors, forge, tools',
  'church of a fantasy kingdom, indoors, altar, candles',
  // science fiction and other
  'spaceship bridge, indoors, consoles, screens', 'spaceship corridor, indoors, metal walls, lights', 'futuristic city, outdoors, skyscrapers, holograms, night',
  'cyberpunk street, outdoors, neon signs, rain, night', 'laboratory, indoors, sci-fi, capsules, blue light', 'abandoned building, indoors, broken windows, debris',
  'warehouse, indoors, crates, dim light', 'rooftop, outdoors, night, city lights', 'car interior, indoors, seats, window, night',
]);
