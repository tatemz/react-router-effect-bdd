# Is the React Router ↔ Effect bridge over-engineered?

**Date:** 2026-09-29 · **Scope:** `server/reactRouter.ts`, `server/reactRouterApp.ts`, `server/runtime.ts`
**Method:** every bridge mechanism compared against the official upstream sources —
[`remix-run/react-router`](https://github.com/remix-run/react-router) (`main`, spot-checked at tag `react-router@8.4.0`),
the official custom-server templates in [`remix-run/react-router-templates`](https://github.com/remix-run/react-router-templates),
the published React Router v8 docs, and the Effect V4 source at `~/dev/Effect-TS/effect` (rc.118 vs installed rc.117).

## Verdict

**The hunch is mostly wrong — but the instinct is half right.**

The three mechanisms that *look* like over-engineering (the `getLoadContext`
`RouterContextProvider` injection, the disk static-file server in front of the
router, and the hand-rolled Vite `middlewareMode` dev pipeline) are each the
**officially sanctioned pattern**, near-verbatim what the official
`node-custom-server` template and `react-router-serve` do. Removing any of them
breaks the app.

What *is* unnecessary is smaller and different from what was suspected:
the `Context.Service` ceremony around the bridge, a dead helper in
`runtime.ts`, a structurally re-typed Vite interface, and some variable
dancing. My estimate: **~25–35% of the code (docs included, ~30–40% of
`reactRouter.ts`) can go without changing behavior — not 99%.** Of the 482
lines in the three files, 259 are doc comments and only ~204 are code; the
code itself is roughly ~120 lines of irreducible bridge plus ~80 lines of
ceremony that can be cut.

Note: the working tree already contains an in-progress refactor (uncommitted)
that **deleted** the largest genuine offender — the `AsyncLocalStorage`
`depsStore` + `globalThis` + per-request-`Effect.context` capture — replacing
it with one `ManagedRuntime` passed to `getLoadContext`. That was the right
call; this report evaluates the current tree.

---

## The evidence, mechanism by mechanism

### 1. `createRequestListener` + `getLoadContext` → `RouterContextProvider` — NECESSARY (official pattern)

The bridge builds a per-request `RouterContextProvider` in `getLoadContext`
and puts the app's `ManagedRuntime` on it; loaders/actions read it via
`context.get(appRuntimeContext)`.

- The official `node-custom-server` template's `server/app.ts` does
  [exactly this shape](https://github.com/remix-run/react-router-templates/blob/main/node-custom-server/server/app.ts):
  `createRequestHandler({ build, getLoadContext() { const context = new RouterContextProvider(); context.set(valueFromExpressContext, …); return context; } })`.
- The v8 [middleware how-to](https://github.com/remix-run/react-router/blob/main/docs/how-to/middleware.md)
  documents it as *the* custom-server DI channel: "If you're using a custom
  server, you can use a `getLoadContext` function to pass information into
  the react router handlers."
- The [server adapter API doc](https://github.com/remix-run/react-router/blob/main/docs/api/other-api/adapter.md):
  "Return anything you want here to be available as `context` in your loaders
  and actions. **This is where you can bridge the gap between your server and
  React Router.**"
- In v8, returning a non-`RouterContextProvider` is a hard runtime error in
  `server-runtime/server.ts` — this isn't a stylistic choice, it's the
  contract. (In v7 `getLoadContext` returned a plain object; the
  `RouterContextProvider` is the typed successor.)

The docs' only refinement suggestion is to pass *scoped services* per request
rather than a whole container; passing the `ManagedRuntime` under a typed
`createContext()` key (which is what the code does) is compatible with the
guide. **Keep as-is.**

### 2. Static-file server for `build/client` with fallthrough — NECESSARY (official pattern)

Suspicion was that `createRequestHandler` might serve built assets itself,
making `HttpStaticServer` redundant. It does not.

- The
  [request-handler source](https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/server-runtime/server.ts)
  only does `matchServerRoutes(build.routes, …)` plus the fog-of-war manifest
  and `.data` special-cases. `build.assets` appears only as the JSON manifest
  for lazy route discovery and hydration — **never as file serving**. An
  `/assets/*.js` request reaching the handler falls into `handleDocumentRequest`
  and gets SSR'd/404'd.
- The official template's
  [`server.js`](https://github.com/remix-run/react-router-templates/blob/main/node-custom-server/server.js)
  puts static middleware in front:
  `app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }))`.
- The built-in `react-router-serve`
  [does the same](https://github.com/remix-run/react-router/blob/main/packages/react-router-serve/cli.ts).

The Effect-side fallthrough is also the designed mechanism, not a hack:
`HttpStaticServer.make` fails with `HttpServerError`/`RouteNotFound` on a miss
(`packages/effect/src/http/HttpStaticServer.ts:405`), which is exactly what
the `Effect.catch` on `error.reason._tag === "RouteNotFound"` consumes.

**Keep.** Minor simplification available (below): the `staticApp` mutable +
second-`render`-wrapper dance can collapse into one conditional provider.

### 3. Manual Vite `middlewareMode` + `ssrLoadModule` in dev — NECESSARY (the file's own comment is verifiably true)

The code comment claims "The RR plugin does not add its own render middleware
in Vite's `middlewareMode`." Confirmed in the
[plugin source](https://github.com/remix-run/react-router/blob/main/packages/react-router-dev/vite/plugin.ts)
(`configureServer` post-hook):

> "Let user servers handle SSR requests in middleware mode, otherwise the
> Vite plugin will handle the request" — the render middleware is registered
> only `if (!viteDevServer.config.server.middlewareMode)`.

And the official template's dev path is the same hand-rolled dance:
`vite.createServer({ server: { middlewareMode: true } })`, `app.use(viteDevServer.middlewares)`,
then `viteDevServer.ssrLoadModule(...)` per request
([template server.js](https://github.com/remix-run/react-router-templates/blob/main/node-custom-server/server.js)).
`react-router dev` is only for apps that *don't* own their server. Since this
app deliberately owns the server (the whole point of the POC), the dev
half of `reactRouterApp.ts` is ~30 lines of code that match upstream 1:1.
**Keep.** Optional template-parity tweaks: call `vite.ssrFixStacktrace(error)`
on dev errors; the template skips `appType: "custom"` (harmless to keep).

### 4. Raw `req`/`res` passthrough + sentinel `HttpServerResponse.empty()` — NECESSARY (verified against Effect source)

Because the Effect `HttpRouter` owns the Node listener, React Router's
listener needs the raw `IncomingMessage`/`ServerResponse`. Verified in the
Effect V4 source:

- `NodeHttpServerRequest.toIncomingMessage`/`toServerResponse` return the
  **original** Node objects
  (`packages/platform/node/src/NodeHttpServerRequest.ts:20-33`), so RR writes
  straight to the live socket — no double-buffering.
- Returning the sentinel is a **de facto supported** pattern: the server's
  `handleResponse` skips writing when `nodeResponse.writableEnded`
  (`packages/platform/node/src/NodeHttpServer.ts:518-525`), and Effect's own
  WebSocket-upgrade path ends the response precisely to exploit that check
  (`NodeHttpServer.ts:256-261`, with a dedicated test). The
  `finish`/`close`-promise wrapper + `Effect.tryPromise` is the minimal
  correct way to suspend the request fiber until the foreign handler completes
  (and stay interruptible).

Worth knowing there *is* an alternative architecture — Effect v4 has
`HttpRouter.toWebHandler` / `HttpEffect.fromWebHandler` for fetch-standard
`(Request) => Response` bridging (`packages/effect/src/http/HttpRouter.ts:1367`,
`HttpEffect.ts:295-465`) — but RR's Node package speaks raw
`req`/`res`, so bridging req/res → `Request` → back would only add a hop
(`createRequestListener` already *is* node-fetch-server). **Keep.**

### 5. `ReactRouter` as a `Context.Service` with `make`/`layer`/`reactRouterCatchAll` — UNNECESSARY (the real over-engineering)

The service's stated justification — "a scenario or test can provide a fake
instead of building the real app" — is aspirational: **no fake is used
anywhere.** `grep` finds no `Layer.succeed(ReactRouter, …)` /
`ReactRouter.of` outside JSDoc, and the BDD scenarios deliberately boot the
*real* built app through `startApp(0)` (that's the point of the POC).

Meanwhile the ceremony is the single biggest cost in the file: a
`Context.Service` class with a nested interface, a `make` returning the
service, a `layer` lifting `make`, *and* a separate `reactRouterCatchAll`
route that resolves the service — three levels of indirection between
"the catch-all matched" and "call `createRequestListener`". The entire
service exists so one route handler can look up one closure.

**Cut it.** One function that returns a ready `EffectApp` layer collapses
class + interface + `make` + `layer` + catch-all + all their JSDoc into a
single `HttpRouter.add("*", "*", …)` with the mode logic inline. Nothing is
lost that is used today; if a fake is ever needed, it is a one-line
`HttpRouter.add` swap.

### 6. `server/runtime.ts` helpers — MOSTLY NECESSARY, one piece DEAD

- The `globalThis` stash for the context key **is** load-bearing, not
  paranoia: the RR server bundle / Vite SSR runner and the Effect server
  each evaluate this module as their own instance, so a module-level
  `createContext()` key would be two different objects and `context.get`
  would miss. The comment is accurate.
- `AppRuntime` (the `ManagedRuntime<Greeter | Incrementer, never>` type) —
  keep; it's the contract both halves share.
- **The `AppRuntime.runPromiseWith` helper object is dead code.** After the
  in-progress refactor, every loader does
  `context.get(appRuntimeContext).runPromise(...)` directly; nothing imports
  `AppRuntime` the *value* (only the `AppRuntime` *type*). Delete it.

### 7. `ViteLike` structural interface — OPTIONAL (avoidable ceremony)

`ViteLike` exists "so production never loads `vite`". But the file already
only loads Vite dynamically (`reactRouterApp.ts` uses `yield* Effect.tryPromise(() => import("vite"))`),
and a static `import type { ViteDevServer } from "vite"` is erased at compile
time anyway — the official template imports Vite types freely. ~15 lines of
hand-maintained structural typing for zero runtime benefit. Replacing it with
`import type` from `vite` is fine; keeping it is defensible as "documenting
the used subset," but it's ceremony, not necessity.

### 8. `ReactRouterError` (Schema tagged error) — KEEP, lightly

`tryPromise → typed error` is canonical Effect V4 error handling and the ai-docs
style. The `stage` field adds one bit of value (boot failure vs render failure)
at near-zero cost. Borderline; I'd keep it. A `Data.TaggedError` would save
little.

---

## What the de-ceremonied bridge looks like

Sketch of `server/reactRouterApp.ts` after cuts 5–7 (behavior-identical;
reactRouter.ts disappears, ~425 lines → ~180 incl. docs):

```ts
import { createRequestListener } from "@react-router/node";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/unstable/http";
import { RouterContextProvider } from "react-router";
import { appRuntimeContext, type AppRuntime } from "./runtime.ts";

const reactRouterLayer = (source: Source, runtime: AppRuntime) =>
  Layer.effect(
    HttpRouter.AddRoutes<"*", "*", never>, // register the catch-all directly
    Effect.gen(function* () {
      const listener = createRequestListener({
        build: /* prod: the imported build; dev: () => vite.ssrLoadModule(...) */,
        getLoadContext: () => new RouterContextProvider().set(appRuntimeContext, runtime) as never,
        mode: source.mode,
      });
      // one handler, not a service method behind two indirections:
      return HttpRouter.add("*", "*", Effect.fn("ReactRouter.render")(function* (request) {
        const req = NodeHttpServerRequest.toIncomingMessage(request);
        const res = NodeHttpServerRequest.toServerResponse(request);
        // prod: serve build/client first, RouteNotFound falls through; dev: vite.middlewares then next -> listener
        // (the finish/close promise + sentinel empty() stay exactly as they are — see finding 4)
        ...
      }));
    }),
  );
```

Plus: delete `AppRuntime.runPromiseWith` (`server/runtime.ts`), and the
`staticApp`-variable two-`render`-fn structure becomes a single conditional
middleware inside the one handler.

## Summary table

| # | Mechanism | Hunch | Verdict (upstream evidence) |
|---|-----------|-------|------------------------------|
| 1 | `getLoadContext` → `RouterContextProvider` DI | over-built | **Official v8 pattern** — template does the same |
| 2 | Static server before router, fallthrough on miss | redundant | **Required** — handler never serves `build/client`; template + `react-router-serve` both do this |
| 3 | Hand-rolled Vite `middlewareMode` + `ssrLoadModule` dev path | over-built | **Official template pattern** — plugin provably skips render middleware in `middlewareMode` |
| 4 | Raw `req`/`res` + `writableEnded` sentinel response | hacky | **Supported** — Effect's own upgrade path uses the identical short-circuit |
| 5 | `ReactRouter` `Context.Service` + `make`/`layer`/catch-all | — | **Unnecessary** — fake never used; 3 indirections for 1 closure; cut to one `HttpRouter.add` |
| 6 | `globalThis` context-key stash + `ManagedRuntime` contract | hacky | **Necessary** (dual module instances); but `AppRuntime.runPromiseWith` is **dead code** |
| 7 | `ViteLike` structural interface | defensive | **Avoidable** — dynamic import + `import type` already keep `vite` out of prod |
| 8 | `ReactRouterError` tagged Schema error | maybe | Keep — canonical Effect style, cheap |

**Bottom line:** ~99% of the complexity is *justified*; ~25–35% of it is
*removable*, and it's the Effect-side ceremony (items 5–7), not the React
Router-facing bridge. The bridge's design is essentially the official
`node-custom-server` template re-expressed in Effect idioms — which is the
compliment the hunch couldn't have anticipated.

## Caveats

- Templates repo was read at `main` only (it carries no per-release tags I
  could map to 8.4.0); the react-router repo itself was spot-checked at tag
  `react-router@8.4.0` for `createRequestListener` and matched.
- Effect source was read at `rc.118` (local `~/dev/Effect-TS/effect`) vs the
  installed `rc.117`; the cited mechanisms (`toServerResponse`,
  `writableEnded` skip, `HttpStaticServer` `RouteNotFound`) are stable across
  that drift as far as the diff shows, but pin-check if the sentinel behavior
  ever changes.
- The line-reduction estimate is my judgment from the inventory above, not a
  measured refactor.
