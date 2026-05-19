// API layer — all fetches + localStorage cache

const USER_AGENT = 'IrishClimbingWeather/1.0 (github.com/dhomanx/climb-weather)';

const TTL = {
  metNorway: 60 * 60 * 1000,
  openMeteo: 60 * 60 * 1000,
  observations: 20 * 60 * 1000,
  warnings: 20 * 60 * 1000,
  sunrise: 24 * 60 * 60 * 1000,
};

// MET Norway may need CORS proxy for met.ie endpoints. We detect on first call.
let corsProxyBase = null; // set if direct fetch fails

// --- Cache helpers ---

function cacheKey(type, ...parts) {
  return `icw:${type}:${parts.join(':')}`;
}

function getCached(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, fetchedAt } = JSON.parse(raw);
    if (Date.now() - fetchedAt > ttlMs) return null;
    return data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch {
    // Storage full — silently skip
  }
}

export function getCacheFetchedAt(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw).fetchedAt;
  } catch {
    return null;
  }
}

export function getOldestCacheTimestamp(keys) {
  let oldest = null;
  for (const key of keys) {
    const ts = getCacheFetchedAt(key);
    if (ts !== null && (oldest === null || ts < oldest)) oldest = ts;
  }
  return oldest;
}

export function forceRefresh() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('icw:')) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

// --- MET Norway Locationforecast ---

export async function fetchMetNorwayForecast(lat, lon) {
  const key = cacheKey('mn', lat, lon);
  const cached = getCached(key, TTL.metNorway);
  if (cached) return cached;

  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!resp.ok) throw new Error(`MET Norway ${resp.status}`);
  const data = await resp.json();
  setCache(key, data);
  return data;
}

export function parseMetNorwayForecast(data) {
  const timeseries = data?.properties?.timeseries ?? [];
  return timeseries.map(entry => {
    const inst = entry.data?.instant?.details ?? {};
    const next1h = entry.data?.next_1_hours?.details ?? {};
    const next6h = entry.data?.next_6_hours?.details ?? {};
    const has1h = next1h.precipitation_amount !== undefined;
    const precip = has1h ? next1h.precipitation_amount : (next6h.precipitation_amount ?? 0);
    return {
      time: entry.time,
      interval: has1h ? 1 : 6,
      precip,
      precipProb: null, // not provided by MET Norway compact
      windKmh: (inst.wind_speed ?? 0) * 3.6,
      windDir: inst.wind_from_direction ?? 0,
      humidity: inst.relative_humidity ?? 0,
      tempC: inst.air_temperature ?? 0,
      cloudPct: inst.cloud_area_fraction ?? 0,
      dewPointC: inst.dew_point_temperature ?? null,
    };
  });
}

// --- Open-Meteo ---

const OPEN_METEO_PARAMS = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_direction_10m',
  'relative_humidity_2m',
  'cloud_cover',
  'dew_point_2m',
].join(',');

export async function fetchOpenMeteoForecast(lat, lon) {
  const key = cacheKey('om', lat, lon);
  const cached = getCached(key, TTL.openMeteo);
  if (cached) return cached;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${OPEN_METEO_PARAMS}&forecast_days=7&wind_speed_unit=kmh&timezone=Europe%2FDublin`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}`);
  const data = await resp.json();
  setCache(key, data);
  return data;
}

export function parseOpenMeteoForecast(data) {
  const h = data?.hourly ?? {};
  const times = h.time ?? [];
  return times.map((time, i) => ({
    time: time + ':00Z', // ISO-ish
    precip: h.precipitation?.[i] ?? 0,
    precipProb: h.precipitation_probability?.[i] ?? 0,
    windKmh: h.wind_speed_10m?.[i] ?? 0,
    windDir: h.wind_direction_10m?.[i] ?? 0,
    humidity: h.relative_humidity_2m?.[i] ?? 0,
    tempC: h.temperature_2m?.[i] ?? 0,
    cloudPct: h.cloud_cover?.[i] ?? 0,
    dewPointC: h.dew_point_2m?.[i] ?? null,
  }));
}

// --- Met Éireann Observations ---

