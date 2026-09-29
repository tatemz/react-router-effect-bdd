import type { ManagedRuntime } from "effect";
import { createContext, type RouterContext } from "react-router";
import type { Greeter } from "../domain/greeter.ts";
import type { Incrementer } from "../domain/incrementer.ts";

/**
 * The runtime loaders and actions run their programs with: the app's
 * composition - its `Greeter` and `Incrementer` - as one managed instance.
 *
 * Built by the composition root with `ManagedRuntime.make`, handed to React
 * Router as its load context by `server/reactRouterApp.ts`, and read by route
 * modules as `context.get(appRuntimeContext)`; `runtime.runPromise` is the
 * run-promise boundary. The Effect handlers get the same services through
 * `runtime.contextEffect`, so one value connects both worlds - no bridge
 * store in between.
 *
 * @example
 * import { Effect, Layer, ManagedRuntime } from "effect";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 *
 * const runtime: AppRuntime = ManagedRuntime.make(
 *   Layer.provideMerge(Greeter.layerEnglish, Incrementer.greetingCountLayer),
 * );
 * const greeting = await runtime.runPromise(Effect.map(Greeter, (g) => g.greet));
 * // "Hello!"
 */
export type AppRuntime = ManagedRuntime.ManagedRuntime<
  Greeter | Incrementer,
  never
>;

declare global {
  // Stashed on globalThis so the key survives the bundler: React Router's
  // server bundle and the Effect server each evaluate this module as their
  // own module instance, and a shared plain object is the one identity both
  // sides agree on. Only this key crosses that boundary; the runtime itself
  // travels as a plain value in the load context.
  var __appRuntimeContext: RouterContext<AppRuntime> | undefined;
}

/**
 * The key under which the app's `ManagedRuntime` reaches loaders and actions.
 *
 * `server/reactRouterApp.ts` sets it on every request's `RouterContextProvider`;
 * route modules read it from their `context` argument and call
 * `runtime.runPromise`. Created with no default value, so reading it outside
 * the app throws: running a route without the app's runtime is a bug, not a
 * supported mode.
 *
 * @example
 * // Inside a route module's loader:
 * const runtime = context.get(appRuntimeContext); // AppRuntime
 * return await runtime.runPromise(greetingCard);
 */
export const appRuntimeContext: RouterContext<AppRuntime> =
  (globalThis.__appRuntimeContext ??= createContext<AppRuntime>());
