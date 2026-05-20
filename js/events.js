let _modeHandler = null;
let _modelHandler = null;

export function registerModeHandler(fn) { _modeHandler = fn; }
export function triggerModeChange(mode) { _modeHandler?.(mode); }

export function registerModelHandler(fn) { _modelHandler = fn; }
export function triggerModelChange(source) { _modelHandler?.(source); }
