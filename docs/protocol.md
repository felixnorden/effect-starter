# Preview protocol v1

The preview server and the page exchange JSON frames over one WebSocket at
`/ws` on the same loopback origin. `PROTOCOL_VERSION` in
`packages/core/src/protocol.ts` is `1`. Every message has one conformance test
and one golden encoded frame; the version rule below separates an additive
change from a breaking one.

## Messages

| Direction | `_tag`            | Fields                                                                                                                        |
| --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| client→   | `hello`           | `protocolVersion`                                                                                                             |
| client→   | `ack`             | none. Readiness only; it triggers nothing.                                                                                    |
| client→   | `requestSnapshot` | none. The only snapshot trigger, sent on mount and on reload.                                                                 |
| server→   | `ready`           | `protocolVersion`, `title`, `fileName`                                                                                        |
| server→   | `snapshot`        | `seq`, `title`, `blocks`                                                                                                      |
| server→   | `patch`           | `seq`, `title`, optional `order`, `upserts`, `removed`                                                                        |
| server→   | `error`           | `stage`, `message`                                                                                                            |
| server→   | `session`         | `fileName`, `title`, `showFileName`, `width`, `fontSize`, `markdownCss`, `codeCss`, `scrollMode`, `smoothScroll`, `themeMode` |
| server→   | `cursor`          | `blockId`, `line`, `fraction`, `seq`                                                                                          |

A `WireBlock` is `{ id, hash, kind, range, hast }`. `hast` is an unknown
envelope field: the server sends a tree it just built, and the page guards the
shape on arrival.

`session` and `cursor` are server-to-page only. `session` carries the live file
name, title, header visibility, width, font size, the two configured stylesheet
addresses, the scroll mode and smooth flag, and the configured theme mode. It
carries no sequence. `cursor.seq` is the document sequence the cursor resolved
against; the page handles both members before its document stale-sequence guard,
and drops a cursor only when `seq` is older than the newest applied document.

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

## Version and handshake

The page sends `hello` with `PROTOCOL_VERSION` when the socket opens. The server
answers `ready` when the versions match. A different version is answered with an
`error` naming both versions, then the socket closes. A frame that does not
decode is answered with an `error` whose `stage` is `protocol`; the socket stays
open.

A version mismatch and a malformed frame are the only close reasons in v1.
There is no reconnect with backoff: a dropped socket leaves the page stale until
a reload.

## Sequence

`seq` rides on every document update and is monotonic per session. The page
drops any update whose `seq` is not greater than the last one it applied. First
paint is a `snapshot` with `seq: 1`. After that, each changed document is a
`patch` with `seq` one higher.

`ack` never answers with a frame. `requestSnapshot` is the sole snapshot
trigger; the server answers with the current snapshot at the next `seq`.

## Order

`order` is optional on a patch and carries the full id sequence. It appears only
when the id sequence changed: an insert, a delete, or a reorder. A one-paragraph
edit omits `order`, and the page keeps its current order. A full-order payload
for a large document cannot meet the 8 KB patch budget (~84 KB for 10,596 ids),
so it is never sent when the sequence is unchanged.

## Ranges

Block `range` values are snapshot- and upsert-scoped. A snapshot carries every
range. A patch carries the current range of each upserted block only; unchanged
blocks keep the range they had in the snapshot. A consumer that needs current
ranges requests a snapshot. No payload carries a full range map.

## File name

`ready` carries `fileName`: the display basename the app supplies, because the
app is the only layer that sees a path. `snapshot` and `patch` do not carry it.
The `title` stays on `ready`, `snapshot`, and `patch`. The page renders the file
name as text, never as Markdown.

A later `session` member carries the live name and title. It supersedes `ready`'s
values without changing `ready`'s bytes: `ready` keeps its first name, and the
session member follows the member whose text the page shows.
