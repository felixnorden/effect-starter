# packages/editor

The Neovim and Vim preview adapters, their shared harness, and the generated
codecs.

## Rules

- This package may depend on `@mdv/core` and catalogued entries only.
- The codec comparison (`src/check-codec.ts`) imports the package render
  (`src/render-codecs.ts`) and reads the committed bytes. The package never
  writes generator output; `scripts/generate-editor-frames.ts` is the only
  writer.
- No shell. No document text reaches a command line.

## Install and artifacts

- `packages/editor/bin/` is generated and gitignored. An adapter-local `bin/`
  is still checked for a standalone install. Never commit a binary or a client
  build. `scripts/build-editor-server.ts` is the only writer of the shared
  directory; `install.sh` delegates to it or downloads a release tarball into
  that directory.
- The compiled server serves `client/` from the directory beside
  `process.execPath`. A checkout serves `packages/app/dist/client`.
- Discovery checks the adapter's `bin/mdv-<os>-<arch>`, then the shared
  `packages/editor/bin/mdv-<os>-<arch>`, and on Windows the `.exe` form. The
  checkout fallback comes last; `g:markdown_viewer_server` still wins.
- The release tarball is `mdv-<os>-<arch>.tar.gz` with the binary at the root and
  `client/` beside it. `MDV_RELEASE_BASE_URL` names the directory that holds the
  tarball and its `.sha256`.

## Refresh

- **Replay rule.** Due timers fire before an event at or past their due time, in
  due order. The case clock only ever reads a case's offsets. Neither runner owns
  window arithmetic.
- **Subject rule.** A buffer-scoped event reads `args.buf`; a cursor event reads
  the current buffer.
- **Identity rule.** The identity is the bound buffer number, never its name, so
  `:saveas` heals.
- **Flush rule.** The trailing send re-reads and re-applies the gate; `pending`
  is a wake, never a snapshot.
- **Window rule.** A window opens only after a send leaves; an immediate trigger
  never schedules; a nil or non-positive timer handle means no window.
- **Stub rule.** `tests/stub-server.ts` is a test double, never imported by
  product code. It records digests and never document text, and builds its
  frames with `encodeFrame` from core.
- **Manual rule.** The text comparison is skipped; the identity re-check is not,
  so a manual press on another buffer is inert and silent.
