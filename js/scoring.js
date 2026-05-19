// Climbability scoring — returns "green", "amber", or "red"

const ROCK_TYPE_DRYING_MULTIPLIER = {
  granite: 1.0,
  quartzite: 1.0,
  'mica-schist': 1.2,
  dolerite: 1.3,
  limestone: 1.5,
  sandstone: 1.5,
};

export function scoreHour({ precip = 0, precipProb = 0, windKmh = 0, humidity = 0 }) {
  // Use expected precipitation (amount × probability) to avoid false reds from
  // trace drizzle at high confidence. When precipProb is 0 (no prob data from
  // MET Norway), fall back to the raw amount.
  const effectivePrecip = precipProb > 0 ? precip * (precipProb / 100) : precip;
  const scores = [
    scorePrecip(effectivePrecip),
    scoreWind(windKmh),
    scoreHumidity(humidity),
  ];
  return worstScore(scores);
}

export function scoreDay({ totalPrecip = 0, maxWind = 0, avgHumidity = 0 }) {
  const scores = [
    scoreDailyPrecip(totalPrecip),
    scoreWind(maxWind),
    scoreHumidity(avgHumidity),
  ];
  return worstScore(scores);
}

export function combineHourlyParams(a, b, mode = 'pessimistic') {
  const pick = (x, y) => {
    const av = x ?? 0, bv = y ?? 0;
    if (mode === 'optimistic') return Math.min(av, bv);
    if (mode === 'balanced') return (av + bv) / 2;
    return Math.max(av, bv);
  };
  // windDir follows the higher-wind source for shelter assessment
  const windDir = (a.windKmh ?? 0) >= (b.windKmh ?? 0) ? (a.windDir ?? 0) : (b.windDir ?? 0);
  return {
    precip: pick(a.precip, b.precip),
    precipProb: pick(a.precipProb, b.precipProb),
    windKmh: pick(a.windKmh, b.windKmh),
    windDir,
    humidity: pick(a.humidity, b.humidity),
    tempC: ((a.tempC ?? 0) + (b.tempC ?? 0)) / 2,
    cloudPct: pick(a.cloudPct, b.cloudPct),
  };
}

export function combineDailyParams(metNorway, openMeteo, mode = 'pessimistic') {
  const pick = (x, y) => {
    const av = x ?? 0, bv = y ?? 0;
    if (mode === 'optimistic') return Math.min(av, bv);
    if (mode === 'balanced') return (av + bv) / 2;
    return Math.max(av, bv);
  };
  return {
    totalPrecip: pick(metNorway.totalPrecip, openMeteo.totalPrecip),
    climbingHoursPrecip: pick(metNorway.climbingHoursPrecip, openMeteo.climbingHoursPrecip),
    maxWind: pick(metNorway.maxWind, openMeteo.maxWind),
    avgHumidity: pick(metNorway.avgHumidity, openMeteo.avgHumidity),
    minTemp: ((metNorway.minTemp ?? 0) + (openMeteo.minTemp ?? 0)) / 2,
    maxTemp: ((metNorway.maxTemp ?? 0) + (openMeteo.maxTemp ?? 0)) / 2,
  };
}

export function modelAgreement(metNorwayPrecip, openMeteoPrecip) {
  const mnRain = metNorwayPrecip > 0.5;
  const omRain = openMeteoPrecip > 0.5;
  if (!mnRain && !omRain) return 'Models agree — dry';
  if (mnRain && omRain) return 'Both predict rain';
  return 'Models disagree';
}

export function dryingEstimate({ hoursSinceRain, windKmh = 0, humidity = 0, rockType = 'granite' }) {
  const multiplier = ROCK_TYPE_DRYING_MULTIPLIER[rockType] ?? 1.0;
  let dryThreshold = 24 * multiplier;
  let dampThreshold = 6 * multiplier;

  if (windKmh > 20) {
    dryThreshold *= 0.7;
    dampThreshold *= 0.7;
  }
  if (humidity > 80) {
    dryThreshold *= 1.5;
    dampThreshold *= 1.5;
  }

  if (hoursSinceRain > dryThreshold) return 'Likely dry';
  if (hoursSinceRain > dampThreshold) return 'Probably still damp';
  return 'Recently rained — allow drying time';
}

// compass direction string to degrees
const ASPECT_DEGREES = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

export function windExposure(windDirectionDeg, cragAspect) {
  const cragDeg = ASPECT_DEGREES[cragAspect] ?? 0;
  // Wind direction = where wind comes FROM. Exposed if wind blows INTO the face.
  // The face "looks out" in the aspect direction; wind blows INTO the face
  // when it comes from the aspect direction.
  let diff = Math.abs(windDirectionDeg - cragDeg);
  if (diff > 180) diff = 360 - diff;

  if (diff <= 45) return 'Exposed';
  if (diff <= 90) return 'Partially exposed';
  return 'Sheltered';
}

// --- internal helpers ---

export function scorePrecip(mm) {
  if (mm === 0) return 'green';
  if (mm <= 0.5) return 'amber';
  return 'red';
}

export function scoreWind(kmh) {
  if (kmh < 30) return 'green';
  if (kmh <= 50) return 'amber';
  return 'red';
}

export function scoreHumidity(pct) {
  if (pct < 70) return 'green';
  if (pct <= 85) return 'amber';
  return 'red';
}

export function scoreDailyPrecip(mm) {
  if (mm < 1) return 'green';
  if (mm <= 5) return 'amber';
  return 'red';
}

export function scoreTemp(c) {
  if (c >= 8 && c <= 22) return 'green';
  if (c >= 2 && c <= 28) return 'amber';
  return 'red';
}

function worstScore(scores) {
  if (scores.includes('red')) return 'red';
  if (scores.includes('amber')) return 'amber';
  return 'green';
}
