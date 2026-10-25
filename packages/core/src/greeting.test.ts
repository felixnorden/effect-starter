import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";

import { EmptyName, Greeting } from "./greeting.ts";

// `layer` builds the service once for the block against a fixed environment, so
// no test reads the environment the runner happened to start with.
layer(Greeting.layerFromEnv({}))("default salutation", (tests) => {
  tests.effect("greets with the default", () =>
    Effect.gen(function* () {
      const greeting = yield* Greeting;
      assert.strictEqual(yield* greeting.greet("World"), "Hello, World!");
    }),
  );

  tests.effect("trims the name", () =>
    Effect.gen(function* () {
      const greeting = yield* Greeting;
      assert.strictEqual(yield* greeting.greet("  Ada  "), "Hello, Ada!");
    }),
  );

  tests.effect("fails with EmptyName when the name is blank", () =>
    Effect.gen(function* () {
      const greeting = yield* Greeting;
      const error = yield* Effect.flip(greeting.greet("   "));
      assert.instanceOf(error, EmptyName);
      assert.strictEqual(error.message, "name must not be blank");
    }),
  );
});

layer(Greeting.layerFromEnv({ GREETING: "Howdy" }))("configured salutation", (tests) => {
  tests.effect("reads GREETING through Config", () =>
    Effect.gen(function* () {
      const greeting = yield* Greeting;
      assert.strictEqual(yield* greeting.greet("Ada"), "Howdy, Ada!");
    }),
  );
});
