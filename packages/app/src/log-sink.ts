const TRUNCATION_NOTE = "log truncated\n";

export type LogSink = {
  /** One already-formatted line. A throw is swallowed here and nowhere else. */
  readonly write: (line: string) => void;
};

export type LogSinkDeps = {
  /** An explicit `--log-file`, or `null` to derive `<directory>/<pid>.log`. */
  readonly path: string | null;
  readonly directory: string;
  readonly pid: number;
  readonly capBytes: number;
  readonly append: (path: string, text: string) => void;
};

/** `<cacheDir>/markdown-viewer/<pid>.log` when no `--log-file` is given. */
export const logFilePath = (deps: { readonly directory: string; readonly pid: number }): string =>
  `${deps.directory.replace(/[\\/]+$/, "")}/${deps.pid}.log`;

/**
 * One writer, one destination, one cap. A line that would push the file past
 * the cap is dropped and replaced by one truncation note, so the file never
 * ends mid-line and never exceeds the cap. A failed append is dropped here.
 */
export const createLogSink = (deps: LogSinkDeps): LogSink => {
  const path = deps.path ?? logFilePath({ directory: deps.directory, pid: deps.pid });
  let written = 0;
  let truncated = false;

  return {
    write: (line) => {
      if (truncated) return;

      const text = `${line}\n`;
      // Reserve the note so the last accepted line is always the whole note.
      if (written + text.length + TRUNCATION_NOTE.length > deps.capBytes) {
        truncated = true;
        if (written + TRUNCATION_NOTE.length <= deps.capBytes) {
          try {
            deps.append(path, TRUNCATION_NOTE);
          } catch {
            // A logging fault never becomes an editor message.
          }
          written += TRUNCATION_NOTE.length;
        }
        return;
      }

      try {
        deps.append(path, text);
      } catch {
        // A logging fault never becomes an editor message.
      }
      written += text.length;
    },
  };
};

/** The session's only log lines: a bind timestamp and the end reason. */
export const bindLine = (epochMs: number): string => `bind epochMs=${epochMs}`;

export const endLine = (reason: string): string => `end reason=${reason}`;
