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
    faces: 365, // quarrying crews working at once (the main calibration knob: see README)
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
    gangs: 100,
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
  ramp: {
    id: 'straight-zigzag',
    switchY: 45, // straight ramps up to here (just above the King's Chamber floor), zigzags above
    straight: { grade: 1 / 8, lanes: 2, headway: 75, width: 18 },
    zigzag: { grade: 1 / 6, lanes: 1, headway: 75, turnTime: 180, width: 7, flightFrac: 0.8 },
  },
  workforce: { rampCrew: 2500, supportFactor: 0.35 }, // ramp builders; bakers, brewers, smiths… as a share of the rest
};

// deep merge of overrides into the defaults
export function withDefaults(over = {}, base = DEFAULTS) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? withDefaults(v, base[k]) : v;
  return out;
}
