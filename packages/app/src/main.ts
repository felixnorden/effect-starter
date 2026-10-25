// @effect-diagnostics strictEffectProvide:off
import { Greeting } from "@effect-starter/core";
import { Effect } from "effect";

/**
 * The starter's entrypoint.
 *
 * It runs one Effect program that asks the shared `Greeting` service for a
 * message and logs it. There is no framework, server, or build step here on
 * purpose: this package is the replaceable part. Swap `src/main.ts` for your
 * Hono server, your React app, your worker, or your CLI, and keep using
 * `@effect-starter/core` from it.
 *
 * Run it with:
 *
 *   bun run dev
 *   GREETING=Howdy bun run dev
 */
const program = Effect.gen(function* () {
  const greeting = yield* Greeting;
  const message = yield* greeting.greet("World");

  yield* Effect.log(message);

  return message;
}).pipe(Effect.provide(Greeting.layer));

await Effect.runPromise(program);
