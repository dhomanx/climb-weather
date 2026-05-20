import {
  getAllLocations, getActiveLocations, setActiveLocations, isLocationActive, toggleLocationActive,
  getCustomLocations, addCustomLocation, removeCustomLocation,
  groupByRegion, encodeCustomLocationForUrl,
  exportLocationsJson, importLocationsJson,
} from '../locations.js';
import { showToast } from '../ui.js';

const IRISH_COUNTIES = [
  'Antrim', 'Armagh', 'Carlow', 'Cavan', 'Clare', 'Cork',
  'Derry/Londonderry', 'Donegal', 'Down', 'Dublin', 'Fermanagh',
  'Galway', 'Kerry', 'Kildare', 'Kilkenny', 'Laois', 'Leitrim',
  'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan',
  'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Tyrone',
  'Waterford', 'Westmeath', 'Wexford', 'Wicklow',
];

const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const ROCK_TYPES = ['granite', 'quartzite', 'limestone', 'sandstone', 'dolerite', 'basalt', 'mica-schist', 'schist', 'gneiss', 'other'];
const REGIONS = ['Leinster', 'Munster', 'Connacht', 'Ulster'];
const NI_COUNTIES = new Set(['Antrim', 'Down', 'Armagh', 'Fermanagh', 'Derry/Londonderry', 'Tyrone']);

