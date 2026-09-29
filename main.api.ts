import { NodeRuntime } from "@effect/platform-node";
import { Config, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Greeter } from "./domain/greeter.ts";
import { Incrementer } from "./domain/incrementer.ts";
import { apiApp } from "./server/apiApp.ts";
import { LanguageSchema } from "./server/config.ts";
import { serveApp } from "./server/pipeline.ts";

/**
 * The API-only entry point: the typed `Api`, `/docs`, and `/openapi.json`
 * with no React Router server.
 *
 * Reads the language and port from the environment (the config schema
 * primitives from `server/config.ts`, minus `MODE`: the API has no mode,
 * it is the same app serving either way), provides the configured `Greeter`
 * and its `greeting-count` `Incrementer` per request, then launches the
 * served app until interrupted. Unmatched routes 404.
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
  // Next server booted and no page renders. Unmatched routes 404. The API
  // has no mode: it is the same app serving either way.
  const AppLayer = Layer.unwrap(
    Effect.gen(function* () {
      const language = yield* Config.schema(LanguageSchema, "LANGUAGE");
      const port = yield* Config.Port("PORT");
      // Composition root: wire the greeter's "greeting-count" Incrementer.
      // provideMerge keeps the counter in the request context too, so a
      // handler could read the very instance the greeter bumps.
      const greeter = Layer.provideMerge(
        Greeter.layerFor(language),
        Incrementer.greetingCountLayer,
      );
      const appWithGreeter = HttpRouter.provideRequest(greeter)(apiApp);
      return serveApp(port)(appWithGreeter);
    }),
  );
  Layer.launch(AppLayer).pipe(NodeRuntime.runMain);
}
