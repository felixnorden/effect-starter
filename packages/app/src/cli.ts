import { Schema } from "effect";

export type Command =
  | { readonly _tag: "render"; readonly file: string }
  | { readonly _tag: "preview"; readonly file: string }
  | { readonly _tag: "dev"; readonly file: string };

export class UsageError extends Schema.TaggedError<UsageError, { readonly brand: unique symbol }>()(
  "UsageError",
  {
    message: Schema.String,
  },
) {}

/** Parse the argument vector. A usage error is a value, never a throw. */
export const parseArgs = (argv: readonly string[]): Command | UsageError => {
  const [command, file] = argv;

  if (command !== "render" && command !== "preview" && command !== "dev") {
    return new UsageError({
      message: `Unknown command ${command ?? "(none)"}; expected render, preview, or dev`,
    });
  }

  if (file === undefined || file === "") {
    return new UsageError({ message: `${command} needs a file argument` });
  }

  return { _tag: command, file };
};
