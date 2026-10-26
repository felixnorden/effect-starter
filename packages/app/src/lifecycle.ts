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
export const preparePreview = <A, ERender, EStart>(deps: {
  readonly render: () => Effect.Effect<void, ERender>;
  readonly ensureClient: Effect.Effect<void, BuildError>;
  readonly start: () => Effect.Effect<A, EStart>;
}): Effect.Effect<A, ERender | BuildError | EStart> =>
  Effect.gen(function* () {
    yield* deps.render();
    yield* deps.ensureClient;
    return yield* deps.start();
  });
