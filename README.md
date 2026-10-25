# effect-starter

An Effect-first Bun workspace. No framework, no server, no build step.

- `packages/core` — shared Effect service, typed error, tests. Source-only.
- `packages/app` — hello Effect program. Replace it with your app.

## Start

Bun 1.4+ installs and runs the app. Node 22.20+ runs Vitest and the
`effect-tsgo` patch during install; `.nvmrc` pins Node.

```sh
bun install
bun run dev
GREETING=Howdy bun run dev
```

`bun run dev` runs `packages/app/src/main.ts` in watch mode. Scripts live in
`package.json`; `bun run check` is the gate and covers types, lint, format, and
tests. No account or env file is required.

## Layout

```txt
packages/
├─ core/src/
│  ├─ greeting.ts       # Greeting service, EmptyName, layers
│  ├─ greeting.test.ts  # layer-backed tests
│  └─ index.ts          # public surface
└─ app/src/main.ts      # hello Effect program (replace me)
```

## Replace the app

`packages/app/src/main.ts` is a placeholder. Keep `effect`,
`@effect-starter/core` as `workspace:*`, the `check:types` script, and the
package name (or update the root `dev` filter). Then change the entrypoint and
the `dev` script. Add a `test` script if the replacement has tests; the root
command picks it up.

Hono, React, a Cloudflare Worker, or a CLI all work. Keep domain logic and
config reads in core. If the replacement adds a build, add the package script, a
root `build`, and a CI step together.

## Core example

`packages/core/src/greeting.ts` shows the shape to copy: a `Context.Service` with
a static `Layer`, config through Effect `Config`, an `EmptyName`
`Schema.TaggedError`, and an `Effect.fn` method. `layerFromEnv` takes a record, so
tests never read the real environment.

Export new services from `src/index.ts` and test them with `layer()` from
`@effect/vitest`. Read `node_modules/effect/AGENTS.md` before writing Effect
code.

## Tests

`bun run test` runs every package with a `test` script and skips the rest. The
core tests run on Node with Vitest. Bun runs the app. The suite uses `layer()`
from `@effect/vitest`, which `bun:test` does not provide, so the test pool stays
on Node. Keep `vitest.config.ts` plugin-free.

## Task runner

Bun runs workspace scripts in package dependency order, which is enough for this
starter and keeps the dependency count down. If the repo grows a real build
graph, with tasks that depend on other tasks and caching between runs, add
Turborepo or similar.

## Versions

Shared versions are in the root `catalog`; packages use `"catalog:"`. `bun.lock`
records the resolved versions. Bump `effect` with `@effect/vitest`, and
`@effect/tsgo` with `typescript` and the Oxlint pair.

## Effect diagnostics

`bun install` runs the `postinstall` patch that gives `tsc` and `oxlint` the
Effect diagnostics. Run it at the root only; all packages share one TypeScript
binary.

The root `package.json` declares `typescript` so `node_modules/.bin/tsc` exists
for editors. `packages/app/src/main.ts` disables `strictEffectProvide` because it
is the entrypoint; do not copy that into library code.

## Skills

`.agents/` is gitignored. Check first, then sync only when something is missing:

```sh
bun run skills:check
bun run skills:sync
```

`bun install` does not restore skills.

## License

MIT.