export function renderSettings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="settings-page">
      <a href="#/overview" class="back-link">← Back to Overview</a>
      <h1>Locations</h1>

      <section class="settings-section" id="settings-active">
        <h2>Active Locations</h2>
        <p class="settings-hint">These locations are shown on the overview and have weather fetched for them.</p>
        <div class="settings-active-controls">
          <button id="btn-reset-defaults" class="settings-btn-sm">Reset to defaults</button>
          <button id="btn-clear-all" class="settings-btn-sm settings-btn-danger">Clear all</button>
        </div>
        <div id="active-list"></div>
      </section>

      <section class="settings-section" id="settings-browse">
        <h2>Browse All Locations</h2>
        <input type="text" id="loc-filter" class="settings-input" placeholder="Filter by name or county…" autocomplete="off">
        <div id="browse-list"></div>
      </section>

      <section class="settings-section" id="settings-custom">
        <h2>My Custom Locations</h2>
        <div id="custom-list"></div>
        <button id="btn-add-custom" class="settings-btn">+ Add a custom location</button>
        <div id="add-custom-form" hidden>
          <h3>Add Custom Location</h3>
          <div class="geocode-row">
            <input type="text" id="geocode-input" class="settings-input" placeholder="Search place name…" autocomplete="off">
            <button id="btn-geocode" class="settings-btn">Search</button>
          </div>
          <div id="geocode-results"></div>
          <div id="custom-fields" hidden>
            <div class="field-row">
              <label>Name <input type="text" id="cf-name" class="settings-input"></label>
            </div>
            <div class="field-row field-row-inline">
              <label>Aspect
                <select id="cf-aspect" class="settings-select">
                  <option value="">Select</option>
                  ${ASPECTS.map(a => `<option>${a}</option>`).join('')}
                </select>
              </label>
              <label>Elevation (m) <input type="number" id="cf-elevation" class="settings-input" style="width:80px"></label>
              <label>Rock type
                <select id="cf-rock" class="settings-select">
                  <option value="">Select</option>
                  ${ROCK_TYPES.map(r => `<option>${r}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="field-row field-row-inline">
              <label>Region
                <select id="cf-region" class="settings-select">
                  <option value="">Select</option>
                  ${REGIONS.map(r => `<option>${r}</option>`).join('')}
                </select>
              </label>
              <label>County (for weather warnings)
                <select id="cf-county" class="settings-select">
                  <option value="">Skip Warnings</option>
                  ${IRISH_COUNTIES.map(c => `<option>${c}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="field-row">
              <label>Notes (optional) <input type="text" id="cf-notes" class="settings-input"></label>
            </div>
            <input type="hidden" id="cf-lat">
            <input type="hidden" id="cf-lon">
            <div class="field-row">
              <button id="btn-save-custom" class="settings-btn">Save Location</button>
              <button id="btn-cancel-custom" class="settings-btn settings-btn-sm">Cancel</button>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h2>Export &amp; Import</h2>
        <p class="settings-hint">Export your active locations and custom crags to a file, then import on another device.</p>
        <div class="export-import-row">
          <button id="btn-export" class="settings-btn">Export JSON</button>
          <label class="settings-btn" id="import-label">Import JSON
            <input type="file" id="btn-import" accept=".json" style="display:none">
          </label>
        </div>
      </section>
    </div>`;

  renderActiveList();
  renderBrowseList();
  renderCustomList();
  wireEvents();
}

// ── Section renderers ────────────────────────────────────────────────────────

function renderActiveList() {
  const active = getActiveLocations();
  const el = document.getElementById('active-list');
  if (!active.length) {
    el.innerHTML = '<p class="settings-hint">No locations selected.</p>';
    return;
  }
  el.innerHTML = `<ul class="active-loc-list">
    ${active.map(l => `
      <li>
        <span class="active-loc-name">${l.name}${l.isCustom ? ' <em>(custom)</em>' : ''}</span>
        <button class="settings-btn-icon btn-remove-active" data-id="${l.id}" title="Remove from overview" aria-label="Remove ${l.name}">✕</button>
      </li>`).join('')}
  </ul>`;
}

function renderBrowseList(filter = '') {
  const all = getAllLocations();
  const lower = filter.toLowerCase();
  const filtered = filter
    ? all.filter(l => l.name.toLowerCase().includes(lower) || (l.county || '').toLowerCase().includes(lower))
    : all;
  const groups = groupByRegion(filtered);

  const el = document.getElementById('browse-list');
  if (!groups.length) {
    el.innerHTML = '<p class="settings-hint">No locations match.</p>';
    return;
  }
  el.innerHTML = groups.map(g => `
    <div class="browse-region">
      <h3>${g.region}</h3>
      <ul class="browse-loc-list">
        ${g.locations.map(l => `
          <li>
            <label>
              <input type="checkbox" class="loc-checkbox" data-id="${l.id}" ${isLocationActive(l.id) ? 'checked' : ''} ${l.isCustom ? 'disabled title="Custom locations are always shown"' : ''}>
              ${l.name}${l.county ? ` <span class="loc-county">(${l.county})</span>` : ''}
            </label>
          </li>`).join('')}
      </ul>
    </div>`).join('');
}

function renderCustomList() {
  const customs = getCustomLocations();
  const el = document.getElementById('custom-list');
  if (!customs.length) {
    el.innerHTML = '<p class="settings-hint">No custom locations yet.</p>';
    return;
  }
  el.innerHTML = `<ul class="custom-loc-list">
    ${customs.map(l => `
      <li>
        <span class="active-loc-name">${l.name} <span class="loc-county">(${l.county || 'no county'})</span></span>
        <div class="custom-loc-actions">
          <button class="settings-btn-sm btn-share-custom" data-id="${l.id}" title="Copy share link">Share link</button>
          <button class="settings-btn-icon btn-delete-custom" data-id="${l.id}" title="Delete" aria-label="Delete ${l.name}">🗑</button>
        </div>
      </li>`).join('')}
  </ul>`;
}

// ── Event wiring ─────────────────────────────────────────────────────────────

function wireEvents() {
  // Active list: remove buttons
  document.getElementById('active-list').addEventListener('click', e => {
    const btn = e.target.closest('.btn-remove-active');
    if (!btn) return;
    const id = btn.dataset.id;
    const loc = getAllLocations().find(l => l.id === id);
    if (loc?.isCustom) {
      removeCustomLocation(id);
    } else {
      toggleLocationActive(id);
    }
    renderActiveList();
    renderBrowseList(document.getElementById('loc-filter')?.value ?? '');
    renderCustomList();
  });

  // Reset / clear all
  document.getElementById('btn-reset-defaults').addEventListener('click', () => {
    const featuredIds = getAllLocations().filter(l => l.featured).map(l => l.id);
    setActiveLocations(featuredIds);
    renderActiveList();
    renderBrowseList(document.getElementById('loc-filter')?.value ?? '');
  });

  document.getElementById('btn-clear-all').addEventListener('click', () => {
    setActiveLocations([]);
    renderActiveList();
    renderBrowseList(document.getElementById('loc-filter')?.value ?? '');
  });

  // Filter
  document.getElementById('loc-filter').addEventListener('input', e => {
    renderBrowseList(e.target.value);
  });

  // Browse checkboxes (delegated)
  document.getElementById('browse-list').addEventListener('change', e => {
    const cb = e.target.closest('.loc-checkbox');
    if (!cb) return;
    toggleLocationActive(cb.dataset.id);
    renderActiveList();
  });

  // Custom list: share + delete (delegated)
  document.getElementById('custom-list').addEventListener('click', e => {
    const shareBtn = e.target.closest('.btn-share-custom');
    if (shareBtn) {
      const loc = getCustomLocations().find(l => l.id === shareBtn.dataset.id);
      if (loc) {
        const b64 = encodeCustomLocationForUrl(loc);
        const base = window.location.href.split('?')[0].split('#')[0];
        const url = `${base}#/overview?cl=${encodeURIComponent(b64)}`;
        navigator.clipboard?.writeText(url)
          .then(() => showToast('Share link copied!'))
          .catch(() => { prompt('Copy this link to share the location:', url); });
      }
      return;
    }
    const delBtn = e.target.closest('.btn-delete-custom');
    if (delBtn) {
      if (!confirm(`Delete "${getCustomLocations().find(l => l.id === delBtn.dataset.id)?.name}"?`)) return;
      removeCustomLocation(delBtn.dataset.id);
      renderCustomList();
      renderActiveList();
    }
  });

  // Add custom form toggle
  document.getElementById('btn-add-custom').addEventListener('click', () => {
    const form = document.getElementById('add-custom-form');
    form.hidden = !form.hidden;
  });

  // Geocoding search
  document.getElementById('btn-geocode').addEventListener('click', runGeocode);
  document.getElementById('geocode-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') runGeocode();
  });

  // Cancel add form
  document.getElementById('btn-cancel-custom').addEventListener('click', () => {
    document.getElementById('add-custom-form').hidden = true;
    resetAddForm();
  });

  // Save custom location
  document.getElementById('btn-save-custom').addEventListener('click', saveCustomLocation);

  // Export
  document.getElementById('btn-export').addEventListener('click', () => exportLocationsJson());

  // Import
  document.getElementById('btn-import').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = importLocationsJson(ev.target.result);
      if (!result.ok) {
        showToast(result.message);
      } else {
        showToast(`Imported: ${result.addedCount} new location${result.addedCount !== 1 ? 's' : ''} added.`);
        renderActiveList();
        renderBrowseList(document.getElementById('loc-filter')?.value ?? '');
        renderCustomList();
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-import of same file
  });
}