async function fetchXml(url) {
  // Try direct first; fall back to CORS proxy if needed
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}`);
    return await resp.text();
  } catch (err) {
    if (corsProxyBase) {
      const resp = await fetch(`${corsProxyBase}?url=${encodeURIComponent(url)}`);
      if (!resp.ok) throw new Error(`Proxy ${resp.status}`);
      return await resp.text();
    }
    throw err;
  }
}

export async function fetchObservations() {
  const key = cacheKey('obs');
  const cached = getCached(key, TTL.observations);
  if (cached) return cached;

  const xml = await fetchXml('https://www.met.ie/Open_Data/xml/obs_present.xml');
  setCache(key, xml);
  return xml;
}

const COMPASS_DEG = {
  'N':0,'NNE':22.5,'NE':45,'ENE':67.5,'E':90,'ESE':112.5,'SE':135,'SSE':157.5,
  'S':180,'SSW':202.5,'SW':225,'WSW':247.5,'W':270,'WNW':292.5,'NW':315,'NNW':337.5,
};
function compassToDeg(s) { return s ? (COMPASS_DEG[s.trim().toUpperCase()] ?? null) : null; }

export function parseObservations(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const stations = {};
  doc.querySelectorAll('station').forEach(el => {
    const name = el.getAttribute('name');
    if (!name) return;
    const getText = tag => el.querySelector(tag)?.textContent?.trim() ?? null;
    const getNum = tag => {
      const t = getText(tag);
      if (!t || t === 'Trace') return null;
      const n = parseFloat(t);
      return isNaN(n) ? null : n;
    };
    stations[name] = {
      name,
      tempC: getNum('temp'),
      humidity: getNum('humidity'),
      windKmh: getNum('wind_speed') !== null ? getNum('wind_speed') * 1.852 : null,
      windDir: compassToDeg(getText('wind_direction')),
      rainMmH: getNum('rainfall'),
      pressureHpa: getNum('pressure'),
      weatherDesc: getText('weather_text') ?? '',
    };
  });
  return stations;
}

// --- Met Éireann Warnings ---

export async function fetchWarnings() {
  const key = cacheKey('warn');
  const cached = getCached(key, TTL.warnings);
  if (cached) return cached;

  const xml = await fetchXml('https://www.met.ie/warningsxml/rss.xml');
  setCache(key, xml);
  return xml;
}

export function parseWarnings(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const warnings = [];

  doc.querySelectorAll('item').forEach(item => {
    const title = item.querySelector('title')?.textContent ?? '';
    const desc = item.querySelector('description')?.textContent ?? '';
    const link = item.querySelector('link')?.textContent ?? '';

    // Parse colour from title: "Status Orange Wind Warning"
    const colourMatch = title.match(/\b(Red|Orange|Yellow)\b/i);
    const colour = colourMatch ? colourMatch[1].toLowerCase() : 'yellow';

    // Parse counties from description (rough heuristic)
    const countyMatch = desc.match(/counties?[:\s]+([^.]+)/i);
    const counties = countyMatch
      ? countyMatch[1].split(/[,\s]+/).map(c => c.trim()).filter(Boolean)
      : [];

    // Parse warning type
    const typeMatch = title.match(/\b(Wind|Rain|Snow|Ice|Fog|Thunder)\b/i);
    const type = typeMatch ? typeMatch[1] : 'Weather';

    warnings.push({ title, description: desc, colour, counties, type, link });
  });

  return warnings;
}

// --- Sunrise / Sunset ---

export async function fetchSunrise(lat, lon, date) {
  const key = cacheKey('sun', lat, lon, date);
  const cached = getCached(key, TTL.sunrise);
  if (cached) return cached;

  const offsetMins = -new Date().getTimezoneOffset();
  const offsetStr = (offsetMins >= 0 ? '+' : '-') +
    String(Math.floor(Math.abs(offsetMins) / 60)).padStart(2, '0') + ':' +
    String(Math.abs(offsetMins) % 60).padStart(2, '0');
  const url = `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${lat}&lon=${lon}&date=${date}&offset=${encodeURIComponent(offsetStr)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) throw new Error(`Sunrise API ${resp.status}`);
  const data = await resp.json();
  setCache(key, data);
  return data;
}

export function parseSunrise(data) {
  const props = data?.properties ?? {};
  const sunrise = props.sunrise?.time ?? null;
  const sunset = props.sunset?.time ?? null;
  // civil_twilight not returned for Irish latitudes — estimate as ±30 min
  const civilTwilightStart = props.civil_twilight_begin?.time ??
    (sunrise ? new Date(new Date(sunrise).getTime() - 30 * 60000).toISOString() : null);
  const civilTwilightEnd = props.civil_twilight_end?.time ??
    (sunset ? new Date(new Date(sunset).getTime() + 30 * 60000).toISOString() : null);
  return { sunrise, sunset, civilTwilightStart, civilTwilightEnd };
}

// --- Convenience: daily summary from hourly data ---

export function buildDailySummaries(hourly) {
  const days = {};
  for (const h of hourly) {
    const day = h.time.slice(0, 10);
    if (!days[day]) days[day] = { hours: [] };
    days[day].hours.push(h);
  }
  return Object.entries(days).map(([date, { hours }]) => {
    const totalPrecip = hours.reduce((s, h) => s + (h.precip ?? 0), 0);
    const climbingHours = hours.filter(h => { const hr = parseInt(h.time.slice(11, 13), 10); return hr >= 10 && hr < 20; });
    const climbingHoursPrecip = climbingHours.reduce((s, h) => s + (h.precip ?? 0), 0);
    const maxWind = Math.max(...hours.map(h => h.windKmh ?? 0));
    const avgHumidity = hours.reduce((s, h) => s + (h.humidity ?? 0), 0) / hours.length;
    const minTemp = Math.min(...hours.map(h => h.tempC ?? 99));
    const maxTemp = Math.max(...hours.map(h => h.tempC ?? -99));
    return { date, totalPrecip, climbingHoursPrecip, maxWind, avgHumidity, minTemp, maxTemp, hours };
  });
}
