# AGENTS.md

`packages/app` is the preview app: the thin edge and the page. It reads the
argument vector, reads and watches the file, serves the page, and opens a
browser. It owns no render logic, no block identity, and no protocol shapes —
those live in `@mdv/core`.

## Rules

- Domain logic belongs in core. This package stays a thin edge.
- `Effect.provide` is correct at this entrypoint (`src/main.ts`); the file
  disables `strictEffectProvide` for that reason. Do not copy the comment into
  library code or tests except where a test builds its own layer.
- Import protocol code from `@mdv/core/protocol`, never the core
  barrel, so the page ships schema and types rather than the renderer.
- Read config through Effect `Config` in a core layer, never with `process.env`
  here.
- Every command has a test that does not open a socket, a browser, or the real
  file system. Bun-only code stays out of anything a test imports.
- Adding a build means the package script, a root `build`, and a CI step
  together. Never add only one.
- Colours live in `src/client/styles.css` as variables. Components use the
  variables; they never contain a colour literal.
