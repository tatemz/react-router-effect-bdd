import { Layer } from "effect";
import { apiApp } from "./apiApp.ts";
import {
  layerDev as reactRouterLayerDev,
  layerProd as reactRouterLayerProd,
} from "./reactRouterApp.ts";

/**
 * The combined app: the typed Effect API and the React Router app sharing
 * one router. Each half is an independent composition (`server/apiApp.ts`,
 * `server/reactRouterApp.ts`); combining them here adds nothing new - the
 * API routes and the React Router catch-all simply register on the same
 * `HttpRouter`.
 *
 * Both halves still require a `Greeter` per request (the API handler and the
 * route loaders resolve the same instance) and leave it for the caller to
 * provide with `HttpRouter.provideRequest`. Loaders additionally read the
 * `Incrementer` the greeter bumps, so the composition root provides the two
 * merged (`Layer.provideMerge(greeterLayer, Incrementer.greetingCountLayer)`),
 * not just the `Greeter`.
 *
 * @example
 * import { HttpRouter } from "effect/unstable/http";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Language } from "./config.ts";
 * import { layerProd } from "./app.ts";
 *
 * const app = HttpRouter.provideRequest(Greeter.layerFor(Language.English))(layerProd);
 * // /health, /docs, and /openapi.json come from the API half; everything
 * // else renders through React Router.
 */
export const layerProd = Layer.mergeAll(apiApp, reactRouterLayerProd);

/**
 * The combined app in development: the API plus the React Router app served
 * through Vite's dev middleware (on-demand compilation, HMR).
 *
 * @example
 * import { HttpRouter } from "effect/unstable/http";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Language } from "./config.ts";
 * import { layerDev } from "./app.ts";
 *
 * const app = HttpRouter.provideRequest(Greeter.layerFor(Language.English))(layerDev);
 * // Same routes as production, plus Vite's dev protocol paths: edits hot-reload.
 */
export const layerDev = Layer.mergeAll(apiApp, reactRouterLayerDev);
