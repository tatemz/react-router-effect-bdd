import {
  NodeHttpPlatform,
  NodeHttpServerRequest,
  NodeServices,
} from "@effect/platform-node";
import { createRequestListener } from "@react-router/node";
import { Context, Effect, Layer, Schema } from "effect";
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { RouterContextProvider, type ServerBuild } from "react-router";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { appDepsContext, type AppDeps } from "./deps.ts";

/**
 * Carries the request fiber's Effect context into `createRequestListener`'s
 * `getLoadContext` callback.
 *
 * The listener is built once, but the context differs per request: `render`
 * runs the listener inside `depsStore.run(context, ...)`, and
 * `getLoadContext` - called synchronously inside the same async chain -
 * reads it back and puts it on the `RouterContextProvider` React Router
 * hands to every loader and action. Stashed on `globalThis` for the same
 * cross-bundler reason as `appDepsContext` itself: Vite's dev server and the
 * route modules can evaluate a module as separate instances.
 *
 * @example
 * import { depsStore } from "./reactRouter.ts";
 *
 * depsStore.getStore(); // undefined outside a render
 */
declare global {
  var __appDepsStore: AsyncLocalStorage<Context.Context<AppDeps>> | undefined;
}
export const depsStore: AsyncLocalStorage<Context.Context<AppDeps>> =
  (globalThis.__appDepsStore ??= new AsyncLocalStorage());

/**
 * The slice of Vite's dev server this bridge uses, typed structurally so
 * production never loads `vite` (a dev-only dependency).
 */
export interface ViteLike {
  readonly middlewares: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ) => void;
  ssrLoadModule(url: string): Promise<unknown>;
}

/**
 * How the React Router app is reached.
 *
 * Production serves the built client assets from disk and dispatches the
 * rest to the built server bundle; development delegates Vite's protocol
 * paths to Vite's middleware stack and renders through the virtual dev
 * server build, so edits apply without restarting the Effect server.
 *
 * @example
 * import type { ReactRouterSource } from "./reactRouter.ts";
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
  | { readonly mode: "development"; readonly vite: ViteLike };

/**
 * A React Router integration promise rejected at one of its lifecycle
 * stages.
 *
 * Every handler call in `ReactRouter.make` is wrapped in `Effect.tryPromise`,
 * so a rejection surfaces as this typed error with the `stage` that failed
 * (`"prepare"` or `"render"`) and the original cause.
 *
 * @example
 * import { ReactRouterError } from "./reactRouter.ts";
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
 * The React Router side of the app as a service: renders requests through
 * the router.
 *
 * `render` hands the raw Node request to React Router's own request listener
 * (the same `@react-router/node` bridge `react-router-serve` uses), with the
 * request fiber's Effect context stashed in the load context under
 * `appDepsContext` so loaders and actions resolve the very services the
 * Effect handlers see. In production, built client assets are served from
 * disk first; anything the files do not answer falls through to the router.
 * Because rendering is just a service method, a scenario or test can provide
 * a fake instead of building the real app.
 *
 * @example
 * import { Layer } from "effect";
 * import { HttpServerResponse } from "effect/unstable/http";
 * import { ReactRouter } from "./reactRouter.ts";
 *
 * const fake = Layer.succeed(
 *   ReactRouter,
 *   ReactRouter.of({
 *     render: () => Effect.succeed(HttpServerResponse.text("rendered")),
 *   }),
 * );
 */
export class ReactRouter extends Context.Service<
  ReactRouter,
  {
    /**
     * Renders one request through React Router.
     *
     * The request fiber's Effect context is carried into loaders and actions
     * under `appDepsContext`, so they resolve the same `Greeter` and
     * `Incrementer` the Effect handlers use.
     *
     * @example
     * import { Effect } from "effect";
     * import { ReactRouter } from "./reactRouter.ts";
     *
     * const router = yield* ReactRouter;
     * const response = yield* router.render(request);
     */
    readonly render: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, ReactRouterError>;
  }
