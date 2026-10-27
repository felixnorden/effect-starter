import { Effect, Schema } from "effect";

export class BuildError extends Schema.TaggedError<BuildError, { readonly brand: unique symbol }>()(
  "BuildError",
  {
    message: Schema.String,
  },
) {}

export const ensureClientBuild = (deps: {
  readonly exists: () => boolean;
  readonly build: () => Effect.Effect<void, BuildError>;
}): Effect.Effect<void, BuildError> =>
  Effect.suspend(() => (deps.exists() ? Effect.void : deps.build()));

/**
 * The fail-fast order: render first (a startup render failure exits before
 * binding), then make sure the client build exists, then start serving.
 */
export const preparePreview = <A, ERender, EStart, R>(deps: {
  readonly render: () => Effect.Effect<void, ERender, R>;
  readonly ensureClient: Effect.Effect<void, BuildError, R>;
  readonly start: () => Effect.Effect<A, EStart, R>;
}): Effect.Effect<A, ERender | BuildError | EStart, R> =>
  Effect.gen(function* () {
    yield* deps.render();
    yield* deps.ensureClient;
    return yield* deps.start();
  });
