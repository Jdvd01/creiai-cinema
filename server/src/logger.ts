const { log: _log, warn: _warn, error: _error } = console;
export const log = _log.bind(console) as (...args: unknown[]) => void;
export const warn = _warn.bind(console) as (...args: unknown[]) => void;
export const error = _error.bind(console) as (...args: unknown[]) => void;
