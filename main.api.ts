import { NodeRuntime } from "@effect/platform-node";
import { Config, Effect, Layer, ManagedRuntime } from "effect";
import { Greeter } from "./domain/greeter.ts";
import { Incrementer } from "./domain/incrementer.ts";
import { apiAppWith } from "./server/apiApp.ts";
import { LanguageSchema } from "./server/config.ts";
import { serveApp } from "./server/pipeline.ts";

/**
 * The API-only entry point: the typed `Api`, `/docs`, and `/openapi.json`
 * with no React Router server.
 *
 * Reads the language and port from the environment (the config schema
 * primitives from `server/config.ts`, minus `MODE`: the API has no mode,
 * it is the same app serving either way), makes the configured `Greeter`
 * and its `greeting-count` `Incrementer` into one `ManagedRuntime`, then
 * launches the served app until interrupted. Unmatched routes 404.
 *
 * @example
 * // No react-router build needed; serve the API alone:
 * //   PORT=3457 LANGUAGE=en node main.api.ts
 * //   # or simply:
 * //   pnpm start:api
 * // http://localhost:3457/health answers with the configured greeting.
 */
if (import.meta.main) {
  // API-only entry point: the typed Api, /docs, and /openapi.json, with no
  // React Router booted and no page renders. Unmatched routes 404. The API
  // has no mode: it is the same app serving either way.
  const AppLayer = Layer.unwrap(
    Effect.gen(function* () {
      const language = yield* Config.schema(LanguageSchema, "LANGUAGE");
      const port = yield* Config.Port("PORT");
      // Composition root: one ManagedRuntime owning the greeter and its
      // "greeting-count" Incrementer; handlers resolve its services per
      // request. Disposal rides on the app layer's scope.
      const runtime = yield* Effect.acquireRelease(
        Effect.sync(() =>
          ManagedRuntime.make(
            Layer.provideMerge(
              Greeter.layerFor(language),
              Incrementer.greetingCountLayer,
            ),
          ),
        ),
        (runtime) => runtime.disposeEffect,
      );
      return serveApp(port)(apiAppWith(runtime));
    }),
  );
  Layer.launch(AppLayer).pipe(NodeRuntime.runMain);
}
