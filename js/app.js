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
      <p>A free tool to help Irish rock climbers find good conditions, quickly.</p>

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
      Your favourites are stored only in your browser.</p>
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
