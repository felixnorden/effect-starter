import { Schema } from "effect";

export type Command =
  | { readonly _tag: "render"; readonly file: string }
  | { readonly _tag: "preview"; readonly file: string }
  | { readonly _tag: "dev"; readonly file: string }
  | { readonly _tag: "version" }
  | {
      readonly _tag: "editor";
      readonly logFile: string | null;
      readonly host: string;
      readonly port: number;
      readonly expose: boolean;
    };

export class UsageError extends Schema.TaggedError<UsageError, { readonly brand: unique symbol }>()(
  "UsageError",
  {
    message: Schema.String,
  },
) {}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Loopback only; exposure is refused before a process exists (PT-5). */
export const loopbackOnly = (host: string, expose: boolean): UsageError | null => {
  if (expose) {
    return new UsageError({
      message: `Refusing to open the preview to the world (--expose). PT-5 keeps the endpoint on loopback.`,
    });
  }
  if (!LOOPBACK.has(host)) {
    return new UsageError({
      message: `Refusing non-loopback host ${host}. PT-5 keeps the endpoint on loopback.`,
    });
  }
  return null;
};

const valueAfter = (args: readonly string[], index: number, flag: string): string | UsageError => {
  const value = args[index + 1];
  if (value === undefined || value === "") {
    return new UsageError({ message: `editor ${flag} needs a value` });
  }
  return value;
};

const editorArgs = (args: readonly string[]): Command | UsageError => {
  let logFile: string | null = null;
  let host = "127.0.0.1";
  let port = 0;
  let expose = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--expose") {
      expose = true;
      continue;
    }
    if (arg === "--log-file") {
      const value = valueAfter(args, index, "--log-file");
      if (value instanceof UsageError) return value;
      logFile = value;
      index += 1;
      continue;
    }
    if (arg === "--host") {
      const value = valueAfter(args, index, "--host");
      if (value instanceof UsageError) return value;
      host = value;
      index += 1;
      continue;
    }
    if (arg === "--port") {
      const value = valueAfter(args, index, "--port");
      if (value instanceof UsageError) return value;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        return new UsageError({ message: `editor --port needs a port number, received ${value}` });
      }
      port = parsed;
      index += 1;
      continue;
    }
    return new UsageError({ message: `Unknown editor argument ${arg}` });
  }

  const refused = loopbackOnly(host, expose);
  if (refused !== null) return refused;
  return { _tag: "editor", logFile, host, port, expose };
};

/** Parse the argument vector. A usage error is a value, never a throw. */
export const parseArgs = (argv: readonly string[]): Command | UsageError => {
  const [command, ...args] = argv;

  if (command === "version") {
    return args.length === 0
      ? { _tag: "version" }
      : new UsageError({ message: `version takes no arguments, received ${args[0]}` });
  }

  if (command === "editor") return editorArgs(args);

  if (command !== "render" && command !== "preview" && command !== "dev") {
    return new UsageError({
      message: `Unknown command ${command ?? "(none)"}; expected render, preview, dev, editor, or version`,
    });
  }

  const file = args[0];
  if (file === undefined || file === "") {
    return new UsageError({ message: `${command} needs a file argument` });
  }

  return { _tag: command, file };
};
