import { loadLocations, getLocation, getActiveLocations } from './locations.js';
import { renderOverview } from './pages/overview.js';
import { renderDetail } from './pages/detail.js';
import { renderDebug } from './pages/debug.js';
import { getMode, setMode } from './settings.js';
import { triggerModeChange } from './events.js';
import { showFreshnessBar } from './ui.js';
import { getOldestCacheTimestamp } from './api.js';

let locations = null;

function refreshFreshness() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('icw:mn:') || k?.startsWith('icw:om:')) keys.push(k);
  }
  showFreshnessBar(getOldestCacheTimestamp(keys));
}

async function init() {
  locations = await loadLocations();
  initStickyBar();
  handleRoute();
  window.addEventListener('hashchange', () => { handleRoute(); refreshFreshness(); });

  document.getElementById('refresh-footer-btn')?.addEventListener('click', () => {
    import('./api.js').then(({ forceRefresh }) => {
      forceRefresh();
      handleRoute();
    });
  });
}

function initStickyBar() {
  refreshFreshness(); // show cached state immediately on load
  const current = getMode();
  document.querySelectorAll('#sticky-bar .mode-btn').forEach(btn => {
    btn.classList.toggle('mode-active', btn.dataset.mode === current);
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.mode;
      setMode(newMode);
      document.querySelectorAll('#sticky-bar .mode-btn').forEach(b =>
        b.classList.toggle('mode-active', b.dataset.mode === newMode));
      triggerModeChange(newMode);
    });
  });

  const modal = document.getElementById('bar-info-modal');
  document.getElementById('bar-info-btn')?.addEventListener('click', () => modal.hidden = false);
  modal?.querySelector('.bar-modal-close')?.addEventListener('click', () => modal.hidden = true);
  modal?.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
}

