import {
  fetchMetNorwayForecast, parseMetNorwayForecast,
  fetchOpenMeteoForecast, parseOpenMeteoForecast,
  fetchObservations, parseObservations,
  buildDailySummaries, getOldestCacheTimestamp, forceRefresh,
} from '../api.js';
import { scoreDailyPrecip, combineDailyParams } from '../scoring.js';
import {
  applyScore, conditionIcon, formatDateShort, next7Days,
  showFreshnessBar, showToast, renderError,
} from '../ui.js';

import { loadAndRenderWarnings } from '../warnings.js';
import { getFavourites, toggleFavourite, isFavourite, importFavourites, shareFavourites } from '../favourites.js';
import { getMode } from '../settings.js';
import { registerModeHandler } from '../events.js';

// Module-level cache so mode changes can re-score without re-fetching
let _currentDays = [];
const _locDataCache = new Map(); // locId → { mn: dailySummaries[], om: dailySummaries[] }
let _daytimeOnly = localStorage.getItem('icw:daytimeOnly') === 'true';

export async function renderOverview(locations, params) {
  // Handle ?fav= import
  if (params.has('fav')) {
    const ids = params.get('fav').split(',').filter(Boolean);
    const added = importFavourites(ids);
    if (added > 0) showToast(`${added} location${added > 1 ? 's' : ''} added to your favourites.`);
  }

  const mode = getMode();
  _locDataCache.clear();
  const app = document.getElementById('app');
  app.innerHTML = '';

  // Build skeleton
  const days = next7Days();
  _currentDays = days;
  const dayHeaders = days.map((d, i) => {
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDateShort(d + 'T12:00:00');
    return `<th data-date="${d}">${label}</th>`;
  }).join('');

  const favs = getFavourites();
  const allLocs = locations.slice();
  const pinnedIds = new Set(favs);
  const pinned = allLocs.filter(l => pinnedIds.has(l.id));
  const rest = allLocs.filter(l => !pinnedIds.has(l.id));

  function buildRows(locs, isPinned) {
    return locs.map(loc => {
      const cells = days.map(d =>
        `<td class="score-cell loading" data-loc="${loc.id}" data-date="${d}">
          <span class="cell-precip"></span>
          <span class="cell-icon"></span>
        </td>`
      ).join('');
      const starClass = isFavourite(loc.id) ? 'fav-star active' : 'fav-star';
      return `
        <tr data-location="${loc.id}">
          <td class="loc-name-cell">
            <button class="${starClass}" data-id="${loc.id}" title="Favourite" aria-label="Toggle favourite">★</button>
            <a href="#/location/${loc.id}">${loc.name}</a>
          </td>
          ${cells}
        </tr>`;
    }).join('');
  }

  let tableBody = '';
  if (pinned.length) {
    tableBody += `
      <tbody class="pinned-group">
        <tr class="group-header pinned-header"><td colspan="${days.length + 1}">⭐ Favourites</td></tr>
        ${buildRows(pinned, true)}
      </tbody>`;
  }
  if (rest.length) {
    tableBody += `<tbody>${buildRows(rest, false)}</tbody>`;
  }

  app.innerHTML = `
    <div class="overview-controls">
      <h1>Irish Climbing Weather</h1>
      ${favs.length ? `<button id="share-favs-btn">Share Favourites</button>` : ''}
    </div>
    <div class="overview-filters">
      <button id="daytime-btn" class="daytime-btn${_daytimeOnly ? ' daytime-active' : ''}">☀ Daytime only (10am–8pm)</button>
    </div>
    <p class="overview-note" id="overview-note">${_daytimeOnly ? 'Rain shown is 10am–8pm only (prime climbing hours). Tap any location for full conditions.' : 'Colour shows expected daily precipitation only. Tap any location for full conditions including wind and humidity.'}</p>
    <div class="table-wrapper">
      <table class="overview-table">
        <thead>
          <tr>
            <th class="loc-col">Location</th>
            ${dayHeaders}
          </tr>
        </thead>
        ${tableBody}
      </table>
    </div>`;

  // Wire up controls
  document.getElementById('share-favs-btn')?.addEventListener('click', () => {
    const url = shareFavourites();
    if (url) {
      navigator.clipboard?.writeText(url).then(() => showToast('Share link copied!')).catch(() => {
        prompt('Copy this link to share your favourites:', url);
      });
    }
  });

  registerModeHandler(newMode => {
    for (const [locId, { mn, om }] of _locDataCache) {
      if (mn || om) renderLocationCells(locId, mn ?? om, _currentDays, mn && om ? om : null, true, newMode);
    }
  });

  document.getElementById('daytime-btn')?.addEventListener('click', () => {
    _daytimeOnly = !_daytimeOnly;
    localStorage.setItem('icw:daytimeOnly', _daytimeOnly);
    document.getElementById('daytime-btn').classList.toggle('daytime-active', _daytimeOnly);
    document.getElementById('overview-note').textContent = _daytimeOnly
      ? 'Rain shown is 10am–8pm only (prime climbing hours). Tap any location for full conditions.'
      : 'Colour shows expected daily precipitation only. Tap any location for full conditions including wind and humidity.';
    const mode = getMode();
    for (const [locId, { mn, om }] of _locDataCache) {
      if (mn || om) renderLocationCells(locId, mn ?? om, _currentDays, mn && om ? om : null, true, mode);
    }
  });

  app.addEventListener('click', e => {
    const favBtn = e.target.closest('.fav-star');
    if (!favBtn) return;
    const id = favBtn.dataset.id;
    const nowFav = toggleFavourite(id);
    favBtn.classList.toggle('active', nowFav);
    showToast(nowFav ? 'Added to favourites' : 'Removed from favourites');
    renderOverview(locations, new URLSearchParams());
  });

  // Load warnings in parallel (non-blocking)
  loadAndRenderWarnings(locations).catch(() => {});

  // Fetch forecasts progressively
  const allFetchPromises = locations.map(loc => fetchForecastsForLocation(loc, days, mode));
  // Each resolves independently and updates cells
}

