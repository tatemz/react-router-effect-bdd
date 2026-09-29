import { Effect, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";
import { Greeter } from "../domain/greeter.ts";

/**
 * The typed body of the health endpoint, shared by server and client.
 *
 * A tagged `"ok"` status plus the greeter's greeting, so the wire shape and
 * the decoded client type cannot drift apart.
 *
 * @example
 * import { HealthResponse } from "./api.ts";
 *
 * HealthResponse.decodeUnknownSync({ status: "ok", greeting: "Hello!" });
 * // HealthResponse.decodeUnknownSync({ status: "degraded", greeting: "x" });
 * // throws: status must be "ok"
 */
export const HealthResponse = Schema.Struct({
  status: Schema.tag("ok"),
  greeting: Schema.String,
});
export type HealthResponse = typeof HealthResponse.Type;

/**
 * The system group, marked `topLevel` so its endpoints sit directly on the
 * generated client (`client.health()`) instead of nested under the group.
 *
 * @example
 * import { SystemApi } from "./api.ts";
 *
 * // The group carries the `health` endpoint, reachable at GET /health.
 */
class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", {
    success: HealthResponse,
  }).annotateMerge(
    OpenApi.annotations({
      summary: "Report service health",
      description: "Answers with the greeting of the configured Greeter.",
    }),
  ),
) {}

/**
 * The whole API contract, schema-first. Serving, the OpenAPI document, and
 * the typed client all derive from this single definition, so server
 * responses, docs, and client cannot drift apart.
 *
 * @example
 * import { OpenApi } from "effect/unstable/httpapi";
 * import { Api } from "./api.ts";
 *
 * const document = OpenApi.fromApi(Api); // the /openapi.json payload
 */
export class Api extends HttpApi.make("poc-api")
  .add(SystemApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "react-router-effect-bdd POC API",
      version: "0.1.0",
    }),
  )
{}

/**
 * The client type generated from `Api`: one method per endpoint, with the
 * endpoint's Schema types on every channel. Build an instance with
 * `HttpApiClient.make(Api, { baseUrl })`.
 *
 * @example
 * import { Effect } from "effect";
 * import { HttpApiClient } from "effect/unstable/httpapi";
 * import { Api, type ApiClient } from "./api.ts";
 *
 * const program = Effect.gen(function* () {
 *   const client: ApiClient = yield* HttpApiClient.make(Api, {
 *     baseUrl: "http://localhost:3456",
 *   });
 *   const health = yield* client.health(); // HealthResponse
 *   return health.greeting; // e.g. "Hello!"
 * });
 */
export type ApiClient = HttpApiClient.ForApi<typeof Api>;

/**
 * The `system` group implementation. Its `health` handler requires the
 * request-scoped `Greeter`, so the router still injects it with
 * `HttpRouter.provideRequest` exactly like the plain routes do.
 *
 * @example
 * import { Layer } from "effect";
 * import { HttpApiBuilder } from "effect/unstable/httpapi";
 * import { HttpRouter } from "effect/unstable/http";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Api, HealthHandlers } from "./api.ts";
 * import { Language } from "./config.ts";
 *
 * const apiLayer = HttpApiBuilder.layer(Api).pipe(Layer.provide(HealthHandlers));
 * const routes = HttpRouter.provideRequest(
 *   Greeter.layerFor(Language.English),
 * )(apiLayer);
 */
export const HealthHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handleAll({
    health: Effect.fn("Api.health")(function* () {
      const greeter = yield* Greeter;
      const greeting = yield* greeter.greet;
      return { status: "ok", greeting } as const;
    }),
  }),
);