function handleRoute() {
  const hash = window.location.hash || '#/overview';
  const [path, queryString] = hash.slice(1).split('?');
  const params = new URLSearchParams(queryString ?? '');
  const segments = path.replace(/^\//, '').split('/');

  const page = segments[0] || 'overview';

  if (page === '' || page === 'overview') {
    renderOverview(getActiveLocations(), params);
  } else if (page === 'location' && segments[1]) {
    const location = getLocation(segments[1]);
    if (location) {
      renderDetail(location);
    } else {
      renderNotFound(segments[1]);
    }
  } else if (page === 'about') {
    renderAbout();
  } else if (page === 'settings') {
    import('./pages/settings.js').then(({ renderSettings }) => renderSettings());
  } else if (page === 'debug') {
    renderDebug();
  } else {
    renderOverview(getActiveLocations(), params);
  }
}

function renderAbout() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="about-page">
      <a href="#/overview" class="back-link">← Back</a>
      <h1>About Irish Climbing Weather</h1>
      <p>A free tool to help Irish rock climbers find good conditions, quickly.
      All data is fetched live in your browser — no server, no sign-up, no tracking.</p>

      <h2>Locations</h2>
      <p>The app includes 85+ Irish climbing crags across all four provinces. On first visit
      a small default set is shown — open <a href="#/settings">Settings</a> to choose exactly
      which locations appear on your overview.</p>
      <ul>
        <li><strong>Choose your crags</strong> — tick any combination of the built-in locations.
        Only the locations you pick are fetched, keeping the overview fast and relevant.</li>
        <li><strong>Custom locations</strong> — add any crag not in the list. Search by place
        name (powered by the Open-Meteo geocoding API), then fill in the details. Custom
        locations are always shown and are saved on your device.</li>
        <li><strong>Share &amp; backup</strong> — export your custom locations and active set
        as a JSON file, or share individual crags via a link.</li>
      </ul>

      <h2>Who's on your shoulder?</h2>
      <p>Two weather models (MET Norway and Open-Meteo) often give slightly different
      forecasts for the same location. The <strong>I'm feeling</strong> setting controls
      how those differences are handled — pick whose advice suits how you're planning your day:</p>
      <ul>
        <li><strong>😈</strong> — takes the more favourable reading from each model.
        For when you're going regardless and just want the forecast to agree.</li>
        <li><strong>🤔</strong> — averages both models. When you want a fair read before committing.</li>
        <li><strong>😇</strong> (default) — takes the more concerning reading from each model.
        For when you're being sensible — long drives, multi-day trips, or when bailing isn't an option.</li>
      </ul>
      <p>Your choice is saved on your device and applies to all locations and forecasts.</p>
      <p class="about-cat-note">😇 😈 — inspired by 🐱</p>

      <h2>How is climbability scored?</h2>
      <h3>Overview grid</h3>
      <p>Each day is coloured by <strong>expected daily precipitation only</strong>:
      under 1mm green, 1–5mm amber, over 5mm red. Wind and humidity are not included here —
      they vary a lot across a day and are better evaluated at the hourly level.
      Tap any location to see the full picture.</p>
      <p>The <strong>☀ Daytime only</strong> toggle restricts the rain total to 10am–8pm,
      useful for planning a day trip when you don't care about overnight rain.</p>

      <h3>Location detail — per-parameter cell colours</h3>
      <p>In the hourly and daily forecast tables, <strong>each cell is coloured
      independently</strong> for its own parameter. A row can have a green rain cell and a
      red wind cell side-by-side — you can see at a glance exactly which parameter
      is the problem rather than guessing from a single row colour.</p>
      <ul>
        <li><strong>Precipitation</strong> — scored as <em>expected rain</em>
        (hourly amount × probability). 0.1mm at 100% confidence = amber, not red.
        5mm at 100% = red. Avoids false alarms from trace drizzle.
        Daily totals: &lt;1mm green, 1–5mm amber, &gt;5mm red.</li>
        <li><strong>Wind</strong> — below 30km/h green; 30–50km/h amber; above 50km/h red.</li>
        <li><strong>Humidity</strong> — below 70% green; 70–85% amber; above 85% red.</li>
        <li><strong>Temperature</strong> — 8–22°C green; 2–28°C amber; outside that red.
        Useful for flagging cold mornings or rare hot days where friction suffers.</li>
        <li><strong>Cloud cover</strong> — displayed but not scored.</li>
      </ul>
      <p>Note: MET Norway does not provide a precipitation probability field.
      Probability in the Model Comparison panel comes from Open-Meteo only.</p>

      <h2>Appearance</h2>
      <p>The app follows your device's dark/light mode by default. You can override this
      in <a href="#/settings">Settings</a> under Appearance — your preference is saved on
      your device.</p>

      <h2>Data Sources</h2>
      <ul>
        <li>
          <strong>MET Norway Locationforecast</strong> — Weather forecast data from
          <a href="https://www.met.no/en" target="_blank" rel="noopener">MET Norway</a>,
          licensed under Creative Commons 4.0 BY International.
        </li>
        <li>
          <strong>Open-Meteo</strong> — Weather data and geocoding by
          <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>,
          licensed under CC BY 4.0.
        </li>
        <li>
          <strong>Met Éireann</strong> — Copyright Met Éireann. Source: met.ie.
          This data is published under a Creative Commons Attribution 4.0 International (CC BY 4.0).
          Met Éireann does not accept any liability whatsoever for any error or omission in the data,
          their availability, or for any loss or damage arising from their use.
        </li>
      </ul>

      <h2>Privacy</h2>
      <p>This site does not collect, store, or transmit any personal data.
      Your favourites, mode preference, active location selection, and any custom locations
      you add are stored only in your browser's localStorage and never leave your device.</p>
      <p>No analytics, cookies, or tracking of any kind.</p>

      <h2>Inspiration</h2>
      <p>The idea for this project was inspired by <a href="https://www.dryrock.ie" target="_blank" rel="noopener">dryrock.ie</a> by RorySullivan.</p>

      <h2>Source Code</h2>
      <p><a href="https://github.com/dhomanx/climb-weather" target="_blank" rel="noopener">github.com/dhomanx/climb-weather</a></p>
    </div>`;
}

function renderNotFound(id) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="error-state">
      <a href="#/overview" class="back-link">← All Locations</a>
      <p>Location "${id}" not found.</p>
    </div>`;
}

init();
