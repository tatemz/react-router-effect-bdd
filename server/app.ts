import { Layer } from "effect";
import { apiAppWith } from "./apiApp.ts";
import {
  layerDev as reactRouterLayerDev,
  layerProd as reactRouterLayerProd,
} from "./reactRouterApp.ts";
import type { AppRuntime } from "./runtime.ts";

/**
 * The combined app: the typed Effect API and the React Router app sharing
 * one router and one managed runtime. Each half is an independent
 * composition (`server/apiApp.ts`, `server/reactRouterApp.ts`); combining
 * them here adds nothing new - the API routes and the React Router catch-all
 * simply register on the same `HttpRouter`.
 *
 * Both halves run against the `ManagedRuntime` it is given: the API handlers
 * resolve its services per request, and loaders and actions receive it as
 * React Router's load context, so the whole app has one instance of each
 * service.
 *
 * @example
 * import { Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { layerProd } from "./app.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(
 *     Greeter.layerFor(Language.English),
 *     Incrementer.greetingCountLayer,
 *   ),
 * );
 * Layer.launch(serveApp(3456)(layerProd(runtime)));
 * // /health, /docs, and /openapi.json come from the API half; everything
 * // else renders through React Router.
 */
export const layerProd = (runtime: AppRuntime) =>
  Layer.mergeAll(apiAppWith(runtime), reactRouterLayerProd(runtime));

/**
 * The combined app in development: the API plus the React Router app served
 * through Vite's dev middleware (on-demand compilation, HMR).
 *
 * @example
 * import { Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { layerDev } from "./app.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(
 *     Greeter.layerFor(Language.English),
 *     Incrementer.greetingCountLayer,
 *   ),
 * );
 * Layer.launch(serveApp(3456)(layerDev(runtime)));
 * // Same routes as production, plus Vite's dev protocol paths: edits hot-reload.
 */
export const layerDev = (runtime: AppRuntime) =>
  Layer.mergeAll(apiAppWith(runtime), reactRouterLayerDev(runtime));
