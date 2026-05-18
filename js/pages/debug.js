import { loadLocations } from '../locations.js';

const USER_AGENT = 'IrishClimbingWeather/1.0 (github.com/dhomanx/climb-weather)';

export async function renderDebug() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="padding:1rem">
      <a href="#/overview" style="font-size:0.85rem">← Back</a>
      <h1 style="margin:0.5rem 0">API Debug — Raw Data</h1>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
        <label for="loc-select" style="font-weight:600">Location:</label>
        <select id="loc-select" style="padding:0.3rem 0.5rem;font-size:0.9rem"></select>
        <button id="fetch-btn" style="padding:0.3rem 0.8rem">Fetch</button>
      </div>
      <div id="debug-output">Select a location and click Fetch.</div>
    </div>`;

  const locations = await loadLocations();
  const select = document.getElementById('loc-select');
  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = `${loc.name} (${loc.region})`;
    select.appendChild(opt);
  });

  document.getElementById('fetch-btn').addEventListener('click', async () => {
    const loc = locations.find(l => l.id === select.value);
    if (!loc) return;
    const out = document.getElementById('debug-output');
    out.textContent = 'Fetching…';
    try {
      await fetchAndRender(loc, out);
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
    }
  });
}

async function fetchAndRender(loc, container) {
  const [mnResp, omResp] = await Promise.allSettled([
    fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${loc.lat}&lon=${loc.lon}`, {
      headers: { 'User-Agent': USER_AGENT },
    }).then(r => r.json()),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,relative_humidity_2m,cloud_cover&forecast_days=10&wind_speed_unit=kmh&timezone=Europe%2FDublin`)
      .then(r => r.json()),
  ]);

  const mnRaw = mnResp.status === 'fulfilled' ? mnResp.value : null;
  const omRaw = omResp.status === 'fulfilled' ? omResp.value : null;

  // --- Parse MET Norway ---
  const mnRows = [];
  if (mnRaw) {
    const series = mnRaw?.properties?.timeseries ?? [];
    for (const entry of series) {
      const time = entry.time;
      const has1h = !!entry.data?.next_1_hours;
      const has6h = !!entry.data?.next_6_hours;
      const has12h = !!entry.data?.next_12_hours;
      const inst = entry.data?.instant?.details ?? {};
      const precip1h = entry.data?.next_1_hours?.details?.precipitation_amount;
      const precip6h = entry.data?.next_6_hours?.details?.precipitation_amount;
      const precip12h = entry.data?.next_12_hours?.details?.precipitation_amount;
      mnRows.push({
        time,
        interval: has1h ? '1h' : has6h ? '6h' : has12h ? '12h' : '?',
        precip1h: precip1h ?? '—',
        precip6h: precip6h ?? '—',
        precip12h: precip12h ?? '—',
        wind: ((inst.wind_speed ?? 0) * 3.6).toFixed(1),
        windDir: inst.wind_from_direction ?? '—',
        temp: inst.air_temperature ?? '—',
        humidity: inst.relative_humidity ?? '—',
        cloud: inst.cloud_area_fraction ?? '—',
      });
    }
  }

  // --- Parse Open-Meteo ---
  const omRows = [];
  if (omRaw) {
    const h = omRaw.hourly ?? {};
    const times = h.time ?? [];
    times.forEach((t, i) => {
      omRows.push({
        time: t,
        precip: h.precipitation?.[i] ?? '—',
        precipProb: h.precipitation_probability?.[i] ?? '—',
        wind: h.wind_speed_10m?.[i] ?? '—',
        windDir: h.wind_direction_10m?.[i] ?? '—',
        temp: h.temperature_2m?.[i] ?? '—',
        humidity: h.relative_humidity_2m?.[i] ?? '—',
        cloud: h.cloud_cover?.[i] ?? '—',
      });
    });
  }

  // --- Build output ---
  const th = s => `<th style="background:#f0f0f0;padding:3px 6px;border:1px solid #ccc;white-space:nowrap;font-size:0.75rem">${s}</th>`;
  const td = (s, highlight) => `<td style="padding:2px 6px;border:1px solid #ddd;font-size:0.75rem;white-space:nowrap${highlight ? ';background:#fff3cd' : ''}">${s}</td>`;

  const mnTable = mnRows.length ? `
    <h2 style="margin:1rem 0 0.4rem">MET Norway — ${mnRows.length} entries</h2>
    <p style="font-size:0.8rem;color:#666;margin:0 0 0.4rem">Interval column shows which next_Xh bucket is present for each entry.</p>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse">
        <thead><tr>
          ${th('Time (UTC)')}${th('Interval')}${th('Precip 1h mm')}${th('Precip 6h mm')}${th('Precip 12h mm')}${th('Wind km/h')}${th('Dir °')}${th('Temp °C')}${th('Hum %')}${th('Cloud %')}
        </tr></thead>
        <tbody>
          ${mnRows.map(r => `<tr>
            ${td(r.time)}
            ${td(r.interval, r.interval !== '1h')}
            ${td(r.precip1h)}${td(r.precip6h)}${td(r.precip12h)}
            ${td(r.wind)}${td(r.windDir)}${td(r.temp)}${td(r.humidity)}${td(r.cloud)}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p>MET Norway: fetch failed.</p>';

  const omTable = omRows.length ? `
    <h2 style="margin:1.5rem 0 0.4rem">Open-Meteo — ${omRows.length} entries (always 1h)</h2>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse">
        <thead><tr>
          ${th('Time (local)')}${th('Precip mm')}${th('Prob %')}${th('Wind km/h')}${th('Dir °')}${th('Temp °C')}${th('Hum %')}${th('Cloud %')}
        </tr></thead>
        <tbody>
          ${omRows.map(r => `<tr>
            ${td(r.time)}${td(r.precip)}${td(r.precipProb)}${td(r.wind)}${td(r.windDir)}${td(r.temp)}${td(r.humidity)}${td(r.cloud)}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p>Open-Meteo: fetch failed.</p>';

  container.innerHTML = `
    <p style="font-size:0.85rem"><strong>${loc.name}</strong> — lat ${loc.lat}, lon ${loc.lon}</p>
    <p style="font-size:0.8rem;color:#666">Highlighted rows in MET Norway table = non-1h interval (where data gets coarser).</p>
    ${mnTable}
    ${omTable}`;
}