// ── Geocoding ────────────────────────────────────────────────────────────────

async function runGeocode() {
  const query = document.getElementById('geocode-input').value.trim();
  if (!query) return;

  const resultsEl = document.getElementById('geocode-results');
  resultsEl.innerHTML = '<p class="settings-hint">Searching…</p>';
  document.getElementById('custom-fields').hidden = true;

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=en&format=json`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.results?.length) {
      resultsEl.innerHTML = '<p class="settings-hint">No results found.</p>';
      return;
    }

    // Sort: Republic of Ireland first, then Northern Ireland, then everywhere else
    const sorted = data.results.slice().sort((a, b) => irelandScore(a) - irelandScore(b)).slice(0, 5);

    resultsEl.innerHTML = `
      <p class="settings-hint">Select a result to prefill coordinates:</p>
      <ul class="geocode-result-list">
        ${sorted.map((r, i) => `
          <li>
            <label>
              <input type="radio" name="geocode-pick" value="${i}" data-result='${JSON.stringify({ lat: r.latitude, lon: r.longitude, elevation: r.elevation ?? '', name: r.name, county: deriveCounty(r), region: deriveRegion(r) })}'>
              ${r.name}${r.admin1 ? `, ${r.admin1}` : ''}${r.country ? `, ${r.country}` : ''}
              <span class="loc-county">(${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)})</span>
            </label>
          </li>`).join('')}
      </ul>`;

    resultsEl.querySelectorAll('input[name="geocode-pick"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const r = JSON.parse(radio.dataset.result);
        document.getElementById('cf-lat').value = r.lat;
        document.getElementById('cf-lon').value = r.lon;
        if (r.elevation !== '') document.getElementById('cf-elevation').value = Math.round(r.elevation);
        // Always update name and reset selects when a new result is chosen
        document.getElementById('cf-name').value = r.name;
        document.getElementById('cf-aspect').value = '';
        document.getElementById('cf-rock').value = '';
        document.getElementById('cf-region').value = r.region || '';
        const countySelect = document.getElementById('cf-county');
        countySelect.value = r.county && [...countySelect.options].some(o => o.value === r.county) ? r.county : '';
        document.getElementById('custom-fields').hidden = false;
      });
    });
  } catch {
    resultsEl.innerHTML = '<p class="settings-hint">Search failed — check your connection.</p>';
  }
}

function irelandScore(r) {
  if (r.country === 'Ireland') return 0;
  if (r.country === 'United Kingdom') {
    const a1 = (r.admin1 ?? '').replace(/^County\s+/i, '').trim();
    const a2 = (r.admin2 ?? '').replace(/^County\s+/i, '').trim();
    if (a1 === 'Northern Ireland' || NI_COUNTIES.has(a1) || NI_COUNTIES.has(a2)) return 1;
  }
  return 2;
}

function deriveRegion(geocodeResult) {
  // For Republic of Ireland, admin1 is the province (Leinster/Munster/Connacht/Ulster)
  const admin1 = geocodeResult.admin1 ?? '';
  if (REGIONS.includes(admin1)) return admin1;
  if (admin1 === 'Northern Ireland') return 'Ulster';
  // Fallback: check admin2 in case structure varies
  const admin2 = geocodeResult.admin2 ?? '';
  if (REGIONS.includes(admin2)) return admin2;
  return '';
}

function deriveCounty(geocodeResult) {
  // For Republic of Ireland, admin1 = province and admin2 = county ("County Wexford")
  // For NI, admin1 may be "Northern Ireland" and admin2 the county
  const candidates = [geocodeResult.admin2 ?? '', geocodeResult.admin1 ?? ''];
  for (const c of candidates) {
    const stripped = c.replace(/^County\s+/i, '').trim();
    if (IRISH_COUNTIES.includes(stripped)) return stripped;
  }
  return '';
}

function saveCustomLocation() {
  const name = document.getElementById('cf-name').value.trim();
  const lat = parseFloat(document.getElementById('cf-lat').value);
  const lon = parseFloat(document.getElementById('cf-lon').value);
  const aspect = document.getElementById('cf-aspect').value;
  const rock_type = document.getElementById('cf-rock').value;
  const region = document.getElementById('cf-region').value;

  if (!name) { showToast('Please enter a name.'); return; }
  if (isNaN(lat) || isNaN(lon)) { showToast('Please select a search result first.'); return; }
  if (!aspect) { showToast('Please select an aspect.'); return; }
  if (!rock_type) { showToast('Please select a rock type.'); return; }
  if (!region) { showToast('Please select a region.'); return; }

  const loc = {
    name,
    lat,
    lon,
    elevation_m: parseInt(document.getElementById('cf-elevation').value) || 0,
    aspect,
    rock_type,
    region,
    county: document.getElementById('cf-county').value,
    nearest_station: '',
    notes: document.getElementById('cf-notes').value.trim(),
    featured: false,
  };

  const saved = addCustomLocation(loc);
  if (!saved) {
    showToast('Storage full — could not save location.');
    return;
  }

  showToast(`"${saved.name}" added.`);
  resetAddForm();
  document.getElementById('add-custom-form').hidden = true;
  renderCustomList();
  renderActiveList();
  renderBrowseList(document.getElementById('loc-filter')?.value ?? '');
}

function resetAddForm() {
  document.getElementById('geocode-input').value = '';
  document.getElementById('geocode-results').innerHTML = '';
  document.getElementById('custom-fields').hidden = true;
  document.getElementById('cf-name').value = '';
  document.getElementById('cf-elevation').value = '';
  document.getElementById('cf-notes').value = '';
  document.getElementById('cf-lat').value = '';
  document.getElementById('cf-lon').value = '';
  document.getElementById('cf-aspect').value = '';
  document.getElementById('cf-rock').value = '';
  document.getElementById('cf-region').value = '';
  document.getElementById('cf-county').value = '';
}
