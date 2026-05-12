// Production-safe logger.
// debug/log calls are compiled out in production builds (Vite esbuild `pure`).
// warn/error are kept in all environments for operational visibility.

const dev = import.meta.env.DEV;

export const logger = {
  debug: dev ? (...a: unknown[]) => console.debug(...a) : () => {},
  log:   dev ? (...a: unknown[]) => console.log(...a)   : () => {},
  warn:  (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
} as const;