async function fetchForecastsForLocation(loc, days, mode) {
  const mnPromise = fetchMetNorwayForecast(loc.lat, loc.lon)
    .then(parseMetNorwayForecast)
    .then(buildDailySummaries);
  const omPromise = fetchOpenMeteoForecast(loc.lat, loc.lon)
    .then(parseOpenMeteoForecast)
    .then(buildDailySummaries);

  // First source wins — render immediately
  let firstSource = null;

  const settled = await Promise.allSettled([
    mnPromise.then(summaries => {
      if (!firstSource) {
        firstSource = 'mn';
        renderLocationCells(loc.id, summaries, days, null, false, mode);
      }
      return summaries;
    }),
    omPromise.then(summaries => {
      if (!firstSource) {
        firstSource = 'om';
        renderLocationCells(loc.id, summaries, days, null, false, mode);
      }
      return summaries;
    }),
  ]);

  const [mnResult, omResult] = settled;
  const mnSummaries = mnResult.status === 'fulfilled' ? mnResult.value : null;
  const omSummaries = omResult.status === 'fulfilled' ? omResult.value : null;

  // Cache for instant mode switching
  _locDataCache.set(loc.id, { mn: mnSummaries, om: omSummaries });

  if (mnSummaries && omSummaries) {
    renderLocationCells(loc.id, mnSummaries, days, omSummaries, true, mode);
  } else if (!mnSummaries && !omSummaries) {
    days.forEach(d => {
      const cell = document.querySelector(`.score-cell[data-loc="${loc.id}"][data-date="${d}"]`);
      if (cell) {
        cell.classList.remove('loading');
        cell.classList.add('score-error');
        cell.innerHTML = '<span title="Data unavailable">—</span>';
      }
    });
  }

  updateFreshnessBar(loc);
}

function renderLocationCells(locId, primarySummaries, days, secondarySummaries, animate, mode) {
  const summaryByDate = Object.fromEntries(primarySummaries.map(s => [s.date, s]));
  const secondary = secondarySummaries
    ? Object.fromEntries(secondarySummaries.map(s => [s.date, s]))
    : {};

  for (const day of days) {
    const cell = document.querySelector(`.score-cell[data-loc="${locId}"][data-date="${day}"]`);
    if (!cell) continue;

    const primary = summaryByDate[day];
    if (!primary) {
      cell.classList.remove('loading');
      continue;
    }

    const precipKey = _daytimeOnly ? 'climbingHoursPrecip' : 'totalPrecip';
    let params = { totalPrecip: primary[precipKey] ?? 0, maxWind: primary.maxWind, avgHumidity: primary.avgHumidity };
    if (secondary[day]) {
      params = combineDailyParams(params, {
        totalPrecip: secondary[day][precipKey] ?? 0,
        maxWind: secondary[day].maxWind,
        avgHumidity: secondary[day].avgHumidity,
      }, mode);
    }

    const score = scoreDailyPrecip(params.totalPrecip);
    applyScore(cell, score, animate);

    cell.querySelector('.cell-precip').textContent = `${params.totalPrecip.toFixed(1)}mm`;
    cell.querySelector('.cell-icon').textContent = conditionIcon(params.totalPrecip, params.maxWind);
    cell.dataset.href = `#/location/${locId}`;

    cell.onclick = () => { window.location.hash = `#/location/${locId}`; };
    cell.style.cursor = 'pointer';
    cell.title = `${scoreLabel(score)} — ${params.totalPrecip.toFixed(1)}mm, wind ${Math.round(params.maxWind)}km/h`;
  }
}

function scoreLabel(score) {
  if (score === 'green') return 'Good';
  if (score === 'amber') return 'Marginal';
  return 'Poor';
}

function updateFreshnessBar() {
  // Collect all icw: timestamps
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('icw:')) keys.push(k);
  }
  const ts = getOldestCacheTimestamp(keys);
  showFreshnessBar(ts);
}
