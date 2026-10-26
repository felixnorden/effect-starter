# AGENTS.md

`packages/core` is the shared Effect core. It has no framework and no UI. Its
only I/O is a dynamic import of a bundled Shiki grammar or theme, which keeps the
renderer's output pinned without reading user files. A module that needs a
server, a user file, or a UI belongs in a consumer.

Read `node_modules/effect/AGENTS.md` before writing Effect code. The repository
pins Effect 4.

## Rules

- `effect`, the Markdown parser, the Markdown plugin set, the highlighter, and
  the math renderer are the runtime dependencies. Do not add a framework, a
  server, or a file-system module.
- Every exported service ships a testable layer. A layer that reads config takes
  a fixed record in tests; never read `process.env` in this package.
- Keep service keys and error tags stable. Traces and `Effect.catchTag` depend
  on them.
- This package is source-only. Consumers load `src/index.ts`; there is no build
  step.
- Tests use `@effect/vitest` in the plain Node pool. Keep `vitest.config.ts`
  plugin-free.
- `Effect.provide` belongs at entrypoints, not in this package.
- Hashes are taken after sanitization and highlighting, over the exact subtree
  the client receives, salted with the options hash.
- Block ids live only in the session. The renderer mints no identity.
- A new block kind is data on the wire. It never moves `PROTOCOL_VERSION`.

## Adding a service

1. Define it with `Context.Service`.
2. Add a static `layer` that builds the implementation.
3. Add `layerFromEnv(record)` when the layer reads config.
4. Export it from `src/index.ts`.
5. Test it with `layer()` from `@effect/vitest`.
