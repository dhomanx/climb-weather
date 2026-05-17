import { loadLocations, getLocation } from './locations.js';
import { renderOverview } from './pages/overview.js';
import { renderDetail } from './pages/detail.js';

let locations = null;

async function init() {
  locations = await loadLocations();
  handleRoute();
  window.addEventListener('hashchange', handleRoute);

  document.getElementById('refresh-footer-btn')?.addEventListener('click', () => {
    import('./api.js').then(({ forceRefresh }) => {
      forceRefresh();
      handleRoute();
    });
  });
}

function handleRoute() {
  const hash = window.location.hash || '#/overview';
  const [path, queryString] = hash.slice(1).split('?');
  const params = new URLSearchParams(queryString ?? '');
  const segments = path.replace(/^\//, '').split('/');

  const page = segments[0] || 'overview';

  if (page === '' || page === 'overview') {
    renderOverview(locations, params);
  } else if (page === 'location' && segments[1]) {
    const location = getLocation(segments[1]);
    if (location) {
      renderDetail(location);
    } else {
      renderNotFound(segments[1]);
    }
  } else if (page === 'about') {
    renderAbout();
  } else {
    renderOverview(locations, params);
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

      <h2>I'm feeling… what does that mean?</h2>
      <p>Two weather models (MET Norway and Open-Meteo) often give slightly different
      forecasts for the same location. The <strong>I'm feeling</strong> setting on the
      overview page controls how those differences are handled:</p>
      <ul>
        <li><strong>Pessimistic</strong> (default) — uses the more concerning value from
        each model for each parameter. Best for planning a long drive or committing to a
        multi-day trip. When in doubt, this is the safe choice.</li>
        <li><strong>Balanced</strong> — averages the two models. A reasonable middle ground
        for day trips where you can reassess on the morning.</li>
        <li><strong>Optimistic</strong> — uses the more favourable reading. Useful when
        you're flexible and happy to turn back if conditions aren't as good as hoped.</li>
      </ul>
      <p>Your choice is saved on your device and applies to all locations and forecasts.</p>

      <h2>How is climbability scored?</h2>
      <p>Each hour is scored green, amber, or red based on four parameters.
      The worst parameter wins:</p>
      <ul>
        <li><strong>Precipitation</strong> — scored as <em>expected rain</em>
        (amount × probability). 0.1mm at 100% confidence = amber, not red.
        5mm at 100% = red. This avoids false alarms from trace drizzle.</li>
        <li><strong>Wind</strong> — below 30km/h green; 30–50km/h amber; above 50km/h red.</li>
        <li><strong>Humidity</strong> — below 70% green; 70–85% amber; above 85% red.
        High humidity slows drying and makes wet rock stay wet.</li>
      </ul>
      <p>Daily scores use total daily precipitation: under 1mm green, 1–5mm amber, over 5mm red.</p>
      <p>Note: MET Norway does not provide a precipitation probability field.
      Probability in the Model Comparison panel comes from Open-Meteo only.</p>

      <h2>Data Sources</h2>
      <ul>
        <li>
          <strong>MET Norway Locationforecast</strong> — Weather forecast data from
          <a href="https://www.met.no/en" target="_blank" rel="noopener">MET Norway</a>,
          licensed under Creative Commons 4.0 BY International.
        </li>
        <li>
          <strong>Open-Meteo</strong> — Weather data by
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
      Your favourites and mode preference are stored only in your browser's localStorage.</p>
      <p>No analytics, cookies, or tracking of any kind.</p>

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
