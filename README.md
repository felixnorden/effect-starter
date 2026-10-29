# mdv

A local Markdown viewer, built as an Effect-first Bun workspace. The renderer is
a source-only core package; the app is a thin preview edge with a statically
built React page.

- `packages/core` — the renderer, the session, and the protocol. Source-only.
- `packages/app` — file watch, the WebSocket server, and the rendered page.
- `packages/editor` — the Neovim and Vim adapters, their shared harness, and the
  generated codecs.

## Start

Bun 1.4+ installs and runs the app. Node 22.20+ runs Vitest and the
`effect-tsgo` patch during install; `.nvmrc` pins Node.

```sh
bun install
bun run dev
bun run preview fixtures/kitchen-sink.md
bun run render fixtures/kitchen-sink.md
bun run bench
bun run fixtures:generate  # rewrites the committed large fixtures
bun run themes:generate    # rewrites the committed theme sheets and offerable list
```

`bun run preview fixtures/kitchen-sink.md` renders the file, builds the page
once when `packages/app/dist/client` is missing, serves it on an OS-assigned
loopback port, prints the URL, and opens it. Saving the file patches the page.

`bun run render` prints one Markdown file's document model, and `bun run bench`
prints render timings for the fixtures. Scripts live in `package.json`;
`bun run check` is the gate and covers types, lint, format, and tests. No account
or env file is required.

## Browser accessibility suite

```sh
bunx playwright install chromium
bun run check:a11y   # axe, contrast, math console, and scroll/focus evidence
```

`check:a11y` builds the page and runs its own Playwright suite, so it sits
outside `bun run check` and runs as its own `a11y` CI job. It prints the axe
violations on the kitchen sink and the TOC fixture, the contrast ratio of every
sampled text family in both themes, the math console and request result, and
the scroll/focus result of an edit above the viewport.

## Browser bench

```sh
bunx playwright install chromium
bun run bench:browser                  # compare against the stored baseline
BASELINE=write bun run bench:browser   # record a new baseline on this machine
```

`bench:browser` measures PF-3 (100 KB page paint), PF-4 (one-paragraph edit to
the next paint), and PF-5 (1 MB paint and update), prints the p95 beside the
baseline, and fails on a 20 % regression. It stays outside `bun run check`, and
the stored baseline is per machine. PF-3 uses a warm browser, so its 2 s
browser-launch clause is not measured.

## Development

The page is developed as two processes:

```sh
bun run dev         # app under watch on the fixed dev-only port 4317
bun run dev:client  # Vite, proxying /ws and /local to 4317
```

Open Vite's URL. The fixed dev port is defined once in
`packages/app/src/dev-config.ts`; `preview` never reads it. Development uses
`fixtures/kitchen-sink.md` unless you edit the `dev` script.

## Editor

The Neovim and Vim adapters live in `packages/editor`. Install them with your
plugin manager and point its build hook at `./install.sh`; the package README
has lazy.nvim and vim-plug examples.

```sh
bun run build:server
bun run editor:bench:installed
```

`build:server` writes the gitignored `packages/editor/bin/mdv-<os>-<arch>` and
`bin/client/`. With Bun and a checkout, `install.sh` runs that build. Otherwise
it downloads `mdv-<os>-<arch>.tar.gz` and its `.sha256` from
`MDV_RELEASE_BASE_URL`. No binary or client bundle is committed.

Editor evidence runs beside the gate: `bun run editor:probe`,
`bun run editor:conformance`, `bun run editor:lifecycle`,
`bun run editor:refresh`, `bun run editor:bench`, and
`bun run editor:bench:installed`.

## Layout

```txt
packages/
├─ core/src/
│  ├─ model.ts          # block primitives
│  ├─ render/           # options, blocks, sanitizer, Shiki, renderer
│  ├─ session/          # block diff and the document session
│  ├─ protocol.ts       # preview protocol v1
│  └─ index.ts          # public surface
├─ app/
│  ├─ src/main.ts       # CLI entrypoint
│  ├─ src/client/       # the React page
│  └─ vite.config.ts    # client build
└─ editor/
   ├─ nvim/             # Neovim adapter and its install wrapper
   ├─ vim/              # Vim adapter and its install wrapper
   ├─ install.sh        # build or download the server
   └─ bin/              # generated server and client, gitignored
```

## Replace the app

`packages/app/src/main.ts` is a placeholder. Keep `effect`,
`@mdv/core` as `workspace:*`, the `check:types` script, and the
package name (or update the root `dev` filter). Then change the entrypoint and
the `dev` script. Add a `test` script if the replacement has tests; the root
command picks it up.

Hono, React, a Cloudflare Worker, or a CLI all work. Keep domain logic and
config reads in core. If the replacement adds a build, add the package script, a
root `build`, and a CI step together. `bun run build` writes
`packages/app/dist/client`. The editor server has its own root build,
`bun run build:server`, and its own CI step in the editors job.

## Core example

`packages/core/src/render/renderer.ts` shows the shape to copy: a
`Context.Service` with a static `Layer`, a `Schema.TaggedError` (`RenderError`),
and an `Effect.fn` method with a trace span. `DocumentSession` shows the
`Layer.succeed` variant. Tests build the same layer from a record, so they never
read the real environment.

Export new services from `src/index.ts` and test them with `layer()` from
`@effect/vitest`. Read `node_modules/effect/AGENTS.md` before writing Effect
code.

## Tests

`bun run test` runs every package with a `test` script and skips the rest. The
core and app tests run on Node with Vitest; Bun runs the app itself. The suites
use `layer()` from `@effect/vitest`, which `bun:test` does not provide, so the
test pools stay on Node. Keep `vitest.config.ts` plugin-free in both packages.

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
