const MODE_KEY = 'icw:mode';
export const MODES = ['optimistic', 'balanced', 'pessimistic'];

export function getMode() {
  const m = localStorage.getItem(MODE_KEY);
  return MODES.includes(m) ? m : 'pessimistic';
}

export function setMode(mode) {
  if (MODES.includes(mode)) localStorage.setItem(MODE_KEY, mode);
}
