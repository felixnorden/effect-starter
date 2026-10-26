/**
 * The one fixed dev-only port. `preview` never reads it: it binds an
 * OS-assigned port. `dev` and Vite's proxy both use this number.
 */
export const DEV_PORT = 4317;
