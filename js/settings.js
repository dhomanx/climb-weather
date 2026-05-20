const MODE_KEY = 'icw:mode';
export const MODES = ['optimistic', 'balanced', 'pessimistic'];

export function getMode() {
  const m = localStorage.getItem(MODE_KEY);
  return MODES.includes(m) ? m : 'pessimistic';
}

export function setMode(mode) {
  if (MODES.includes(mode)) localStorage.setItem(MODE_KEY, mode);
}

const MODEL_KEY = 'icw:model';
const MODEL_SOURCES = ['mn', 'both', 'om'];

export function getModelSource() {
  const m = localStorage.getItem(MODEL_KEY);
  return MODEL_SOURCES.includes(m) ? m : 'both';
}

export function setModelSource(source) {
  if (MODEL_SOURCES.includes(source)) localStorage.setItem(MODEL_KEY, source);
}
