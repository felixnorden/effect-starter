# AGENTS.md

`packages/app` is a hello Effect program and the replaceable part of the
starter. It runs one Effect and prints the result. There is no framework here on
purpose.

`src/main.ts` is the entrypoint. `tsconfig.json` has no ambient types, no emit,
and the Effect language service plugin. `effect` and `@effect-starter/core` are
the only runtime dependencies.

## Replacing it

Keep `effect`, `@effect-starter/core` as `workspace:*`, the `check:types`
script, and the package name (or update the root `dev` filter). Then change
`src/main.ts` and the `dev` script.

The root `README.md` has the replacement checklist.

## Rules

- Domain logic belongs in core. This package stays a thin edge.
- `Effect.provide` is correct at this entrypoint. The file disables
  `strictEffectProvide` for that reason; do not copy the comment into library
  code.
- Read config through Effect `Config` in a core layer, never with `process.env`
  here.
- Reusable Effect functions belong in core and use `Effect.fn`; one-off programs
  use `Effect.gen`.
- If the replacement adds a build, add the package script, a root `build`, and a
  CI step together. Never add only one.
