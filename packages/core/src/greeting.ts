import { Config, ConfigProvider, Context, Effect, Layer, Schema } from "effect";

/**
 * A name that is empty or only whitespace. It is a `Schema.TaggedError`, so it
 * crosses a JSON boundary without losing its tag, and `yield*` can raise it.
 */
export class EmptyName extends Schema.TaggedError<EmptyName, { readonly brand: unique symbol }>()(
  "EmptyName",
  {
    message: Schema.String,
  },
) {}

/**
 * The one service this starter ships.
 *
 * It exists to show the shape of an Effect service in a monorepo:
 *
 * - `Context.Service` gives the service a stable string key and a type.
 * - The static `layer` builds the implementation and reads configuration
 *   through Effect `Config`, so nothing reads `process.env` directly.
 * - `layerFromEnv` builds the same service against a fixed record, which is how
 *   the tests avoid the real environment.
 * - `greet` is an `Effect.fn`, so it gets a trace span and keeps its typed
 *   error in the error channel.
 */
export class Greeting extends Context.Service<
  Greeting,
  {
    readonly greet: (name: string) => Effect.Effect<string, EmptyName>;
  }
>()("@effect-starter/core/Greeting") {
  static readonly layer = Layer.effect(
    Greeting,
    Effect.gen(function* () {
      const salutation = yield* Config.String("GREETING").pipe(Config.withDefault("Hello"));

      const greet = Effect.fn("Greeting.greet")(function* (name: string) {
        const trimmed = name.trim();
        if (trimmed === "") {
          return yield* new EmptyName({ message: "name must not be blank" });
        }
        return `${salutation}, ${trimmed}!`;
      });

      return Greeting.of({ greet });
    }),
  );

  /**
   * The same layer with a fixed environment. Tests use this, so no test reads
   * the environment the runner happened to start with.
   */
  static readonly layerFromEnv = (env: Record<string, string>) =>
    Greeting.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))));
}
