# AGENTS.md

`packages/core` is the shared Effect core. It has no framework, no runtime, and
no I/O. A module that needs a server, a file, or a UI belongs in a consumer.

Read `node_modules/effect/AGENTS.md` before writing Effect code. The repository
pins Effect 4.

## Layout

- `src/greeting.ts` — the service, its error, and its layers.
- `src/greeting.test.ts` — the layer-backed tests.
- `src/index.ts` — the public surface. Export new modules here.

## Rules

- `effect` is the only runtime dependency.
- Every exported service ships a testable layer. A layer that reads config takes
  a fixed record in tests; never read `process.env` in this package.
- Keep service keys and error tags stable. Traces and `Effect.catchTag` depend
  on them.
- This package is source-only. Consumers load `src/index.ts`; there is no build
  step.
- Tests use `@effect/vitest` in the plain Node pool. Keep `vitest.config.ts`
  plugin-free.
- `Effect.provide` belongs at entrypoints, not in this package.

## Adding a service

1. Define it with `Context.Service`.
2. Add a static `layer` that builds the implementation.
3. Add `layerFromEnv(record)` when the layer reads config.
4. Export it from `src/index.ts`.
5. Test it with `layer()` from `@effect/vitest`.
