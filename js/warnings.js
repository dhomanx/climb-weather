import { fetchWarnings, parseWarnings } from './api.js';

export async function loadAndRenderWarnings(locations) {
  const banner = document.getElementById('warnings-banner');
  if (!banner) return;

  try {
    const xml = await fetchWarnings();
    const warnings = parseWarnings(xml);
    const relevantCounties = new Set(locations.map(l => l.county.toLowerCase()));

    const active = warnings.filter(w =>
      w.counties.some(c => relevantCounties.has(c.toLowerCase())) ||
      w.counties.length === 0 // nationwide
    );

    renderWarningsBanner(banner, active);
  } catch {
    // Warnings failing shouldn't break the app
  }
}

function renderWarningsBanner(container, warnings) {
  container.innerHTML = '';
  if (!warnings.length) return;

  for (const w of warnings) {
    const div = document.createElement('div');
    div.className = `warning-banner warning-${w.colour}`;
    div.innerHTML = `
      <strong>${warningIcon(w.colour)} ${w.type} Warning — ${capitalise(w.colour)}</strong>
      <span>${w.title}</span>
      <small>${w.description.slice(0, 140)}${w.description.length > 140 ? '…' : ''}</small>
    `;
    container.appendChild(div);
  }
}

export function renderLocationWarnings(container, warnings, county) {
  container.innerHTML = '';
  const relevant = warnings.filter(w =>
    w.counties.length === 0 ||
    w.counties.some(c => c.toLowerCase() === county.toLowerCase())
  );
  if (!relevant.length) return;

  for (const w of relevant) {
    const div = document.createElement('div');
    div.className = `warning-banner warning-${w.colour}`;
    div.innerHTML = `
      <strong>${warningIcon(w.colour)} ${w.type} Warning — ${capitalise(w.colour)}</strong>
      <span>${w.description}</span>
    `;
    container.appendChild(div);
  }
}

function warningIcon(colour) {
  if (colour === 'red') return '🔴';
  if (colour === 'orange') return '🟠';
  return '🟡';
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
