import {
  fetchMetNorwayForecast, parseMetNorwayForecast,
  fetchOpenMeteoForecast, parseOpenMeteoForecast,
  fetchObservations, parseObservations,
  fetchSunrise, parseSunrise,
  fetchWarnings, parseWarnings,
  buildDailySummaries,
} from '../api.js';
import {
  scoreHour, scoreDay, combineHourlyParams, combineDailyParams,
  dryingEstimate, windExposure, modelAgreement,
} from '../scoring.js';
import {
  formatTime, formatDate, formatDateShort, windArrow,
  applyScore, scoreLabel, showToast, todayISO, next7Days,
} from '../ui.js';
import { toggleFavourite, isFavourite } from '../favourites.js';
import { renderLocationWarnings } from '../warnings.js';

export async function renderDetail(location) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="detail-header">
      <a href="#/overview" class="back-link">← All Locations</a>
      <div class="detail-title-row">
        <h1>${location.name}</h1>
        <button class="fav-star ${isFavourite(location.id) ? 'active' : ''}" id="detail-fav-btn" title="Favourite">★</button>
      </div>
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

      <section id="daylight-section" class="detail-section">
        <h2>Daylight</h2>
        <div class="daylight-loading">Loading…</div>
      </section>

      <section id="hourly-section" class="detail-section">
        <h2>Hourly Forecast — Next 48 Hours</h2>
        <div class="hourly-loading">Loading forecast…</div>
      </section>

      <section id="daily-section" class="detail-section">
        <h2>Daily Summary (Days 3–7)</h2>
        <div class="daily-loading">Loading…</div>
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

  // Observations
  renderObservations(location, observations);

  // Daylight
  renderDaylight(sunriseData);

  // Hourly (next 48h)
  if (mnHourly || omHourly) {
    renderHourly(location, mnHourly, omHourly);
  } else {
    document.getElementById('hourly-section').innerHTML = '<h2>Hourly Forecast</h2><p class="error-state">Forecast unavailable.</p>';
  }

  // Daily
  if (mnHourly || omHourly) {
    renderDailySummary(mnHourly, omHourly);
  }

  // Model comparison
  if (mnHourly && omHourly) {
    renderModelComparison(mnHourly, omHourly);
  } else {
    document.getElementById('model-section').innerHTML = '<h2>Model Comparison</h2><p>Only one data source available.</p>';
  }

  // Drying estimate
  renderDryingEstimate(location, mnHourly ?? omHourly);
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
  const section = document.getElementById('daylight-section');
  if (!sunriseData) {
    section.innerHTML = '<h2>Daylight</h2><p class="error-state">Sunrise data unavailable.</p>';
    return;
  }
  const { sunrise, sunset, civilTwilightStart, civilTwilightEnd } = sunriseData;
  const usableStart = civilTwilightStart ?? sunrise;
  const usableEnd = civilTwilightEnd ?? sunset;
  let daylightHours = '';
  if (usableStart && usableEnd) {
    const mins = (new Date(usableEnd) - new Date(usableStart)) / 60000;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    daylightHours = `${h}h ${m}m`;
  }
  section.innerHTML = `
    <h2>Daylight</h2>
    <div class="daylight-grid">
      <div><span class="obs-label">Sunrise</span><span>${formatTime(sunrise)}</span></div>
      <div><span class="obs-label">Sunset</span><span>${formatTime(sunset)}</span></div>
      ${daylightHours ? `<div><span class="obs-label">Daylight</span><span>${daylightHours}</span></div>` : ''}
    </div>`;
}

