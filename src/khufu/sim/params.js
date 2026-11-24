// Every setting of the event model, with the reasoning behind each number. The defaults
// are tuned so a full build lands near the calibration in issue #1: about 2.3 million
// blocks in about 20 years of 300 working days of 10 hours (~38 blocks an hour).
export const DAY = 10 * 3600; // a working day, in seconds of working time
export const YEAR_DAYS = 300;
export const MONTH_DAYS = 25; // 12 months of 25 working days
export const YEAR = YEAR_DAYS * DAY, MONTH = MONTH_DAYS * DAY;

export const DEFAULTS = {
  seed: 1,
  targetBlocks: 2.3e6, // the grid cell is sized so the courses come to this many blocks
  sectorM: 32, // a course is split into sectors about this wide, each with a landing
  density: { limestone: 2.3, granite: 2.65 }, // t/m³
  jitter: 0.15, // ±15 % spread on every duration and speed

  quarry: {
    at: [40, 480], // the main quarry, south of the pyramid (x east, z south)
    faces: 440, // quarrying crews at full strength in Akhet (the main calibration knob: see README and `rotation`)
    cutHours: 10, // hours for one crew to free a 1.2 m³ block (scaled by block volume)
    refVolume: 1.2,
    yardCap: 4000, // dressed blocks stacked in the quarry yard before faces stop
    bays: 24, // places where a sled can be loaded at once
    loadMin: 8,
    crew: 12,
  },
  harbour: {
    at: [950, 120], // the harbour basin east of the plateau, below the valley temple
    berths: 3, // boats unloading at once
    bays: 6, // sled-loading places on the quay
  },
  haul: { // sled gangs on the Giza quarry run
    gangs: 112, // at full strength (see `rotation`)
    crew: 20, // one division: a sled with a ~2.5–4 t block on a wetted track
    vLoaded: 0.55, // m/s on the flat
    vEmpty: 1.1, // walking back with the empty sled
    climbK: 6, // speed on a ramp = vLoaded / (1 + climbK × grade)
    unloadMin: 4, // levering the block off the sled at the landing
  },
  tura: { // the fine casing stone, by boat from Tura across the river
    gangs: 8, // sled gangs on the harbour run
    boats: 24,
    boatLoad: 6, // casing blocks per boat
    tripDays: 4, // Tura → Giza → Tura, as in the papyri of Merer
    unloadMinPerBlock: 20,
    stockCap: 1500, // blocks on the quay before boats wait at Tura
    boatCrew: 40,
  },
  granite: { // Aswan granite, by barge at high water once a year
    convoyDay: 70, // working day of the year the convoy arrives
    perConvoy: 160,
    unloadDays: 5,
  },
  heavy: { // big gangs for granite and the roof beams of the special works
    gangs: 4,
    crew: 120,
    speedFactor: 0.35, // of a normal sled's speed
    loadHoursPerTonne: 0.12, loadHoursMin: 1,
    setHoursPerTonne: 0.25, setHoursMin: 2,
  },
  set: { // crews at each sector landing
    crewsPerSector: 2,
    crew: 8,
    baseMin: 12, // a 0.75 m block, levered and fitted (scaled by course height and dressing)
    leverSpeed: 0.12, // m/s moving a block across the bed from the landing to its place
  },
  landing: { berths: 2 },
  ramp: { // the ramp theory (src/khufu/sim/ramps/): 'straight-zigzag', 'spiral' or 'internal'
    id: 'straight-zigzag',
    switchY: 45, // straight ramps up to here (just above the King's Chamber floor), zigzags (or the internal ramp) above
    straight: { grade: 1 / 8, lanes: 2, headway: 75, width: 18 },
    zigzag: { grade: 1 / 6, lanes: 1, headway: 75, turnTime: 180, width: 7, flightFrac: 0.8 },
    // four ledges, one starting from each corner, winding up round the faces; a sled turns
    // round the arris at every corner
    spiral: { grade: 1 / 10, lanes: 1, headway: 75, turnTime: 90, width: 7 },
    // Houdin's internal ramp: a gallery inside the masonry `inset` m in from the face, at 7 %,
    // with a notch open to the sky at each corner where the sled is turned with levers
    internal: { grade: 1 / 14, lanes: 1, headway: 75, turnTime: 150, width: 3, inset: 12, clearance: 3 },
  },
  // The flood calendar: 12 months of 25 working days, four to a season. Akhet (the flood)
  // frees the farmers, so the levies are largest then; in Peret (sowing) and Shemu (harvest)
  // fewer can be spared. High water also shortens the boats' trip from Tura, and the Aswan
  // convoy comes in on it (granite.convoyDay is in Akhet).
  seasons: {
    levy: [1, 0.6, 0.4], // share of the levy on site in Akhet, Peret, Shemu
    turaTrip: [0.8, 1, 1.25], // Tura round trip, times tura.tripDays
  },
  // Workforce rotation: a core of skilled crews works all year (the setting crews, the Tura
  // and heavy gangs, the boat crews and the first `core` quarry crews and Giza sled gangs).
  // The rest are levies who serve a month at a time: each month's group leaves as it ends,
  // and the next arrives `changeoverHours` later, sized by the season. quarry.faces and
  // haul.gangs are the numbers at full strength (Akhet); `core` is the share kept all year.
  rotation: { coreFaces: 0.5, coreGangs: 0.64, changeoverHours: 5 },
  workforce: { rampCrew: 2500, supportFactor: 0.35 }, // ramp builders; bakers, brewers, smiths… as a share of the rest
};

// the flood calendar: season (0 Akhet, 1 Peret, 2 Shemu) and month (0–11) of working time t
export const SEASONS = ['Akhet', 'Peret', 'Shemu'];
export const monthOfYear = (t) => Math.floor((t % YEAR) / MONTH);
export const seasonOf = (t) => Math.floor(monthOfYear(t) / 4);

// deep merge of overrides into the defaults
export function withDefaults(over = {}, base = DEFAULTS) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? withDefaults(v, base[k]) : v;
  return out;
}
