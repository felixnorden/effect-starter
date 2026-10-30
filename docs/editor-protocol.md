# Editor protocol v1

The editor adapter and the server exchange JSON frames over the editor's
standard input and standard output. `EDITOR_PROTOCOL_VERSION` in
`packages/core/src/editor-protocol.ts` is `1`. One frame is one compact JSON
payload followed by one `0x0A` byte; compact JSON never contains a newline byte,
so one line is one frame by construction. A frame is capped at 67,108,864 bytes
before the buffer grows, and a frame above the cap ends the stream.

Logs go to a file named by `--log-file`, never to the frame stream.

## Start order

The server accepts the first two members in either order and remembers which
arrived first:

1. `configuration`, then `document`: the configuration is in effect before the
   first render.
2. `document`, then `configuration`: the document renders with defaults and the
   configuration applies to the next render.

After the first document the server binds the page, builds the client, renders,
and sends `ready`. A cursor sent before `ready` waits for the first document.

## Messages

| Direction     | `_tag`          | Fields                                                        |
| ------------- | --------------- | ------------------------------------------------------------- |
| editor→server | `document`      | `path`, `text`                                                |
| editor→server | `configuration` | `values`: an array of `{ key, value, source }`                |
| editor→server | `cursor`        | `line` (1-based), `fraction` (0..1)                           |
| server→editor | `ready`         | `sessionId`, `url`                                            |
| server→editor | `error`         | `stage`, `message`, optional `clientVersion`, `serverVersion` |

Every message carries `editorProtocolVersion` as its second field. The version
is read before the message union is applied, so a mismatch reports both versions
as a value rather than as a decode failure.

## Stages

`error.stage` is a closed set: `bind`, `protocol`, `render`, `client`, `config`.
`bind` reports a listener that could not start. `protocol` reports a frame that
does not decode. `render` reports a document that could not be rendered.
`client` reports a failed page build. `config` reports a configuration value the
server rejected; the message names the key, the expected value, the received
value, and the exact source spelling.

## Configuration

The `configuration` frame carries only keys whose value class is server-owned
(`render` or `page-display`), whose resolved source is not `default`, and whose
value is not `null`. The array is in declaration order. A frame replaces the
server's configuration cell rather than merging into it, so an omitted key means
the declaration's default.

`source` is the exact carrier spelling: `default`, `setup:<dotted key>`,
`g:markdown_viewer_<name>`, or `g:mkdp_<name>`. The server re-validates every
value against the same declaration the adapters read and answers one
`config`-stage `error` when a value is rejected.

`value` is an unknown envelope field. The adapter only encodes it; the server is
the authority on its shape.

Recorded deviation: Decision B names `values` as
`array<{ key: string, value: <json>, source: string }>`. The codec generator
supports only scalar field kinds, so the schema keeps `values` as
`Schema.Unknown` and the generated wire table marks it `json`. The server checks
that `values` is an array and rejects any other shape with one `config`-stage
error before validation.

## Cursor

The `cursor` frame carries the 1-based editor line and the cursor's fraction
inside the editor window:

```
fraction = (winline() - 1) / max(1, winheight() - 1)
```

The fraction is clamped to `0..1`; folds and wrapped lines count as screen
lines, and a one-line window yields `0`. The frame carries no sequence. The
server mints the page cursor's `seq` from the document it last rendered, so no
adapter names a page sequence.

## Version output

The adapter need not parse the ready frame for versions. Run the server with the
`version` command and read three lines in this order:

```
package <package version>
bun <Bun version>
wire <EDITOR_PROTOCOL_VERSION>
```

The command opens no socket, reads no frame, writes no log file, and exits `0`.
A value that cannot be resolved prints one message and exits `1`.

## Health report

`:checkhealth markdown-viewer` in Neovim and `:MarkdownViewerHealth` in Vim print
the same eight fields in this order:

1. `discovery`
2. `server`
3. `package`
4. `bun`
5. `wire`
6. `opener`
7. `ports`
8. `floor`

Each failing field is followed by its own `fix:` line. The values come from
discovery, the `version` command, the configuration, the session table and the
floor check; no health value travels on the wire.

## Page handshake

The page protocol lives in `docs/protocol.md`. The adapter gives the page its
address and never speaks the page protocol itself. A test observer may connect
to `<url>/ws`, send `{"_tag":"hello","protocolVersion":1}` and
`{"_tag":"ack"}`, and expect `session` and `cursor` members.

## Evidence

- `bun run editor:conformance` replays the start, cursor, configuration and
  session cases against both editors.
- `bun run editor:protocol` runs a second adapter written from this document and
  observes the page receive `session` and `cursor`.
- `bun run editor:health` compares both health reports with the field order.
- `bun run editor:sessions` runs both editors against real servers.

## Version rule

```version-rule
Additive changes keep the version at 1 and must be listed in the same commit:
- a new message member
- a new message tag
- a new literal value in a closed set

Breaking changes require a version bump:
- a renamed field
- a retyped field
- a removed field
- a moved golden byte
```
