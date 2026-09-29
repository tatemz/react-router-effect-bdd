import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import {
  reactRouterCatchAll,
  ReactRouter,
  ReactRouterError,
  type ViteLike,
} from "./reactRouter.ts";

// The build output lives next to the project root, where react-router build
// writes it.
const serverEntry = new URL("../build/server/index.js", import.meta.url);
const clientDir = new URL("../build/client", import.meta.url).pathname;

/**
 * The React Router app, prepared for production: everything the router does
 * not already route goes to the `ReactRouter` service, which serves built
 * client assets from disk and renders the rest with the built server bundle.
 *
 * @example
 * import { HttpRouter } from "effect/unstable/http";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { layerProd } from "./reactRouterApp.ts";
 *
 * const app = HttpRouter.provideRequest(Greeter.layerFor(Language.English))(layerProd);
 * Layer.launch(serveApp(3456)(app));
 * // http://localhost:3456 renders every unmatched route through React Router.
 */
export const layerProd = HttpRouter.provideRequest(
  ReactRouter.layer({ mode: "production", serverEntry, clientDir }),
)(reactRouterCatchAll);

/**
 * Boots a Vite dev server scoped to the layer and hands it to `ReactRouter`.
 *
 * The server runs in `middlewareMode`: it owns no port of its own. The
 * Effect `HttpRouter` is still the only listener; Vite's middleware stack is
 * consulted per request (see `ReactRouter.render`), and Vite's HMR socket
 * runs on its own port, outside this pipeline entirely. Closing the layer's
 * scope closes Vite.
 *
 * @example
 * // Inside layerDev's layer effect:
 * const vite = yield* withViteDevServer(); // ViteLike, closed with the scope
 */
const withViteDevServer = Effect.fn("ReactRouter.viteDevServer")(function* () {
  // Dynamic import keeps `vite` (a dev-only dependency) out of production.
  const { createServer } = yield* Effect.tryPromise({
    try: () => import("vite"),
    catch: (cause) => new ReactRouterError({ stage: "prepare", cause }),
  });
  const vite = yield* Effect.tryPromise({
    try: () =>
      createServer({
        configFile: new URL("../vite.config.ts", import.meta.url).pathname,
        server: { middlewareMode: true },
        appType: "custom",
        logLevel: "warn",
      }),
    catch: (cause) => new ReactRouterError({ stage: "prepare", cause }),
  });
  yield* Effect.addFinalizer(() =>
    Effect.tryPromise({
      try: () => vite.close(),
      catch: () => undefined,
    }).pipe(Effect.ignore),
  );
  return vite as unknown as ViteLike;
});

/**
 * The React Router app, prepared for development: the catch-all renders
 * through Vite's SSR middleware (on-demand compilation, HMR) instead of a
 * built bundle. Vite's protocol paths (/@vite/client, /@id/, optimized deps)
 * are answered by the same middleware before the router is asked.
 *
 * @example
 * import { HttpRouter } from "effect/unstable/http";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { layerDev } from "./reactRouterApp.ts";
 *
 * const app = HttpRouter.provideRequest(Greeter.layerFor(Language.English))(layerDev);
 * Layer.launch(serveApp(3456)(app));
 * // Same routes as production; edits to app/ hot-reload through Vite.
 */
export const layerDev = HttpRouter.provideRequest(
  Layer.effect(
    ReactRouter,
    Effect.flatMap(withViteDevServer(), (vite) =>
      ReactRouter.make({ mode: "development", vite }),
    ),
  ),
)(reactRouterCatchAll);
