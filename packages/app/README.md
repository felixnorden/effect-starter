# app

A minimal hello Effect program. This package is the replaceable part of the
starter: put your real frontend, API, worker, or CLI here.

It imports `Greeting` from `@effect-starter/core`, runs one `Effect`, and logs
the result. There is no framework, server, or build step.

## Files

- `src/main.ts` — the program and its `Effect.provide(Greeting.layer)` at the
  entrypoint.
- `tsconfig.json` — no ambient types, no emit, and the Effect language service
  plugin.

## Replace it

Keep `effect`, `@effect-starter/core` as `workspace:*`, the `check:types`
script, and the package name (or update the root `dev` filter). Then change
`src/main.ts` and the `dev` script.

The root [`README.md`](../../README.md) has the replacement checklist.
