# app

The preview app: a thin Bun edge plus the React page it serves.

## Commands

```sh
bunx playwright install chromium
bun run bench:browser                      # browser budgets vs the stored baseline
bun run preview fixtures/kitchen-sink.md   # render, build once, serve, open
bun run render fixtures/kitchen-sink.md    # print the document model
bun run bench                              # render timings for the fixtures
bun run build                              # write packages/app/dist/client
bun run dev                                # app on the fixed dev port 4317
bun run dev:client                         # Vite dev server (page only)
```

`bun run bench:browser` builds the page, starts the preview against temporary
fixture copies, and measures PF-3, PF-4, and PF-5. `BASELINE=write` records the
baseline on this machine. It is outside `bun run check`.

`bun run preview` renders first (a render failure exits before binding), builds
the page once when `dist/client/index.html` is missing, prints the loopback URL,
and opens it. `bun run dev` binds the fixed dev-only port from
`src/dev-config.ts` and opens nothing; `bun run dev:client` proxies `/ws` and
`/local` to it.

## Build

`vite.config.ts` uses absolute paths for `root` and `build.outDir`, so a build
started from the repo root resolves `src/client` and writes
`packages/app/dist/client`. `dist` stays gitignored. Adding a build means the
package script, a root `build`, and a CI step together.

## Page

`src/client/` holds the page: a pure protocol reducer (`store.ts`), keyed block
rendering (`blocks.tsx`), the HAST-to-React mapping (`hast.tsx`), the view model
(`page-theme.ts`, `view-presets.ts`, `axes.ts`), the socket edge (`socket.ts`),
and the only app stylesheet (`styles.css`). Colours live in `styles.css` as CSS
variables aliased onto daisyUI tokens.

## Tests

App tests run on Node with Vitest. They never open a socket or a browser: the
store, markup, and theme are pure or injected. Read the root
[`README.md`](../../README.md) for setup and the replace-the-app guide.
