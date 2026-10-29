# AGENTS.md

Read the package's `AGENTS.md` before changing it, and
`node_modules/effect/AGENTS.md` before writing Effect code. Read the root
`README.md` when you need setup, versions, or the replace-the-app guide.

## Commands

The scripts are in `package.json`. Run them with `bun run <script>`. The gate is:

```sh
bun run check
```

The editor server has its own local build and evidence commands:

```sh
bun run build:server          # writes gitignored packages/editor/bin
bun run editor:bench:installed
```

Do not add npm, pnpm, or a second lockfile.

## Invariants

- Bun installs and runs the app. Node runs Vitest and the `effect-tsgo` patch
  during install.
- Shared versions live in the root `catalog`; packages use `"catalog:"`. Keep
  Effect and its toolchain in step when you bump.
- Keep apps as thin edges. Domain logic and config reads belong in core/adjacent packages.
- Every package defines `check:types`. The root `lint` and `fmt` commands scan
  every package. `test` runs every package with a `test` script and skips the
  rest; `dev` names the app.
- Run the tsgo patch at the root only; all packages share one TypeScript binary.
- `Effect.provide` belongs at the app entrypoint, and only there.
- `.agents/skills` is gitignored. Run `bun run skills:check`; sync only when it
  fails.
