import {
  NodeHttpPlatform,
  NodeHttpServerRequest,
  NodeServices,
} from "@effect/platform-node";
import { createRequestListener } from "@react-router/node";
import { Effect, Layer, Schema } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { RouterContextProvider, type ServerBuild } from "react-router";
import type { IncomingMessage, ServerResponse } from "node:http";
// Type-only: erased at compile time, so production never loads `vite` (a
// dev-only dependency), which the runtime reaches dynamically instead.
import type { ViteDevServer } from "vite";
import { appRuntimeContext, type AppRuntime } from "./runtime.ts";

// The build output lives next to the project root, where react-router build
// writes it.
const serverEntry = new URL("../build/server/index.js", import.meta.url);
const clientDir = new URL("../build/client", import.meta.url).pathname;

/**
 * How the React Router app is reached.
 *
 * Production serves the built client assets from disk and dispatches the
 * rest to the built server bundle; development delegates Vite's protocol
 * paths to Vite's middleware stack and renders through the virtual dev
 * server build, so edits apply without restarting the Effect server.
 *
 * @example
 * import type { ReactRouterSource } from "./reactRouterApp.ts";
 *
 * const prod: ReactRouterSource = {
 *   mode: "production",
 *   serverEntry: new URL("../build/server/index.js", import.meta.url),
 *   clientDir: "build/client",
 * };
 */
export type ReactRouterSource =
  | {
      readonly mode: "production";
      readonly serverEntry: URL;
      readonly clientDir: string;
    }
  | { readonly mode: "development"; readonly vite: ViteDevServer };

/**
 * A React Router integration promise rejected at one of its lifecycle
 * stages.
 *
 * Every handler call in the bridge is wrapped in `Effect.tryPromise`, so a
 * rejection surfaces as this typed error with the `stage` that failed
 * (`"prepare"` or `"render"`) and the original cause.
 *
 * @example
 * import { ReactRouterError } from "./reactRouterApp.ts";
 *
 * const failure = new ReactRouterError({ stage: "prepare", cause: new Error("missing build") });
 * failure.stage; // "prepare"
 */
export class ReactRouterError extends Schema.TaggedError<ReactRouterError>()(
  "ReactRouterError",
  {
    stage: Schema.Literals(["prepare", "render"]),
    cause: Schema.Defect(),
  },
) {}

/**
 * Pump one request through a React Router listener and return the sentinel.
 *
 * The listener writes the response straight to the raw Node `res`
 * (`NodeHttpServerRequest.toServerResponse` hands out the original), and the
 * promise settles when that response finishes; the returned `empty` is then
 * skipped by the server writer's `writableEnded` check - the same
 * short-circuit Effect's own WebSocket upgrade relies on.
 */
const renderThrough = Effect.fnUntraced(function* (
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  request: HttpServerRequest.HttpServerRequest,
) {
  const req = NodeHttpServerRequest.toIncomingMessage(request);
  const res = NodeHttpServerRequest.toServerResponse(request);
  yield* Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        res.once("finish", () => resolve());
        res.once("close", () => resolve());
        try {
          handle(req, res);
        } catch (error) {
          reject(error);
        }
      }),
    catch: (cause) => new ReactRouterError({ stage: "render", cause }),
  });
  return HttpServerResponse.empty({ status: res.statusCode });
});

/**
 * Register React Router as the router's catch-all on `router`.
 *
 * Each mode gets one handler, chosen up front (no per-request dispatch):
 *
 * - Production `prepare`s by importing `build/server/index.js` while the
 *   program builds (a missing build fails with a `ReactRouterError` at boot,
 *   not at first request), and serves built client assets from disk first -
 *   a static miss is React Router's turn, which for a dynamic app means the
 *   pages themselves are the normal fallthrough path.
 * - Development creates no build up front: Vite owns its own lifecycle (see
 *   `withViteDevServer`), its middleware answers the dev-protocol paths and
 *   calls `next()` for the pages, and the build thunk re-imports the virtual
 *   server build per request so HMR edits apply live. The RR plugin does not
 *   add its own render middleware in Vite's `middlewareMode` - a custom
 *   server provides it, and this is that server.
 *
 * Either way the request goes to React Router's own request listener (the
 * same `@react-router/node` bridge `react-router-serve` uses), with the
 * app's `ManagedRuntime` on every request's load context under
 * `appRuntimeContext`, so loaders and actions run against the very services
 * the Effect handlers see.
 */
