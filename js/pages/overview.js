import {
  fetchMetNorwayForecast, parseMetNorwayForecast,
  fetchOpenMeteoForecast, parseOpenMeteoForecast,
  fetchObservations, parseObservations,
  buildDailySummaries, getOldestCacheTimestamp, forceRefresh, getCachedForLocation,
} from '../api.js';
import { scoreDailyPrecip, combineDailyParams } from '../scoring.js';
import {
  applyScore, conditionIcon, formatDateShort, next7Days,
  showFreshnessBar, showToast, renderError,
} from '../ui.js';

import { loadAndRenderWarnings } from '../warnings.js';
import { getFavourites, toggleFavourite, isFavourite, importFavourites, shareFavourites } from '../favourites.js';
import { getMode, getModelSource } from '../settings.js';
import { registerModeHandler, registerModelHandler } from '../events.js';
import { getActiveLocations, importCustomLocationsFromParam, groupByRegion } from '../locations.js';

// Module-level cache so mode changes can re-score without re-fetching
let _currentDays = [];
const _locDataCache = new Map(); // locId → { mn: dailySummaries[], om: dailySummaries[] }
let _daytimeOnly = localStorage.getItem('icw:daytimeOnly') === 'true';
let _appClickController = null; // AbortController for the app click listener

export async function renderOverview(_passedLocations, params, { preserveCache = false } = {}) {
  // Always use the live active set so settings changes take effect immediately
  const locations = getActiveLocations();

  // Handle ?cl= custom location import (before ?fav= so new locations can be favourited)
  if (params.has('cl')) {
    const imported = importCustomLocationsFromParam(params.getAll('cl'));
    if (imported > 0) showToast(`${imported} custom location${imported > 1 ? 's' : ''} imported from link.`);
  }

  // Handle ?fav= import
  if (params.has('fav')) {
    const ids = params.get('fav').split(',').filter(Boolean);
    const added = importFavourites(ids);
    if (added > 0) showToast(`${added} location${added > 1 ? 's' : ''} added to your favourites.`);
  }

  const mode = getMode();

  if (!locations.length) {
    document.getElementById('app').innerHTML = `
      <div class="error-state" style="padding:2rem">
        <p>No locations selected. <a href="#/settings">Go to Settings</a> to choose locations.</p>
      </div>`;
    return;
  }

  if (!preserveCache) {
    _locDataCache.clear();
    // Synchronously pre-populate from localStorage so cells can render immediately
    for (const loc of locations) {
      const { mn: mnRaw, om: omRaw } = getCachedForLocation(loc.lat, loc.lon);
      const mn = mnRaw ? buildDailySummaries(parseMetNorwayForecast(mnRaw)) : null;
      const om = omRaw ? buildDailySummaries(parseOpenMeteoForecast(omRaw)) : null;
      if (mn || om) _locDataCache.set(loc.id, { mn, om });
    }
  }
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

  function buildRows(locs) {
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
          <td class="star-cell">
            <button class="${starClass}" data-id="${loc.id}" title="Favourite" aria-label="Toggle favourite">★</button>
          </td>
          <td class="loc-name-cell">
            <a href="#/location/${loc.id}">${loc.name}</a>
          </td>
          ${cells}
        </tr>`;
    }).join('');
  }

  const totalCols = days.length + 2;
  let tableBody = '';
  if (pinned.length) {
    tableBody += `<tbody class="pinned-group">${buildRows(pinned)}</tbody>`;
  }
  if (rest.length) {
    const groups = groupByRegion(rest);
    for (const { region, locations: locs } of groups) {
      tableBody += `
        <tbody>
          <tr class="group-header"><td colspan="${totalCols}">${region}</td></tr>
          ${buildRows(locs)}
        </tbody>`;
    }
  }

  app.innerHTML = `
    <div class="overview-controls">
      <h1>Irish Climbing Weather</h1>
      ${favs.length ? `<button id="share-favs-btn">Share Favourites</button>` : ''}
    </div>
    <div class="overview-filters">
      <button id="daytime-btn" class="daytime-btn${_daytimeOnly ? ' daytime-active' : ''}">☀ Daytime only (10am–8pm)</button>
    </div>
    <p class="overview-note" id="overview-note">${_daytimeOnly ? 'Rain shown is 10am–8pm only. Tap any location for full conditions.' : 'Colour shows expected daily precipitation only. Tap any location for full conditions including wind and humidity.'}</p>
    <div class="table-wrapper">
      <table class="overview-table">
        <thead>
          <tr>
            <th class="star-col"></th>
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
    const source = getModelSource();
    for (const [locId, { mn, om }] of _locDataCache) {
      const [primary, secondary] = getSourcesForModel(mn, om, source);
      if (primary) renderLocationCells(locId, primary, _currentDays, secondary, true, newMode);
    }
  });

  registerModelHandler(newSource => {
    const mode = getMode();
    for (const [locId, { mn, om }] of _locDataCache) {
      const [primary, secondary] = getSourcesForModel(mn, om, newSource);
      if (primary) renderLocationCells(locId, primary, _currentDays, secondary, true, mode);
    }
  });

  document.getElementById('daytime-btn')?.addEventListener('click', () => {
    _daytimeOnly = !_daytimeOnly;
    localStorage.setItem('icw:daytimeOnly', _daytimeOnly);
    document.getElementById('daytime-btn').classList.toggle('daytime-active', _daytimeOnly);
    document.getElementById('overview-note').textContent = _daytimeOnly
      ? 'Rain shown is 10am–8pm only. Tap any location for full conditions.'
      : 'Colour shows expected daily precipitation only. Tap any location for full conditions including wind and humidity.';
    const mode = getMode();
    const src = getModelSource();
    for (const [locId, { mn, om }] of _locDataCache) {
      const [primary, secondary] = getSourcesForModel(mn, om, src);
      if (primary) renderLocationCells(locId, primary, _currentDays, secondary, true, mode);
    }
  });

  if (_appClickController) _appClickController.abort();
  _appClickController = new AbortController();
  app.addEventListener('click', e => {
    const favBtn = e.target.closest('.fav-star');
    if (!favBtn) return;
    const id = favBtn.dataset.id;
    const nowFav = toggleFavourite(id);
    showToast(nowFav ? 'Added to favourites' : 'Removed from favourites');
    renderOverview(null, new URLSearchParams(), { preserveCache: true });
  }, { signal: _appClickController.signal });

  // Render any cached data immediately — no loading flash for fresh locations
  const source = getModelSource();
  for (const [locId, { mn, om }] of _locDataCache) {
    const [primary, secondary] = getSourcesForModel(mn, om, source);
    if (primary) renderLocationCells(locId, primary, _currentDays, secondary, false, mode);
  }

  // Load warnings in parallel (non-blocking)
  loadAndRenderWarnings(locations).catch(() => {});

  if (!preserveCache) {
    // Background-fetch only locations missing fresh data for either source
    const locsNeedingFetch = locations.filter(loc => {
      const c = _locDataCache.get(loc.id);
      return !c?.mn || !c?.om;
    });
    if (locsNeedingFetch.length > 0) {
      locsNeedingFetch.forEach(loc => fetchForecastsForLocation(loc, days, mode));
    } else {
      updateFreshnessBar();
    }
  }
}

