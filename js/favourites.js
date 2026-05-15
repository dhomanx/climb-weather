const STORAGE_KEY = 'icw:favourites';

export function getFavourites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveFavourites(ids) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function isFavourite(id) {
  return getFavourites().includes(id);
}

export function addFavourite(id) {
  const favs = getFavourites();
  if (!favs.includes(id)) {
    favs.push(id);
    saveFavourites(favs);
  }
}

export function removeFavourite(id) {
  saveFavourites(getFavourites().filter(f => f !== id));
}

export function toggleFavourite(id) {
  if (isFavourite(id)) {
    removeFavourite(id);
    return false;
  } else {
    addFavourite(id);
    return true;
  }
}

export function clearFavourites() {
  localStorage.removeItem(STORAGE_KEY);
}

export function importFavourites(ids) {
  const current = getFavourites();
  const added = ids.filter(id => !current.includes(id));
  saveFavourites([...current, ...added]);
  return added.length;
}

export function shareFavourites() {
  const favs = getFavourites();
  if (!favs.length) return null;
  const base = window.location.href.split('?')[0].split('#')[0];
  return `${base}#/overview?fav=${favs.join(',')}`;
}
