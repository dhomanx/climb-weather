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
  const scores = [
    scorePrecip(precip),
    scorePrecipProb(precipProb),
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

// When both sources are available, use the more pessimistic values per parameter
export function combineHourlyParams(metNorway, openMeteo) {
  return {
    precip: Math.max(metNorway.precip ?? 0, openMeteo.precip ?? 0),
    precipProb: Math.max(metNorway.precipProb ?? 0, openMeteo.precipProb ?? 0),
    windKmh: Math.max(metNorway.windKmh ?? 0, openMeteo.windKmh ?? 0),
    humidity: Math.max(metNorway.humidity ?? 0, openMeteo.humidity ?? 0),
  };
}

export function combineDailyParams(metNorway, openMeteo) {
  return {
    totalPrecip: Math.max(metNorway.totalPrecip ?? 0, openMeteo.totalPrecip ?? 0),
    maxWind: Math.max(metNorway.maxWind ?? 0, openMeteo.maxWind ?? 0),
    avgHumidity: Math.max(metNorway.avgHumidity ?? 0, openMeteo.avgHumidity ?? 0),
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

function scorePrecip(mm) {
  if (mm === 0) return 'green';
  if (mm <= 0.5) return 'amber';
  return 'red';
}

function scorePrecipProb(pct) {
  if (pct < 30) return 'green';
  if (pct <= 60) return 'amber';
  return 'red';
}

function scoreWind(kmh) {
  if (kmh < 30) return 'green';
  if (kmh <= 50) return 'amber';
  return 'red';
}

function scoreHumidity(pct) {
  if (pct < 70) return 'green';
  if (pct <= 85) return 'amber';
  return 'red';
}

function scoreDailyPrecip(mm) {
  if (mm < 1) return 'green';
  if (mm <= 5) return 'amber';
  return 'red';
}

function worstScore(scores) {
  if (scores.includes('red')) return 'red';
  if (scores.includes('amber')) return 'amber';
  return 'green';
}
