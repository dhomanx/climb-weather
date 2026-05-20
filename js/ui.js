// Shared UI helpers

export function setLoading(el, loading) {
  if (loading) {
    el.classList.add('loading');
    el.classList.remove('score-green', 'score-amber', 'score-red');
  } else {
    el.classList.remove('loading');
  }
}

export function applyScore(el, score, animate = false) {
  const classes = ['score-green', 'score-amber', 'score-red', 'loading'];
  const prev = classes.find(c => el.classList.contains(c));
  const next = `score-${score}`;
  if (prev === next) return;

  if (animate && prev) {
    el.classList.add('score-fade');
    setTimeout(() => el.classList.remove('score-fade'), 350);
  }
  el.classList.remove(...classes);
  el.classList.add(next);
}

export function scoreLabel(score) {
  if (score === 'green') return 'Good';
  if (score === 'amber') return 'Marginal';
  return 'Poor';
}

export function scoreEmoji(score) {
  if (score === 'green') return '✓';
  if (score === 'amber') return '~';
  return '✗';
}

export function conditionIcon(totalPrecip, maxWind) {
  if (totalPrecip > 5) return '🌧';
  if (totalPrecip > 1) return '🌦';
  if (maxWind > 50) return '💨';
  return '☀️';
}

export function windArrow(degrees) {
  const span = document.createElement('span');
  span.className = 'wind-arrow';
  span.style.display = 'inline-block';
  span.style.transform = `rotate(${(degrees + 180) % 360}deg)`;
  span.textContent = '↑';
  span.title = `${Math.round(degrees)}°`;
  return span;
}

const CARDINAL_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export function degToCardinal(deg) {
  return CARDINAL_DIRS[Math.round((deg % 360) / 22.5) % 16];
}

export function formatTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IE', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateShort(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString.slice ? isoString : isoString.toISOString());
  return d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric' });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function next7Days() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function showFreshnessBar(oldestTs) {
  const el = document.getElementById('freshness-time');
  if (!el) return;
  if (!oldestTs) {
    el.textContent = '—';
    return;
  }
  const age = Date.now() - oldestTs;
  const stale = age > 90 * 60 * 1000;
  el.textContent = new Date(oldestTs).toLocaleTimeString('en-IE', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  el.classList.toggle('stale', stale);
}

export function showToast(message, duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), duration);
}

export function renderError(container, message) {
  container.innerHTML = `<div class="error-state"><p>${message}</p></div>`;
}
