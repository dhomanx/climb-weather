// Location database loader and helpers

let _locations = null;

export async function loadLocations() {
  if (_locations) return _locations;
  const resp = await fetch('./data/locations.json');
  _locations = await resp.json();
  return _locations;
}

export function getLocation(id) {
  return _locations?.find(l => l.id === id)
    ?? getCustomLocations().find(l => l.id === id)
    ?? null;
}

export function getLocations() {
  return _locations ?? [];
}

export function getAllLocations() {
  return [...(_locations ?? []), ...getCustomLocations()];
}

export function groupByRegion(locations) {
  const order = ['Leinster', 'Munster', 'Connacht', 'Ulster'];
  const groups = {};
  for (const loc of locations) {
    if (!groups[loc.region]) groups[loc.region] = [];
    groups[loc.region].push(loc);
  }
  return order.filter(r => groups[r]).map(r => ({ region: r, locations: groups[r] }));
}

// ── Active location set ──────────────────────────────────────────────────────

export function getActiveLocations() {
  const stored = localStorage.getItem('icw:active-locations');
  if (stored === null) {
    // First visit: seed from featured built-ins
    const ids = (_locations ?? []).filter(l => l.featured).map(l => l.id);
    localStorage.setItem('icw:active-locations', JSON.stringify(ids));
    return getAllLocations().filter(l => ids.includes(l.id) || l.isCustom);
  }
  try {
    const ids = new Set(JSON.parse(stored));
    return getAllLocations().filter(l => ids.has(l.id) || l.isCustom);
  } catch {
    return getAllLocations().filter(l => l.featured || l.isCustom);
  }
}

export function setActiveLocations(ids) {
  localStorage.setItem('icw:active-locations', JSON.stringify(ids));
}

export function isLocationActive(id) {
  const loc = getAllLocations().find(l => l.id === id);
  if (!loc) return false;
  if (loc.isCustom) return true;
  try {
    const ids = JSON.parse(localStorage.getItem('icw:active-locations') ?? '[]');
    return ids.includes(id);
  } catch {
    return false;
  }
}

export function toggleLocationActive(id) {
  try {
    const ids = JSON.parse(localStorage.getItem('icw:active-locations') ?? '[]');
    const idx = ids.indexOf(id);
    if (idx === -1) {
      ids.push(id);
      localStorage.setItem('icw:active-locations', JSON.stringify(ids));
      return true;
    } else {
      ids.splice(idx, 1);
      localStorage.setItem('icw:active-locations', JSON.stringify(ids));
      return false;
    }
  } catch {
    return false;
  }
}

// ── Custom locations ─────────────────────────────────────────────────────────

export function getCustomLocations() {
  try {
    return JSON.parse(localStorage.getItem('icw:custom-locations') ?? '[]');
  } catch {
    return [];
  }
}

function generateCustomId(name) {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `custom-${slug}`;
}

export function addCustomLocation(data) {
  const customs = getCustomLocations();
  const existingIds = new Set(getAllLocations().map(l => l.id));
  let id = generateCustomId(data.name);
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `custom-${generateCustomId(data.name).slice(7)}-${suffix++}`;
  }
  const loc = { ...data, id, isCustom: true };
  customs.push(loc);
  try {
    localStorage.setItem('icw:custom-locations', JSON.stringify(customs));
  } catch {
    // Storage full — caller should handle the missing return value
    return null;
  }
  return loc;
}

export function removeCustomLocation(id) {
  const customs = getCustomLocations().filter(l => l.id !== id);
  localStorage.setItem('icw:custom-locations', JSON.stringify(customs));
  // Also remove from active set if it was there
  try {
    const ids = JSON.parse(localStorage.getItem('icw:active-locations') ?? '[]');
    const filtered = ids.filter(i => i !== id);
    if (filtered.length !== ids.length) {
      localStorage.setItem('icw:active-locations', JSON.stringify(filtered));
    }
  } catch { /* ignore */ }
}

export function updateCustomLocation(id, data) {
  const customs = getCustomLocations().map(l =>
    l.id === id ? { ...l, ...data, id, isCustom: true } : l
  );
  localStorage.setItem('icw:custom-locations', JSON.stringify(customs));
}

// ── URL sharing of custom locations ─────────────────────────────────────────

export function encodeCustomLocationForUrl(loc) {
  const { id, isCustom, ...payload } = loc;
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

export function importCustomLocationsFromParam(b64Array) {
  let imported = 0;
  const existingIds = new Set(getAllLocations().map(l => l.id));
  for (const b64 of b64Array) {
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!data || !data.name || !data.lat || !data.lon) continue;
      const candidateId = generateCustomId(data.name);
      if (existingIds.has(candidateId)) continue;
      const saved = addCustomLocation(data);
      if (saved) {
        existingIds.add(saved.id);
        imported++;
      }
    } catch { /* skip malformed */ }
  }
  return imported;
}

// ── Export / Import JSON ─────────────────────────────────────────────────────

export function exportLocationsJson() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    activeLocationIds: JSON.parse(localStorage.getItem('icw:active-locations') ?? '[]'),
    customLocations: getCustomLocations(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `icw-locations-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importLocationsJson(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { ok: false, message: 'Invalid JSON file.' };
  }
  if (data.version !== 1) {
    return { ok: false, message: 'Unrecognised export format.' };
  }

  let addedCount = 0;
  const existingIds = new Set(getAllLocations().map(l => l.id));

  for (const loc of (data.customLocations ?? [])) {
    if (!loc.id || !loc.name || !loc.lat || !loc.lon) continue;
    if (existingIds.has(loc.id)) continue;
    const saved = addCustomLocation(loc);
    if (saved) {
      existingIds.add(saved.id);
      addedCount++;
    }
  }

  // Union-merge active location IDs
  try {
    const current = new Set(JSON.parse(localStorage.getItem('icw:active-locations') ?? '[]'));
    for (const id of (data.activeLocationIds ?? [])) {
      if (existingIds.has(id)) current.add(id);
    }
    localStorage.setItem('icw:active-locations', JSON.stringify([...current]));
  } catch { /* ignore */ }

  return { ok: true, addedCount };
}
