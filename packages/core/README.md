# core

The shared Effect core of this monorepo. It holds domain logic, typed errors,
and tests, and it has no framework or runtime dependency.

```txt
src/
├─ greeting.ts       # Greeting service, EmptyName error, layers
├─ greeting.test.ts  # layer-backed tests
└─ index.ts          # the package's public surface
```

## What belongs here

- **Domain services.** `Greeting` is the worked example: a `Context.Service`
  with a static `Layer`, a config read through Effect `Config`, and a typed
  error raised with `yield*`.
- **Rules the app must not reimplement.** If two packages need the same check,
  it belongs here.
- **Schemas for boundaries.** Add a `Schema.Class` when a service takes or
  returns a shape that crosses JSON, HTTP, or storage.

Keep it dependency-light: `effect` is the only runtime dependency. No `node:fs`,
no server, no UI. A module here must run under Bun and under vitest unchanged.

`greeting.ts` demonstrates the pattern: a `Context.Service` with a static
`Layer`, a config read through Effect `Config`, a typed error raised with
`yield*`, and an `Effect.fn` method with a trace span. The tests build the same
layer from a record, so they never read the real environment.

The root [`README.md`](../../README.md) has the pattern table.

## Consumption

This package is private and source-only: `exports` points at `src/index.ts`, and
there is no build step. Bun strips the types when it loads the package, and a
bundler would do the same.

```ts
import { Greeting } from "@effect-starter/core";
```

Each consumer adds the package with `workspace:*`.

## Learn more

- `AGENTS.md` in this directory: what to read before changing this package.
- Root [`README.md`](../../README.md): setup, Bun and Node split, and replacing
  the app.
- Effect docs: <https://effect.website>
