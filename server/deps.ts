import { createContext, type RouterContext } from "react-router";
import type { Context } from "effect";
import type { Greeter } from "../domain/greeter.ts";
import type { Incrementer } from "../domain/incrementer.ts";

/**
 * The services the running app injects into every loader and action.
 *
 * One place to grow the set: add a service to this union and every route
 * module can run an effect against it, while a loader or action outside the
 * Effect pipeline still fails fast when the context is missing.
 *
 * @example
 * import { Context, Effect } from "effect";
 * import { RouterContextProvider } from "react-router";
 * import { Greeter } from "../domain/greeter.ts";
 * import { Incrementer } from "../domain/incrementer.ts";
 * import { appDepsContext } from "./deps.ts";
 *
 * const provider = new RouterContextProvider();
 * provider.set(appDepsContext, Context.make(
 *   Greeter,
 *   Greeter.of({ greet: Effect.succeed("Hello!") }),
 * ).pipe(Context.add(Incrementer, Incrementer.of({
 *   increment: () => Effect.void,
 *   value: Effect.succeed(0),
 * }))));
 */
export type AppDeps = Greeter | Incrementer;

declare global {
  // Stashed on globalThis so the key survives the bundler: React Router's
  // server bundle and the Effect server each evaluate this module as their
  // own module instance, and a shared plain object is the one identity both
  // sides agree on.
  var __appDepsContext: RouterContext<Context.Context<AppDeps>> | undefined;
}

/**
 * The key under which the request's Effect context reaches loaders and
 * actions.
 *
 * `server/reactRouter.ts` sets it on every request's `RouterContextProvider`;
 * route modules read it from their `context` argument and run their effects
 * with `Effect.runPromiseWith`. Created with no default value, so reading it
 * outside the pipeline throws: an empty context would silently be missing
 * every `AppDeps` service, so running a route outside the pipeline is a bug,
 * not a supported mode.
 *
 * @example
 * // Inside a route module's loader:
 * const ctx = context.get(appDepsContext); // Context.Context<AppDeps>
 * return await Effect.runPromiseWith(ctx)(greetingCard);
 */
export const appDepsContext: RouterContext<Context.Context<AppDeps>> =
  (globalThis.__appDepsContext ??= createContext<Context.Context<AppDeps>>());