const registerReactRouter = Effect.fn("ReactRouter.route")(function* (
  router: HttpRouter.HttpRouter,
  source: ReactRouterSource,
  runtime: AppRuntime,
) {
  const getLoadContext = () => {
    const provider = new RouterContextProvider();
    provider.set(appRuntimeContext, runtime);
    return provider;
  };

  if (source.mode === "production") {
    const build = yield* Effect.tryPromise({
      try: () => import(source.serverEntry.href) as Promise<ServerBuild>,
      catch: (cause) => new ReactRouterError({ stage: "prepare", cause }),
    });
    const listener = createRequestListener({
      build: build as never,
      getLoadContext,
      mode: source.mode,
    });
    // Built client assets answer first; a miss is React Router's turn, and
    // anything else the file server fails with (a read error, a bad range)
    // is a render failure.
    const filesApp = yield* HttpStaticServer.make({
      root: source.clientDir,
      cacheControl: "public, max-age=31536000, immutable",
    }).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpPlatform.layer)),
    );
    yield* router.add(
      "*",
      "*",
      Effect.fn("ReactRouter.render")(function* (request) {
        return yield* filesApp.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          Effect.catch((error) =>
            error.reason._tag === "RouteNotFound"
              ? renderThrough(listener, request)
              : Effect.fail(
                  new ReactRouterError({ stage: "render", cause: error }),
                ),
          ),
        );
      }),
    );
    return;
  }

  const vite = source.vite;
  // The plugin's own dev middleware does the same thing here: import the
  // virtual server build through Vite's SSR runner per request, so
  // HMR-invalidated modules serve immediately.
  const listener = createRequestListener({
    build: () =>
      vite.ssrLoadModule("virtual:react-router/server-build") as Promise<ServerBuild>,
    getLoadContext,
    mode: source.mode,
  });
  // Vite's middleware stack must answer its protocol modules (/@vite/client,
  // /@id/..., transformed sources) before the router is asked; the stack
  // calls next() for everything else, and that fallthrough is this bridge's
  // React Router listener.
  const handle = (req: IncomingMessage, res: ServerResponse) =>
    vite.middlewares(req, res, () => listener(req, res));
  yield* router.add(
    "*",
    "*",
    Effect.fn("ReactRouter.render")((request) =>
      renderThrough(handle, request),
    ),
  );
});

/**
 * Boots a Vite dev server scoped to the layer and hands it to the bridge.
 *
 * The server runs in `middlewareMode`: it owns no port of its own. The
 * Effect `HttpRouter` is still the only listener; Vite's middleware stack is
 * consulted per request (see `registerReactRouter`), and Vite's HMR socket
 * runs on its own port, outside this pipeline entirely. Closing the layer's
 * scope closes Vite.
 *
 * @example
 * // Inside layerDev:
 * const vite = yield* withViteDevServer(); // closed with the layer's scope
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
  return vite;
});

/**
 * The React Router app, prepared for production: everything the router does
 * not already route renders through the built server bundle, with built
 * client assets served from disk first.
 *
 * @example
 * import { Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { layerProd } from "./reactRouterApp.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(
 *     Greeter.layerFor(Language.English),
 *     Incrementer.greetingCountLayer,
 *   ),
 * );
 * Layer.launch(serveApp(3456)(layerProd(runtime)));
 * // http://localhost:3456 renders every unmatched route through React Router.
 */
export const layerProd = (runtime: AppRuntime) =>
  HttpRouter.use((router) =>
    registerReactRouter(
      router,
      { mode: "production", serverEntry, clientDir },
      runtime,
    ),
  );

/**
 * The React Router app, prepared for development: the catch-all renders
 * through Vite's SSR middleware (on-demand compilation, HMR) instead of a
 * built bundle. Vite's protocol paths (/@vite/client, /@id/, optimized deps)
 * are answered by the same middleware before the router is asked.
 *
 * @example
 * import { Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { layerDev } from "./reactRouterApp.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(
 *     Greeter.layerFor(Language.English),
 *     Incrementer.greetingCountLayer,
 *   ),
 * );
 * Layer.launch(serveApp(3456)(layerDev(runtime)));
 * // Same routes as production; edits to app/ hot-reload through Vite.
 */
export const layerDev = (runtime: AppRuntime) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const vite = yield* withViteDevServer();
      yield* registerReactRouter(
        router,
        { mode: "development", vite },
        runtime,
      );
    }),
  );