function renderHourly(location, mnHourly, omHourly) {
  const section = document.getElementById('hourly-section');
  const now = new Date();
  const cutoff = new Date(now.getTime() + 48 * 3600 * 1000);

  // Align hourly data by timestamp
  const mnByTime = Object.fromEntries((mnHourly ?? []).map(h => [h.time.slice(0, 13), h]));
  const omByTime = Object.fromEntries((omHourly ?? []).map(h => [h.time.slice(0, 13), h]));

  // Build union of keys in next 48h
  const allKeys = [...new Set([...Object.keys(mnByTime), ...Object.keys(omByTime)])]
    .filter(k => {
      const d = new Date(k + ':00:00Z');
      return d >= now && d <= cutoff;
    })
    .sort();

  if (!allKeys.length) {
    section.innerHTML = '<h2>Hourly Forecast — Next 48 Hours</h2><p>No hourly data available.</p>';
    return;
  }

  const rows = allKeys.map(k => {
    const mn = mnByTime[k];
    const om = omByTime[k];
    const params = mn && om
      ? combineHourlyParams(mn, om)
      : (mn ?? om);
    const score = scoreHour(params);
    const exposure = windExposure(params.windDir ?? 0, location.aspect);
    const exposureClass = exposure === 'Sheltered' ? 'sheltered' : exposure === 'Exposed' ? 'exposed' : 'partial';

    return `
      <tr class="score-row score-${score}">
        <td class="hour-time">${formatTime(k + ':00:00Z')}</td>
        <td>${params.precip.toFixed(1)}</td>
        <td>${params.precipProb !== null ? Math.round(params.precipProb) + '%' : '—'}</td>
        <td>${Math.round(params.tempC)}°</td>
        <td>${Math.round(params.windKmh)}</td>
        <td>${Math.round(params.windDir ?? 0)}°</td>
        <td>${Math.round(params.humidity)}</td>
        <td>${Math.round(params.cloudPct ?? 0)}</td>
        <td class="exposure-${exposureClass}">${exposure}</td>
      </tr>`;
  }).join('');

  section.innerHTML = `
    <h2>Hourly Forecast — Next 48 Hours</h2>
    <div class="hourly-scroll">
      <table class="hourly-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Precip mm</th>
            <th>Prob</th>
            <th>Temp</th>
            <th>Wind km/h</th>
            <th>Dir</th>
            <th>Hum %</th>
            <th>Cloud %</th>
            <th>Shelter</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderDailySummary(mnHourly, omHourly) {
  const section = document.getElementById('daily-section');
  const mnDays = buildDailySummaries(mnHourly ?? []);
  const omDays = buildDailySummaries(omHourly ?? []);
  const omByDate = Object.fromEntries(omDays.map(d => [d.date, d]));

  // Show days 3-7 (index 2-6)
  const days = mnDays.slice(2, 7);
  if (!days.length) {
    section.innerHTML = '<h2>Daily Summary (Days 3–7)</h2><p>No extended forecast data.</p>';
    return;
  }

  const rows = days.map(d => {
    const om = omByDate[d.date];
    const params = om ? combineDailyParams(d, om) : d;
    const score = scoreDay(params);
    return `
      <tr class="score-row score-${score}">
        <td>${formatDateShort(d.date + 'T12:00:00')}</td>
        <td>${params.totalPrecip.toFixed(1)}mm</td>
        <td>${Math.round(params.minTemp ?? 0)}–${Math.round(params.maxTemp ?? 0)}°C</td>
        <td>${Math.round(params.maxWind)}km/h</td>
        <td>${Math.round(params.avgHumidity)}%</td>
        <td class="score-pill score-${score}">${scoreLabel(score)}</td>
      </tr>`;
  }).join('');

  section.innerHTML = `
    <h2>Daily Summary (Days 3–7)</h2>
    <table class="daily-table">
      <thead>
        <tr><th>Day</th><th>Precip</th><th>Temp</th><th>Max Wind</th><th>Humidity</th><th>Conditions</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderModelComparison(mnHourly, omHourly) {
  const section = document.getElementById('model-section');
  const now = new Date();
  const cutoff = new Date(now.getTime() + 48 * 3600 * 1000);

  const mnByTime = Object.fromEntries(mnHourly.map(h => [h.time.slice(0, 13), h]));
  const omByTime = Object.fromEntries(omHourly.map(h => [h.time.slice(0, 13), h]));
  const keys = [...new Set([...Object.keys(mnByTime), ...Object.keys(omByTime)])]
    .filter(k => new Date(k + ':00:00Z') >= now && new Date(k + ':00:00Z') <= cutoff)
    .sort()
    .slice(0, 24); // First 24 hours

  if (!keys.length) {
    section.innerHTML = '<h2>Model Comparison</h2><p>No data.</p>';
    return;
  }

  const rows = keys.map(k => {
    const mn = mnByTime[k]?.precip ?? 0;
    const om = omByTime[k]?.precip ?? 0;
    const agreement = modelAgreement(mn, om);
    const agClass = agreement === 'Models agree — dry' ? 'agree' : agreement === 'Both predict rain' ? 'both-rain' : 'disagree';
    return `
      <tr>
        <td>${formatTime(k + ':00:00Z')}</td>
        <td>${mn.toFixed(2)}</td>
        <td>${om.toFixed(2)}</td>
        <td class="model-${agClass}">${agreement}</td>
      </tr>`;
  }).join('');

  section.innerHTML = `
    <h2>Model Comparison</h2>
    <p class="model-note">Comparing precipitation forecasts from MET Norway and Open-Meteo. Where models disagree, scores use the more pessimistic value.</p>
    <table class="model-table">
      <thead>
        <tr><th>Time</th><th>MET Norway (mm)</th><th>Open-Meteo (mm)</th><th>Agreement</th></tr>
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
