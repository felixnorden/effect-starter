# core

The shared Effect core of this monorepo. It holds domain logic, typed errors,
and tests, and it has no framework or runtime dependency.

```txt
src/
├─ model.ts             # BlockId, BlockKind, LineRange schemas
├─ render/
│  ├─ options.ts        # render options and the canonical options hash
│  ├─ front-matter.ts   # YAML front matter and the aligned body
│  ├─ blocks.ts         # markdown-it tokens to top-level block skeletons
│  ├─ math.ts           # KaTeX options, renderer, and the math plugin
│  ├─ toc.ts            # TOC markers, heading text, and the nav builder
│  ├─ footnotes.ts      # footnote token predicates and the section range
│  ├─ image-size.ts     # `=WxH` grammar and the image inline rule
│  ├─ plugins.d.ts      # the one local declaration for markdown-it-deflist
│  ├─ raw-html.ts       # two sanitize policies, one per fragment origin
│  ├─ highlight.ts      # Shiki dual-theme CodeHighlighting service
│  ├─ hash.ts           # block hash over the shipped subtree
│  ├─ renderer.ts       # the Renderer service and RenderError
│  ├─ document.ts       # Block and DocumentModel
│  └─ to-html.ts        # one serializer for the inspect command
├─ session/
│  ├─ block-diff.ts     # greedy hash match and the position zip
│  └─ document-session.ts  # ids, seq, snapshot and patch decisions
├─ protocol.ts          # protocol v1, codecs, and the golden-frame surface
└─ index.ts             # the package's public surface
```

## What belongs here

- **Domain services.** `Renderer` and `DocumentSession` are the worked
  examples: a `Context.Service` with a static `Layer`, a typed error raised with
  `yield*`, and an `Effect.fn` method with a trace span.
- **Rules the app must not reimplement.** If two packages need the same check,
  it belongs here.
- **Schemas for boundaries.** Add a `Schema.Class` when a service takes or
  returns a shape that crosses JSON, HTTP, or storage.

Keep it dependency-light: `effect`, `markdown-it`, the Markdown plugin set
(`@mdit/plugin-katex`, `@mdit/plugin-footnote`, `markdown-it-deflist`,
`markdown-it-emoji`), the HAST utilities, `yaml`, `katex`, and `shiki` are the
runtime dependencies. No `node:fs`, no server, no UI. The
only I/O is a dynamic import of a bundled Shiki grammar or theme. A module here
must run under Bun and under vitest unchanged.

`render/renderer.ts` demonstrates the pattern: a `Context.Service` with a static
`Layer`, a typed error raised with `yield*`, and an `Effect.fn` method with a
trace span. `session/document-session.ts` shows the `Layer.succeed` variant. The
tests build the same layer from a record, so they never read the real
environment.

The root [`README.md`](../../README.md) has the pattern table.

## Consumption

This package is private and source-only: `exports` points at `src/index.ts`, and
there is no build step. Bun strips the types when it loads the package, and a
bundler would do the same.

```ts
import { Renderer, DocumentSession } from "@mdv/core";
```

Each consumer adds the package with `workspace:*`.

## Learn more

- `AGENTS.md` in this directory: what to read before changing this package.
- Root [`README.md`](../../README.md): setup, Bun and Node split, and replacing
  the app.
- Effect docs: <https://effect.website>
