import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Match } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Greeter } from "./domain/greeter.ts";
import { Incrementer } from "./domain/incrementer.ts";
import { layerDev, layerProd } from "./server/app.ts";
import { AppConfig, Mode } from "./server/config.ts";
import { serveApp } from "./server/pipeline.ts";

/**
 * The default entry point: the React Router app and the Effect HTTP API on
 * one router.
 *
 * Reads `AppConfig` from the environment, chooses the composition the mode
 * names, provides the configured `Greeter` and its `greeting-count`
 * `Incrementer`, then launches the served app until interrupted.
 *
 * @example
 * // Build first (react-router build), then serve on the configured port:
 * //   MODE=production PORT=3456 LANGUAGE=en node main.ts
 * //   # or simply:
 * //   pnpm start
 * // http://localhost:3456 renders through React Router; /health and /docs are API.
 */
if (import.meta.main) {
  // The default entry point: the React Router app and the Effect HTTP API
  // composed on one router. Build from config, then launch until interrupted.
  const AppLayer = Layer.unwrap(
    Effect.gen(function* () {
      const { mode, language, port } = yield* AppConfig;
      // The entry point is where MODE becomes a choice, made exhaustively:
      // a new mode without a branch here is a compile error.
      const app = Match.value(mode).pipe(
        Match.when(Mode.Production, () => layerProd),
        Match.when(Mode.Development, () => layerDev),
        Match.exhaustive,
      );
      // This is the composition root, so it owns the wiring the domain
      // leaves open: the greeter's "greeting-count" Incrementer.
      // provideMerge keeps the counter in the request context too, so
      // loaders read the very instance the greeter bumps.
      const greeter = Layer.provideMerge(
        Greeter.layerFor(language),
        Incrementer.greetingCountLayer,
      );
      const appWithGreeter = HttpRouter.provideRequest(greeter)(app);
      return serveApp(port)(appWithGreeter);
    }),
  );
  Layer.launch(AppLayer).pipe(NodeRuntime.runMain);
}
