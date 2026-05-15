// Location database loader and helpers

let _locations = null;

export async function loadLocations() {
  if (_locations) return _locations;
  const resp = await fetch('./data/locations.json');
  _locations = await resp.json();
  return _locations;
}

export function getLocation(id) {
  return _locations?.find(l => l.id === id) ?? null;
}

export function getLocations() {
  return _locations ?? [];
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
