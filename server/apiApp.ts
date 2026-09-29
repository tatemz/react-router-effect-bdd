import { Layer } from "effect";
import { HttpApiBuilder, HttpApiSwagger } from "effect/unstable/httpapi";
import { Api, HealthHandlers } from "./api.ts";

/**
 * The standalone Effect HTTP API app: routes only, with nothing React
 * Router on its imports. It registers the typed `Api` (whose `health` handler greets
 * through the request-scoped `Greeter` the caller provides), the OpenAPI
 * document at `/openapi.json`, and the Swagger UI at `/docs` rendered from
 * that same document.
 *
 * Requires a `HttpRouter` to register on and a `Greeter` per request; it
 * composes alone (`main.api.ts`) or alongside the React Router app
 * (`server/app.ts`).
 *
 * @example
 * import { Layer } from "effect";
 * import { HttpRouter } from "effect/unstable/http";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Language } from "./config.ts";
 * import { serveApp } from "./pipeline.ts";
 * import { apiApp } from "./apiApp.ts";
 *
 * const app = HttpRouter.provideRequest(
 *   Greeter.layerFor(Language.English),
 * )(apiApp);
 * Layer.launch(serveApp(3457)(app));
 * // http://localhost:3457/docs serves the Swagger UI; no React Router boots.
 */
export const apiApp = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(HealthHandlers),
  ),
  HttpApiSwagger.layer(Api, { path: "/docs" }),
);
