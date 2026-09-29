import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime, Match } from "effect";
import { Greeter } from "./domain/greeter.ts";
import { Incrementer } from "./domain/incrementer.ts";
import { AppConfig, Mode } from "./server/config.ts";
import { layerDev, layerProd } from "./server/reactRouterApp.ts";
import { serveApp } from "./server/pipeline.ts";

/**
 * The React Router-only entry point: pages through the Effect server, no
 * API.
 *
 * Reads `AppConfig` from the environment, makes the configured `Greeter` and
 * its `greeting-count` `Incrementer` into one `ManagedRuntime`, chooses the
 * React Router composition the mode names, then launches the served app
 * until interrupted. No API routes (`/health`, `/docs`) exist here; unmatched
 * routes render through React Router.
 *
 * @example
 * // Build first (react-router build), then serve on the configured port:
 * //   MODE=production PORT=3456 LANGUAGE=en node main.rr.ts
 * //   # or simply:
 * //   pnpm start:rr
 * // http://localhost:3456 renders through React Router only.
 */
if (import.meta.main) {
  // React Router-only entry point: pages render through the Effect server
  // and no API routes (/health, /docs) exist. Build from config, then launch.
  const AppLayer = Layer.unwrap(
    Effect.gen(function* () {
      const { mode, language, port } = yield* AppConfig;
      // Composition root: one ManagedRuntime owning the greeter and its
      // "greeting-count" Incrementer; loaders receive it as React Router's
      // load context. Disposal rides on the app layer's scope.
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
      const reactRouter = Match.value(mode).pipe(
        Match.when(Mode.Production, () => layerProd(runtime)),
        Match.when(Mode.Development, () => layerDev(runtime)),
        Match.exhaustive,
      );
      return serveApp(port)(reactRouter);
    }),
  );
  Layer.launch(AppLayer).pipe(NodeRuntime.runMain);
}
