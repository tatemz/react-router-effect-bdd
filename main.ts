import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime, Match } from "effect";
import { Greeter } from "./domain/greeter.ts";
import { Incrementer } from "./domain/incrementer.ts";
import { layerDev, layerProd } from "./server/app.ts";
import { AppConfig, Mode } from "./server/config.ts";
import { serveApp } from "./server/pipeline.ts";

/**
 * The default entry point: the React Router app and the Effect HTTP API on
 * one router.
 *
 * Reads `AppConfig` from the environment, makes the configured `Greeter` and
 * its `greeting-count` `Incrementer` into one `ManagedRuntime`, chooses the
 * composition the mode names, then launches the served app until
 * interrupted. The runtime is what both halves run against: Effect handlers
 * resolve its services, and route loaders and actions receive it as React
 * Router's load context.
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
      // Composition root: the greeter's "greeting-count" Incrementer, and
      // one ManagedRuntime owning both services. provideMerge keeps the
      // counter in the runtime too, so loaders read the very instance the
      // greeter bumps. Disposal rides on the app layer's scope.
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
      // The entry point is where MODE becomes a choice, made exhaustively:
      // a new mode without a branch here is a compile error.
      const app = Match.value(mode).pipe(
        Match.when(Mode.Production, () => layerProd(runtime)),
        Match.when(Mode.Development, () => layerDev(runtime)),
        Match.exhaustive,
      );
      return serveApp(port)(app);
    }),
  );
  Layer.launch(AppLayer).pipe(NodeRuntime.runMain);
}