>()("ReactRouter") {
  /**
   * The live implementation for one source: resolve what the mode needs,
   * then render through it.
   *
   * Production `prepare`s by importing `build/server/index.js` while the
   * program builds (a missing build fails with a `ReactRouterError` at boot,
   * not at first request) and builds the static-file app for `build/client`
   * once. Development creates no build up front: Vite owns its own lifecycle
   * (see `server/reactRouterApp.ts`), and the build thunk re-imports the
   * virtual server build per request so HMR edits apply live.
   *
   * @example
   * import { Effect } from "effect";
   * import { ReactRouter } from "./reactRouter.ts";
   *
   * const router = yield* ReactRouter.make({
   *   mode: "production",
   *   serverEntry: new URL("../build/server/index.js", import.meta.url),
   *   clientDir: "build/client",
   * });
   */
  static readonly make = (source: ReactRouterSource) =>
    Effect.gen(function* () {
      // The listener both modes share: node-fetch-server bridges the raw
      // Node req/res to web Request/Response, and its getLoadContext runs in
      // the same async chain as `render`, so it can read the stashed Effect
      // context and hand it to React Router as the loaders' `context`.
      const makeListener = (
        build: ServerBuild | (() => Promise<ServerBuild>),
      ) =>
        createRequestListener({
          build: build as never,
          getLoadContext: () => {
            const stored = depsStore.getStore();
            if (stored === undefined) {
              throw new Error(
                "No app context for this render. Requests must enter through the Effect app pipeline (see ReactRouter.render).",
              );
            }
            const provider = new RouterContextProvider();
            provider.set(appDepsContext, stored);
            return provider;
          },
          mode: source.mode,
        });

      let listener: (req: IncomingMessage, res: ServerResponse) => void;

      let staticApp:
        | Effect.Effect<
            HttpServerResponse.HttpServerResponse,
            HttpServerError.HttpServerError,
            HttpServerRequest.HttpServerRequest
          >
        | undefined;

      if (source.mode === "production") {
        const build = yield* Effect.tryPromise({
          try: () => import(source.serverEntry.href) as Promise<ServerBuild>,
          catch: (cause) => new ReactRouterError({ stage: "prepare", cause }),
        });
        listener = makeListener(build);
        // Built client assets answer first; a miss falls through to the
        // router below. A fully dynamic app emits no HTML files, so misses
        // (the pages themselves) are the normal path.
        staticApp = yield* HttpStaticServer.make({
          root: source.clientDir,
          cacheControl: "public, max-age=31536000, immutable",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(NodeServices.layer, NodeHttpPlatform.layer),
          ),
        );
      } else {
        // The RR plugin does not add its own render middleware in Vite's
        // middlewareMode - a custom server provides it. The plugin's own
        // dev middleware does the same thing here: import the virtual
        // server build through Vite's SSR runner per request, so
        // HMR-invalidated modules serve immediately.
        listener = makeListener(() =>
          source.vite.ssrLoadModule(
            "virtual:react-router/server-build",
          ) as Promise<ServerBuild>,
        );
      }

      const renderRouter = Effect.fn("ReactRouter.render")(function* (
        request: HttpServerRequest.HttpServerRequest,
      ) {
        const req = NodeHttpServerRequest.toIncomingMessage(request);
        const res = NodeHttpServerRequest.toServerResponse(request);

        // In development, Vite's middleware stack must answer its protocol
        // modules (/@vite/client, /@id/..., transformed sources) before the
        // router is asked; the stack calls next() for everything else, and
        // that fallthrough is this bridge's React Router listener. In
        // production the listener alone owns the request.
        const handle: (req: IncomingMessage, res: ServerResponse) => void =
          source.mode === "development"
            ? (req, res) =>
                source.vite.middlewares(req, res, () => listener(req, res))
            : listener;

        // The request fiber's context is the bridge into the router; the
        // AsyncLocalStorage carries it across the promise boundary into
        // getLoadContext, exactly where React Router reads the load context.
        const context = (yield* Effect.context<never>()) as Context.Context<AppDeps>;
        yield* Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              res.once("finish", () => resolve());
              res.once("close", () => resolve());
              depsStore.run(context, () => {
                try {
                  handle(req, res);
                } catch (error) {
                  reject(error);
                }
              });
            }),
          catch: (cause) => new ReactRouterError({ stage: "render", cause }),
        });
        // React Router owns this response: the promise resolved when the
        // response finished, so the server writer's `writableEnded` check
        // skips the sentinel below.
        return HttpServerResponse.empty({ status: res.statusCode });
      });

      if (staticApp === undefined) {
        return ReactRouter.of({ render: renderRouter });
      }
      const filesApp = staticApp;

      // Serve the file if it exists; a static miss is React Router's turn.
      const render = Effect.fn("ReactRouter.render")(function* (
        request: HttpServerRequest.HttpServerRequest,
      ) {
        return yield* filesApp.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          // A miss is React Router's turn; anything else the file server
          // fails with (a read error, a bad range) is a render failure.
          Effect.catch((error) =>
            error.reason._tag === "RouteNotFound"
              ? renderRouter(request)
              : Effect.fail(new ReactRouterError({ stage: "render", cause: error })),
          ),
        );
      });
      return ReactRouter.of({ render });
    });

  /**
   * The live layer: `ReactRouter.make` as a `Layer`.
   *
   * @example
   * import { HttpRouter } from "effect/unstable/http";
   * import { ReactRouter } from "./reactRouter.ts";
   *
   * const routes = HttpRouter.provideRequest(ReactRouter.layer({
   *   mode: "production",
   *   serverEntry: new URL("../build/server/index.js", import.meta.url),
   *   clientDir: "build/client",
   * }))(reactRouterCatchAll);
   */
  static readonly layer = (source: ReactRouterSource) =>
    Layer.effect(ReactRouter, ReactRouter.make(source));
}

/**
 * Routes every request no Effect route matched to the `ReactRouter` service.
 *
 * The `"*"`/`"*"` router layer that makes React Router the app's fallback:
 * add it last so earlier Effect routes win, and provide an implementation
 * with `HttpRouter.provideRequest` - the live `ReactRouter.layer(source)`,
 * or a fake in tests.
 *
 * @example
 * import { HttpRouter } from "effect/unstable/http";
 * import { ReactRouter, reactRouterCatchAll } from "./reactRouter.ts";
 *
 * const routes = HttpRouter.provideRequest(
 *   ReactRouter.layer({
 *     mode: "production",
 *     serverEntry: new URL("../build/server/index.js", import.meta.url),
 *     clientDir: "build/client",
 *   }),
 * )(reactRouterCatchAll);
 */
export const reactRouterCatchAll = HttpRouter.add(
  "*",
  "*",
  Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest) {
    const router = yield* ReactRouter;
    return yield* router.render(request);
  }),
);
