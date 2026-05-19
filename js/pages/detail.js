import {
  fetchMetNorwayForecast, parseMetNorwayForecast,
  fetchOpenMeteoForecast, parseOpenMeteoForecast,
  fetchObservations, parseObservations,
  fetchSunrise, parseSunrise,
  fetchWarnings, parseWarnings,
} from '../api.js';
import {
  scoreHour, combineHourlyParams, combineDailyParams,
  dryingEstimate, windExposure, modelAgreement,
  scorePrecip, scoreWind, scoreHumidity, scoreTemp, scoreDailyPrecip,
} from '../scoring.js';
import {
  formatTime, formatDate, formatDateShort, windArrow,
  applyScore, scoreLabel, showToast, todayISO, next7Days, degToCardinal,
  showFreshnessBar,
} from '../ui.js';
import { getOldestCacheTimestamp } from '../api.js';
import { toggleFavourite, isFavourite } from '../favourites.js';
import { renderLocationWarnings } from '../warnings.js';
import { getMode } from '../settings.js';
import { registerModeHandler } from '../events.js';

// Module-level state so mode changes can re-render sections without re-fetching
let _detailState = null; // { locId, location, mnHourly, omHourly }

export async function renderDetail(location) {
  const mode = getMode();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="detail-header">
      <a href="#/overview" class="back-link">← All Locations</a>
      <div class="detail-title-row">
        <h1>${location.name}</h1>
        <button class="fav-star ${isFavourite(location.id) ? 'active' : ''}" id="detail-fav-btn" title="Favourite">★</button>
      </div>
      <div id="sun-times" class="sun-times"></div>
      <div class="detail-meta">
        <span>${location.region}</span>
        <span>${location.elevation_m}m</span>
        <span>Aspect: ${location.aspect}</span>
        <span>${capitalise(location.rock_type)}</span>
      </div>
      ${location.notes ? `<p class="detail-notes">${location.notes}</p>` : ''}
      <div id="location-warnings"></div>
    </div>

    <div class="detail-body">
      <section id="current-obs" class="detail-section">
        <h2>Current Conditions</h2>
        <div class="obs-loading">Loading observations…</div>
      </section>


      <section id="hourly-section" class="detail-section">
        <h2>Hourly Forecast</h2>
        <div class="hourly-loading">Loading forecast…</div>
      </section>

      <section id="model-section" class="detail-section">
        <h2>Model Comparison</h2>
        <div class="model-loading">Loading…</div>
      </section>

      <section id="drying-section" class="detail-section">
        <h2>Recent Rainfall &amp; Drying Estimate</h2>
        <div class="drying-loading">Loading…</div>
      </section>
    </div>`;

  document.getElementById('detail-fav-btn')?.addEventListener('click', (e) => {
    const nowFav = toggleFavourite(location.id);
    e.currentTarget.classList.toggle('active', nowFav);
    showToast(nowFav ? 'Added to favourites' : 'Removed from favourites');
  });

  registerModeHandler(newMode => {
    if (_detailState) applyDetailMode(_detailState.location, _detailState.mnHourly, _detailState.omHourly, newMode);
  });

  const today = todayISO();

  // Fire all fetches in parallel
  const [mnResult, omResult, obsResult, sunResult, warnResult] = await Promise.allSettled([
    fetchMetNorwayForecast(location.lat, location.lon).then(parseMetNorwayForecast),
    fetchOpenMeteoForecast(location.lat, location.lon).then(parseOpenMeteoForecast),
    fetchObservations().then(parseObservations),
    fetchSunrise(location.lat, location.lon, today),
    fetchWarnings().then(parseWarnings),
  ]);

  const mnHourly = mnResult.status === 'fulfilled' ? mnResult.value : null;
  const omHourly = omResult.status === 'fulfilled' ? omResult.value : null;
  const observations = obsResult.status === 'fulfilled' ? obsResult.value : null;
  const sunriseData = sunResult.status === 'fulfilled' ? parseSunrise(sunResult.value) : null;
  const warnings = warnResult.status === 'fulfilled' ? warnResult.value : [];

  // Warnings for this county
  const warnContainer = document.getElementById('location-warnings');
  if (warnContainer) renderLocationWarnings(warnContainer, warnings, location.county);

  // Update freshness bar now that detail fetches have landed
  const cacheKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('icw:')) cacheKeys.push(k);
  }
  showFreshnessBar(getOldestCacheTimestamp(cacheKeys));

  // Observations and daylight don't depend on mode
  renderObservations(location, observations);
  renderDaylight(sunriseData);

  // Store state now so mode buttons can re-render sections instantly
  _detailState = { locId: location.id, location, mnHourly, omHourly };

  // Use getMode() at call time — picks up any mode change made while loading
  applyDetailMode(location, mnHourly, omHourly, getMode());

  // Drying estimate doesn't depend on mode
  renderDryingEstimate(location, mnHourly ?? omHourly);
}

function applyDetailMode(location, mnHourly, omHourly, mode) {
  const sectionIds = ['hourly-section', 'model-section'];

  // Briefly fade sections so the user sees something happened
  sectionIds.forEach(id => {
    const s = document.getElementById(id);
    if (s) s.style.opacity = '0.4';
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (mnHourly || omHourly) {
        renderHourly(location, mnHourly, omHourly, mode);
      } else {
        const s = document.getElementById('hourly-section');
        if (s) s.innerHTML = '<h2>Hourly Forecast</h2><p class="error-state">Forecast unavailable.</p>';
      }

      if (mnHourly && omHourly) {
        renderModelComparison(mnHourly, omHourly, mode);
      } else {
        const s = document.getElementById('model-section');
        if (s) s.innerHTML = '<h2>Model Comparison</h2><p>Only one data source available.</p>';
      }

      // Clear fade (sections were replaced but the section elements remain)
      sectionIds.forEach(id => {
        const s = document.getElementById(id);
        if (s) s.style.opacity = '';
      });
    });
  });
}

function renderObservations(location, observations) {
  const section = document.getElementById('current-obs');
  if (!observations) {
    section.innerHTML = '<h2>Current Conditions</h2><p class="error-state">Observations unavailable.</p>';
    return;
  }
  const obs = observations[location.nearest_station];
  if (!obs) {
    section.innerHTML = `<h2>Current Conditions</h2><p class="muted">No data for station: ${location.nearest_station}</p>`;
    return;
  }

  const score = scoreHour({
    precip: obs.rainMmH ?? 0,
    precipProb: 0,
    windKmh: obs.windKmh ?? 0,
    humidity: obs.humidity ?? 0,
  });

  section.innerHTML = `
    <h2>Current Conditions</h2>
    <div class="obs-score score-pill score-${score}">${scoreLabel(score)}</div>
    <p class="obs-desc">${obs.weatherDesc || '—'}</p>
    <div class="obs-grid">
      <div class="obs-item"><span class="obs-label">Temp</span><span>${obs.tempC !== null ? obs.tempC + '°C' : '—'}</span></div>
      <div class="obs-item"><span class="obs-label">Rain rate</span><span>${obs.rainMmH !== null ? obs.rainMmH + 'mm/h' : '—'}</span></div>
      <div class="obs-item"><span class="obs-label">Wind</span><span>${obs.windKmh !== null ? Math.round(obs.windKmh) + 'km/h' : '—'}</span></div>
      <div class="obs-item"><span class="obs-label">Humidity</span><span>${obs.humidity !== null ? obs.humidity + '%' : '—'}</span></div>
      <div class="obs-item"><span class="obs-label">Pressure</span><span>${obs.pressureHpa !== null ? obs.pressureHpa + 'hPa' : '—'}</span></div>
    </div>
    <p class="obs-station-note">Station: ${location.nearest_station} (nearest Met Éireann station)</p>`;
}

function renderDaylight(sunriseData) {
  const el = document.getElementById('sun-times');
  if (!el) return;
  if (!sunriseData) return;
  const { sunrise, sunset } = sunriseData;
  el.innerHTML = `<span>🌅 ${formatTime(sunrise)}</span><span>🌇 ${formatTime(sunset)}</span>`;
}

function renderHourly(location, mnHourly, omHourly, mode) {
  const section = document.getElementById('hourly-section');
  const now = new Date();
  const cutoff7 = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  const mnByTime = Object.fromEntries((mnHourly ?? []).map(h => [h.time.slice(0, 13), h]));
  const omByTime = Object.fromEntries((omHourly ?? []).map(h => [h.time.slice(0, 13), h]));

  const allKeys = [...new Set([...Object.keys(mnByTime), ...Object.keys(omByTime)])]
    .filter(k => { const d = new Date(k + ':00:00Z'); return d >= now && d < cutoff7; })
    .sort();

  if (!allKeys.length) {
    section.innerHTML = '<h2>Hourly Forecast</h2><p>No hourly data available.</p>';
    return;
  }

  // Find where MN switches from 1h to 6h entries — that's the band zone start
  const firstBandKey = allKeys.find(k => mnByTime[k]?.interval === 6);
  const hourlyKeys = firstBandKey ? allKeys.filter(k => k < firstBandKey) : allKeys;
  const bandAnchors = allKeys.filter(k => k >= (firstBandKey ?? '￿') && mnByTime[k]?.interval === 6);

  function formatDayHeader(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return `${d.toLocaleDateString('en-IE', { weekday: 'short' })}<br><span style="white-space:nowrap">${d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}</span>`;
  }

  const REST_HEADERS = `<th>Precip<br>mm</th><th>Temp</th><th>Wind<br>km/h</th><th>Hum&nbsp;%</th><th>Cloud&nbsp;%</th><th>Shelter</th>`;

  function hourRow(k) {
    const mn = mnByTime[k], om = omByTime[k];
    if (!mn && !om) return '';
    const p = mn && om ? combineHourlyParams(mn, om, mode) : (mn ?? om);
    const eff = (p.precipProb ?? 0) > 0 ? p.precip * (p.precipProb / 100) : p.precip;
    const windDeg = p.windDir ?? 0;
    const cardinal = degToCardinal(windDeg);
    const exposure = windExposure(windDeg, location.aspect);
    const expClass = exposure === 'Sheltered' ? 'sheltered' : exposure === 'Exposed' ? 'exposed' : 'partial';
    return `<tr class="score-row">
      <td class="hour-time">${formatTime(k + ':00:00Z')}</td>
      <td class="score-${scorePrecip(eff)}">${p.precip.toFixed(1)}</td>
      <td class="score-${scoreTemp(p.tempC)}">${Math.round(p.tempC)}°</td>
      <td class="wind-cell score-${scoreWind(p.windKmh)}" title="from ${cardinal}" data-cardinal="${cardinal}">${Math.round(p.windKmh)}&thinsp;<span class="wind-arrow" style="transform:rotate(${windDeg}deg)">↑</span></td>
      <td class="score-${scoreHumidity(p.humidity)}">${Math.round(p.humidity)}</td>
      <td>${Math.round(p.cloudPct ?? 0)}</td>
      <td class="exposure-${expClass}">${exposure}</td>
    </tr>`;
  }

  function pick(a, b) {
    if (mode === 'optimistic') return Math.min(a, b);
    if (mode === 'pessimistic') return Math.max(a, b);
    return (a + b) / 2;
  }

  function bandRow(anchorKey) {
    const mn = mnByTime[anchorKey]; // precip is already the 6h total

    // Collect the 6 OM hourly entries that fall inside this band
    const omEntries = [];
    for (let offset = 0; offset < 6; offset++) {
      const t = new Date(anchorKey + ':00:00Z');
      t.setUTCHours(t.getUTCHours() + offset);
      const om = omByTime[t.toISOString().slice(0, 13)];
      if (om) omEntries.push(om);
    }

    if (!mn && !omEntries.length) return '';

    // Aggregate OM across the band
    let omPrecip = 0, omMaxWind = 0, omSumTemp = 0, omSumHum = 0, omSumCloud = 0, omSumProb = 0;
    for (const om of omEntries) {
      omPrecip += om.precip ?? 0;
      omMaxWind = Math.max(omMaxWind, om.windKmh ?? 0);
      omSumTemp += om.tempC ?? 0;
      omSumHum += om.humidity ?? 0;
      omSumCloud += om.cloudPct ?? 0;
      omSumProb += om.precipProb ?? 0;
    }
    const n = omEntries.length;
    const omAvgTemp = n ? omSumTemp / n : 0;
    const omAvgHum  = n ? omSumHum  / n : 0;
    const omAvgCloud = n ? omSumCloud / n : 0;
    const omAvgProb  = n ? omSumProb  / n : 0;
    const omMidDir = omEntries[Math.floor(n / 2)]?.windDir ?? 0;

    // Combine MN band values with aggregated OM values
    let totalPrecip, maxWind, avgTemp, avgHum, avgCloud, windDir, avgProb;
    if (mn && n) {
      totalPrecip = pick(mn.precip, omPrecip);
      maxWind     = pick(mn.windKmh, omMaxWind);
      avgTemp     = (mn.tempC + omAvgTemp) / 2;
      avgHum      = pick(mn.humidity, omAvgHum);
      avgCloud    = pick(mn.cloudPct ?? 0, omAvgCloud);
      windDir     = mn.windKmh >= omMaxWind ? (mn.windDir ?? 0) : omMidDir;
      avgProb     = omAvgProb;
    } else if (mn) {
      totalPrecip = mn.precip; maxWind = mn.windKmh; avgTemp = mn.tempC;
      avgHum = mn.humidity; avgCloud = mn.cloudPct ?? 0;
      windDir = mn.windDir ?? 0; avgProb = 0;
    } else {
      totalPrecip = omPrecip; maxWind = omMaxWind; avgTemp = omAvgTemp;
      avgHum = omAvgHum; avgCloud = omAvgCloud; windDir = omMidDir; avgProb = omAvgProb;
    }

    const eff = avgProb > 0 ? totalPrecip * (avgProb / 100) : totalPrecip;
    const cardinal = degToCardinal(windDir);
    const exposure = windExposure(windDir, location.aspect);
    const expClass = exposure === 'Sheltered' ? 'sheltered' : exposure === 'Exposed' ? 'exposed' : 'partial';

    // Label in local time
    const startH = new Date(anchorKey + ':00:00Z').getHours();
    const endH = startH + 6;
    const endDisplay = endH % 24;
    const label = `${String(startH).padStart(2, '0')}–${endDisplay === 0 ? '24' : String(endDisplay).padStart(2, '0')}`;

    return `<tr class="score-row band-row">
      <td class="hour-time">${label}</td>
      <td class="score-${scoreDailyPrecip(eff)}">${totalPrecip.toFixed(1)}</td>
      <td class="score-${scoreTemp(avgTemp)}">${Math.round(avgTemp)}°</td>
      <td class="wind-cell score-${scoreWind(maxWind)}" title="from ${cardinal}" data-cardinal="${cardinal}">${Math.round(maxWind)}&thinsp;<span class="wind-arrow" style="transform:rotate(${windDir}deg)">↑</span></td>
      <td class="score-${scoreHumidity(avgHum)}">${Math.round(avgHum)}</td>
      <td>${Math.round(avgCloud)}</td>
      <td class="exposure-${expClass}">${exposure}</td>
    </tr>`;
  }

  let bodyHtml = '';
  let currentDate = null;

  function checkDayChange(dateStr) {
    if (dateStr !== currentDate) {
      if (currentDate !== null) {
        bodyHtml += `<tr class="day-header-row"><th>${formatDayHeader(dateStr)}</th>${REST_HEADERS}</tr>`;
      }
      currentDate = dateStr;
    }
  }

  for (const k of hourlyKeys) {
    checkDayChange(k.slice(0, 10));
    bodyHtml += hourRow(k);
  }
  for (const k of bandAnchors) {
    checkDayChange(k.slice(0, 10));
    bodyHtml += bandRow(k);
  }

  const firstDate = (hourlyKeys[0] ?? bandAnchors[0] ?? '').slice(0, 10);
  section.innerHTML = `
    <h2>Hourly Forecast</h2>
    <div class="hourly-scroll">
      <table class="hourly-table">
        <thead><tr><th>${formatDayHeader(firstDate)}</th>${REST_HEADERS}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>`;

  section.querySelector('.hourly-table')?.addEventListener('click', e => {
    const cell = e.target.closest('.wind-cell');
    if (cell) showToast(`Wind from ${cell.dataset.cardinal}`, 2000);
  });
}


function renderModelComparison(mnHourly, omHourly, mode) {
  const section = document.getElementById('model-section');
  const now = new Date();
  const cutoff = new Date(now.getTime() + 48 * 3600 * 1000);

  const mnByTime = Object.fromEntries(mnHourly.map(h => [h.time.slice(0, 13), h]));
  const omByTime = Object.fromEntries(omHourly.map(h => [h.time.slice(0, 13), h]));
  const keys = [...new Set([...Object.keys(mnByTime), ...Object.keys(omByTime)])]
    .filter(k => new Date(k + ':00:00Z') >= now && new Date(k + ':00:00Z') <= cutoff)
    .sort()
    .slice(0, 24);

  if (!keys.length) {
    section.innerHTML = '<h2>Model Comparison</h2><p>No data.</p>';
    return;
  }

  const rows = keys.map(k => {
    const mn = mnByTime[k]?.precip ?? 0;
    const om = omByTime[k]?.precip ?? 0;
    const omProb = omByTime[k]?.precipProb;
    const probStr = omProb !== null && omProb !== undefined ? `${Math.round(omProb)}%` : '—';
    const agreement = modelAgreement(mn, om);
    const agClass = agreement === 'Models agree — dry' ? 'agree' : agreement === 'Both predict rain' ? 'both-rain' : 'disagree';
    return `
      <tr>
        <td>${formatTime(k + ':00:00Z')}</td>
        <td>${mn.toFixed(2)}</td>
        <td>${om.toFixed(2)}</td>
        <td>${probStr}</td>
        <td class="model-${agClass}">${agreement}</td>
      </tr>`;
  }).join('');

  const modeLabels = { optimistic: 'the lower value', balanced: 'the average', pessimistic: 'the higher value' };
  section.innerHTML = `
    <h2>Model Comparison</h2>
    <p class="model-note">MET Norway does not provide precipitation probability — prob % shown is Open-Meteo only. In <strong>${capitalise(mode)}</strong> mode, scores use ${modeLabels[mode]} when models differ.</p>
    <table class="model-table">
      <thead>
        <tr><th>Time</th><th>MET Norway (mm)</th><th>Open-Meteo (mm)</th><th>Prob %</th><th>Agreement</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderDryingEstimate(location, hourly) {
  const section = document.getElementById('drying-section');
  if (!hourly?.length) {
    section.innerHTML = '<h2>Recent Rainfall &amp; Drying Estimate</h2><p class="error-state">No data.</p>';
    return;
  }

  const now = new Date();
  // Look back 48h in hourly data (will cover what's available)
  const past = hourly
    .filter(h => new Date(h.time) < now)
    .sort((a, b) => a.time.localeCompare(b.time));

  // Find last hour with significant rain (>0.5mm)
  let lastRainTime = null;
  for (const h of past) {
    if ((h.precip ?? 0) > 0.5) lastRainTime = h.time;
  }

  let hoursSinceRain = 999;
  if (lastRainTime) {
    hoursSinceRain = (now - new Date(lastRainTime)) / 3600000;
  }

  // Use latest available values for current wind + humidity
  const latest = past[past.length - 1] ?? {};
  const estimate = dryingEstimate({
    hoursSinceRain,
    windKmh: latest.windKmh ?? 0,
    humidity: latest.humidity ?? 0,
    rockType: location.rock_type,
  });

  const estimateClass = estimate === 'Likely dry' ? 'green' : estimate === 'Probably still damp' ? 'amber' : 'red';

  // Precip bars for last 48 available hours
  const recentHours = past.slice(-24);
  const maxPrecip = Math.max(0.1, ...recentHours.map(h => h.precip ?? 0));
  const bars = recentHours.map(h => {
    const pct = Math.round(((h.precip ?? 0) / maxPrecip) * 100);
    const time = formatTime(h.time);
    return `<div class="precip-bar-wrap" title="${time}: ${(h.precip ?? 0).toFixed(2)}mm">
      <div class="precip-bar" style="height:${pct}%"></div>
      <span class="bar-time">${time.slice(-5, -3)}h</span>
    </div>`;
  }).join('');

  section.innerHTML = `
    <h2>Recent Rainfall &amp; Drying Estimate</h2>
    <div class="drying-estimate score-pill score-${estimateClass}">
      ${estimate}
    </div>
    <p class="drying-note">
      ${lastRainTime
        ? `Last significant rain: ${formatTime(lastRainTime)} (${Math.round(hoursSinceRain)}h ago)`
        : 'No significant rain in recent data.'}
      Based on ${location.rock_type}, current wind and humidity. Conservative estimate.
    </p>
    <div class="precip-bars">${bars}</div>`;
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
