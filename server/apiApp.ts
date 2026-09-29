import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiSwagger } from "effect/unstable/httpapi";
import { Api, HealthHandlers } from "./api.ts";
import type { AppRuntime } from "./runtime.ts";

/**
 * The standalone Effect HTTP API app: routes only, with nothing React
 * Router on its imports. It registers the typed `Api` (whose `health`
 * handler greets through the request-scoped `Greeter`), the OpenAPI document
 * at `/openapi.json`, and the Swagger UI at `/docs` rendered from that same
 * document.
 *
 * Requires a `HttpRouter` to register on and a `Greeter` per request; use
 * `apiAppWith` to satisfy the request requirements from the app's runtime.
 *
 * @example
 * import { Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { apiAppWith } from "./apiApp.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(
 *     Greeter.layerFor(Language.English),
 *     Incrementer.greetingCountLayer,
 *   ),
 * );
 * Layer.launch(serveApp(3457)(apiAppWith(runtime)));
 * // http://localhost:3457/docs serves the Swagger UI; no React Router boots.
 */
export const apiApp = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(HealthHandlers),
  ),
  HttpApiSwagger.layer(Api, { path: "/docs" }),
);

/**
 * `apiApp` with its per-request services resolved from the app's
 * `ManagedRuntime`: handlers run against the runtime's own cached context,
 * so an API handler greets through the very same services a loader's
 * program uses.
 *
 * @example
 * import { Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { apiAppWith } from "./apiApp.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(Greeter.layerEnglish, Incrementer.greetingCountLayer),
 * );
 * Layer.launch(serveApp(3457)(apiAppWith(runtime)));
 */
export const apiAppWith = (runtime: AppRuntime) =>
  HttpRouter.provideRequest(Layer.effectContext(runtime.contextEffect))(
    apiApp,
  );
