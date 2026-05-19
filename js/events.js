let _modeHandler = null;

export function registerModeHandler(fn) { _modeHandler = fn; }
export function triggerModeChange(mode) { _modeHandler?.(mode); }
