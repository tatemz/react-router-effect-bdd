import { NodeHttpServer } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { NetAddress } from "effect/unstable/net";
import { createServer } from "node:http";

/**
 * The value flowing through the app pipeline.
 *
 * A layer that registers routes on the HTTP router, plus any route
 * dependencies (as router request markers) still waiting for
 * `HttpRouter.provideRequest`. Compose `HttpRouter.add` and
 * `HttpRouter.provideRequest` results; `serveApp` / `startApp` terminate it.
 *
 * @example
 * import { Layer } from "effect";
 * import { apiApp } from "./apiApp.ts";
 * import { layerProd } from "./reactRouterApp.ts";
 * import type { EffectApp } from "./pipeline.ts";
 *
 * const app: EffectApp = Layer.mergeAll(apiApp, layerProd);
 */
export type EffectApp<E = never, R = never> = Layer.Layer<
  never,
  E,
  HttpRouter.HttpRouter | R
>;

/**
 * The pipeline's Layer terminator: `HttpRouter.serve` over
 * `NodeHttpServer`, the canonical V4 setup.
 *
 * Launch or build the resulting layer to run the app; `0` picks an
 * ephemeral port.
 *
 * @example
 * import { Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { Language } from "./config.ts";
 * import { layerProd } from "./app.ts";
 * import { serveApp } from "./pipeline.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(
 *     Greeter.layerFor(Language.English),
 *     Incrementer.greetingCountLayer,
 *   ),
 * );
 * Layer.launch(serveApp(3456)(layerProd(runtime)));
 */
export const serveApp = (port: number) => <E, R>(self: EffectApp<E, R>) =>
  Layer.provideMerge(
    HttpRouter.serve(self),
    NodeHttpServer.layer(() => createServer(), { port }),
  );

/**
 * Build the served app and return the bound port.
 *
 * The server runs until the surrounding scope closes; `0` picks an
 * ephemeral port, which is how the BDD scenarios get an isolated server per
 * scenario.
 *
 * @example
 * import { Effect, Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { Language } from "./config.ts";
 * import { layerProd } from "./app.ts";
 * import { startApp } from "./pipeline.ts";
 *
 * const runtime = ManagedRuntime.make(
 *   Layer.provideMerge(
 *     Greeter.layerFor(Language.English),
 *     Incrementer.greetingCountLayer,
 *   ),
 * );
 * const port = yield* Effect.scoped(startApp(0)(layerProd(runtime))); // e.g. 54321
 */
export const startApp = (port: number) => <E, R>(self: EffectApp<E, R>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(serveApp(port)(self));
    const address = Context.get(context, HttpServer.HttpServer).address;
    if (NetAddress.isInetAddress(address)) {
      return address.port;
    }
    return yield* Effect.die(`startApp expects an inet address, got ${address._tag}`);
  });
