import { Schema } from "effect";

export type Command =
  | { readonly _tag: "render"; readonly file: string }
  | { readonly _tag: "preview"; readonly file: string }
  | { readonly _tag: "dev"; readonly file: string }
  | { readonly _tag: "editor"; readonly logFile: string | null };

export class UsageError extends Schema.TaggedError<UsageError, { readonly brand: unique symbol }>()(
  "UsageError",
  {
    message: Schema.String,
  },
) {}

const editorArgs = (args: readonly string[]): Command | UsageError => {
  let logFile: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg !== "--log-file") {
      return new UsageError({ message: `Unknown editor argument ${arg}` });
    }

    const value = args[index + 1];
    if (value === undefined || value === "") {
      return new UsageError({ message: "editor --log-file needs a path" });
    }
    logFile = value;
    index += 1;
  }

  return { _tag: "editor", logFile };
};

/** Parse the argument vector. A usage error is a value, never a throw. */
export const parseArgs = (argv: readonly string[]): Command | UsageError => {
  const [command, ...args] = argv;

  if (command === "editor") return editorArgs(args);

  if (command !== "render" && command !== "preview" && command !== "dev") {
    return new UsageError({
      message: `Unknown command ${command ?? "(none)"}; expected render, preview, dev, or editor`,
    });
  }

  const file = args[0];
  if (file === undefined || file === "") {
    return new UsageError({ message: `${command} needs a file argument` });
  }

  return { _tag: command, file };
};