async function fetchForecastsForLocation(loc, days, mode) {
  const source = getModelSource();

  const mnPromise = fetchMetNorwayForecast(loc.lat, loc.lon)
    .then(parseMetNorwayForecast)
    .then(buildDailySummaries);
  const omPromise = fetchOpenMeteoForecast(loc.lat, loc.lon)
    .then(parseOpenMeteoForecast)
    .then(buildDailySummaries);

  // Show an intermediate result as soon as the relevant model arrives
  let firstRendered = false;
  const settled = await Promise.allSettled([
    mnPromise.then(summaries => {
      if (!firstRendered && source !== 'om') {
        firstRendered = true;
        renderLocationCells(loc.id, summaries, days, null, false, mode);
      }
      return summaries;
    }),
    omPromise.then(summaries => {
      if (!firstRendered && source !== 'mn') {
        firstRendered = true;
        renderLocationCells(loc.id, summaries, days, null, false, mode);
      }
      return summaries;
    }),
  ]);

  const [mnResult, omResult] = settled;
  const mnSummaries = mnResult.status === 'fulfilled' ? mnResult.value : null;
  const omSummaries = omResult.status === 'fulfilled' ? omResult.value : null;

  _locDataCache.set(loc.id, { mn: mnSummaries, om: omSummaries });

  const [primary, secondary] = getSourcesForModel(mnSummaries, omSummaries, source);
  if (primary) {
    renderLocationCells(loc.id, primary, days, secondary, true, mode);
  } else {
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

    const precipKey = _daytimeOnly ? 'effectiveClimbingHoursPrecip' : 'effectiveTotalPrecip';
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

function getSourcesForModel(mn, om, source) {
  if (source === 'mn') return [mn, null];
  if (source === 'om') return [om, null];
  return [mn ?? om, mn && om ? om : null];
}

function scoreLabel(score) {
  if (score === 'green') return 'Good';
  if (score === 'amber') return 'Marginal';
  return 'Poor';
}

function updateFreshnessBar() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('icw:mn:') || k?.startsWith('icw:om:')) keys.push(k);
  }
  showFreshnessBar(getOldestCacheTimestamp(keys));
}
