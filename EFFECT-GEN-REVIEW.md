# Are there "functions that should be `Effect.gen` constants"?

**Date:** 2026-09-29 · **Scope:** every Effect/Layer-returning definition in `domain/`, `server/`, `app/`, `features/`, `main*.ts` (24 sites; the exemplar you flagged was `server/apiApp.ts:59`).
**Method:** each function-shaped definition classified against the Effect V4 writing-style rule at `~/dev/Effect-TS/effect` (`rc.118`, installed is `rc.117`) — `LLMS.md`, `ai-docs/src/01_effect/01_basics/`, and the `Effect.fn`/`Effect.fnUntraced`/`Effect.gen`/`suspend` JSDoc + implementation — plus how the library authors themselves write this code in `packages/*/src`.

## Verdict

**The hunch is mostly wrong — and the one function you pointed at is a false positive.**

The exact anti-pattern the rule names — *"a function that only wraps and returns `Effect.gen`"* — is a **zero-parameter** function returning an Effect (only a no-arg function can be re-pointed at a shared constant; a parameterized program cannot). Under that strict test the codebase is already written in the idiom the hunch wishes for:

- The two purest "programs" — `greetingCard` (`GreetingCard.controller.ts:33`) and `reveal` (`Feedback.controller.ts:62`) — are **already** bare `Effect.gen` constants.
- Every **parameterized** Effect function is **already** `Effect.fn`/`Effect.fnUntraced` — 14 traced `Effect.fn("Name")` sites (all 9 BDD steps, the `Api.health` handler, `registerReactRouter`, both `ReactRouter.render` handlers, `withViteDevServer`) plus `renderThrough` as `Effect.fnUntraced`. This is precisely what the rule prescribes for functions that take arguments.

Of the 24 definitions reviewed:

- **1 genuine "should be a constant" hit** — `withViteDevServer` (`reactRouterApp.ts:214`): a **zero-parameter** `Effect.fn` called as `yield* withViteDevServer()`. It is a constant in disguise. This is the only site that actually matches your hunch.
- **2 arrow-wraps-gen sites** that are *parameterized*, so the rule's fix is `Effect.fnUntraced`, **not** a gen constant — `startApp` (`pipeline.ts:81`) and the inner `layerDev` callback (`reactRouterApp.ts:293`). The second is a gray zone (an inline callback to `HttpRouter.use`).
- **The other ~20 are correctly functions.** In particular `apiAppWith` (your exemplar), and every `layer*`/`serveApp`/`servicesFor`/`layerFor`, return a **`Layer`**, not an `Effect`. `Layer` has no `Effect.fn`/`Effect.gen` form, they take arguments, and a shared constant would freeze the `runtime` they are handed. They are the canonical V4 layer-builder shape and must stay functions.

My estimate: **the target idiom is already ~90% adopted.** Net of the three findings below you could convert **1 function to a constant** and **2 (maybe) to `Effect.fnUntraced`** — and *none* of them is the line you selected.

---

## The rule, stated exactly (so the classification is fair)

`LLMS.md:12-18`, mirrored verbatim in `ai-docs/src/01_effect/01_basics/index.md:1-7`:

> Prefer `Effect.gen` for inline Effect code. For reusable functions, prefer `Effect.fn("name")` when tracing is useful and `Effect.fnUntraced` when it is not, particularly in library implementations and hot paths. **Avoid functions that only wrap and return `Effect.gen`.**

and `02_effect-fn.ts:11`: *"**Avoid creating functions that only wrap and return an `Effect.gen`**."*

Three things the rule and the source make unambiguous, each of which bounds where the hunch can be true:

1. **A constant cannot take arguments.** The forbidden shape is `const f = () => Effect.gen(...)`, and the blessed rewrite is `const f = Effect.gen(...)`. A function that *uses* its parameters (`(x) => Effect.gen(... using x)`) is a different case — the rule's own `Effect.fn` JSDoc (`Effect.ts:13450-13454`, `13548-13550`) routes it to `Effect.fn`/`Effect.fnUntraced`, *not* to a constant.

2. **The library itself has zero `=> Effect.gen(`.** Grepping `packages/*/src` (all packages) for `=> Effect.gen(` returns **0** matches; `packages/effect/src` uses `Effect.gen(function…` as a *constant* 935× (e.g. `http/HttpRouter.ts:125` `export const make = Effect.gen(function*() {`) and `Effect.fnUntraced(` 417× (traced `Effect.fn(` in library source: **1**). So the maintainers' own default is *constant when parameterless, `fn`/`fnUntraced` when parameterized* — never a bare arrow wrapping `gen`.

3. **Laziness is not a reason for the wrapper, so it's not a reason to remove it either.** `Effect.gen` *is* a `suspend`: `internal/effect.ts:1252-1258` returns `suspend(() => fromIteratorUnsafe(body()))`. A top-level `const p = Effect.gen(...)` runs no body work at import time, and `Effect.fn`/`fnUntraced` apply the same `suspend` per call (`internal/effect.ts:1261-1277`). So converting a function→constant is a **pure style change** with no eager-evaluation or stack-safety consequence; it buys one shared value and (for `Effect.fn`) drops a stack-frame boundary. It is cosmetic, not a correctness or performance fix.

Notably **not** in the repo (searched, absent — do not expect them): no "use `Effect.suspend` instead of a function returning an Effect" rule, no module-load-eagerness rule, no lint rule enforcing gen/fn shape (`oxlintrc.json` custom rules are unrelated), and `Effect.reusable` does not exist in V4. This is guidance + strong convention, not enforcement.

---

## The exemplar: `apiAppWith` (`server/apiApp.ts:59`) — correctly a function

```ts
export const apiAppWith = (runtime: AppRuntime) =>
  HttpRouter.provideRequest(Layer.effectContext(runtime.contextEffect))(apiApp);
```

This is the clearest place the hunch misfires, and it is worth being blunt about why:

- It returns a **`Layer`**, not an `Effect`. `Layer` has no `Effect.gen`/`Effect.fn` equivalent; you literally cannot write it as an `Effect.gen` constant. The closest laziness primitive is `Layer.suspend`, which the docs use only to defer *build*, not to remove builders.
- It is **parameterized** on `runtime`. A constant `const apiAppWith = …` would freeze the runtime at import time and make it impossible to build an app per language / per test, which is exactly what `main.ts`, `main.api.ts`, and the BDD steps do (`appLayerProd(runtime)`, one runtime per scenario).
- This is the **canonical V4 shape**. It matches the doc example written into this very repo at `server/api.ts:107-113`, and `HttpRouter.provideRequest` is itself defined as a curried data-last function returning a `Layer` (`http/HttpRouter.ts:1254-1266`). The library's layer helpers are functions when parameterized (`cluster/ShardingConfig.ts:235`, `DateTime.ts:2815`, `ai-docs/.../20_layer-unwrap.ts:31 static readonly layerRemote = (url: URL) => Layer.effect(…)`) and constants only when not (`cluster/RunnerHealth.ts:54 export const layerNoop = Layer.succeed(…)`).

**Verdict:** keep as-is. A side note that argues *against* per-call worry here: `provideRequest` resolves `runtime.contextEffect` **once per middleware scope**, not per request (`http/HttpRouter.ts:1263-1266` builds the context, then closes over `services`), and `ManagedRuntime.contextEffect` memoizes the build (`ManagedRuntime.ts:310-330`). So there is no repeated construction to defend against — but also nothing to convert.

The same reasoning disposes of the whole `layer*` family — `app.ts:39,63`, `pipeline.ts:52`, `reactRouterApp.ts:261,293`, `incrementer.ts:85`, `greeter.ts:50,118`, `features/greeting.steps.ts:91`. All are parameterized `Layer` builders; all are correct functions.

---

## Finding 1 (the real one) — `withViteDevServer`: a no-arg `Effect.fn` that wants to be a constant

`server/reactRouterApp.ts:214` — the single site that genuinely matches your hunch.

```ts
const withViteDevServer = Effect.fn("ReactRouter.viteDevServer")(function* () {
  // … createServer, addFinalizer …
});
```

It takes **zero parameters** and is called exactly once, as `yield* withViteDevServer()` (`reactRouterApp.ts:296`). That trailing `()` on a parameterless generator is the tell: `Effect.fn` with no args is functionally a lazy `Effect` you invoke like a function — a constant wearing a function's clothes. The rule ("prefer `Effect.gen` for inline Effect code") points at the constant form; the tracing you get from the name is preserved with `Effect.withSpan` (which is what `Effect.fn("name")` uses under the hood — `02_effect-fn.ts:16-17`).

```ts
const withViteDevServer = Effect.gen(function* () {
  const { createServer } = yield* Effect.tryPromise({ /* … */ });
  const vite = yield* Effect.tryPromise({ /* … */ });
  yield* Effect.addFinalizer(() => /* … */);
  return vite;
}).pipe(Effect.withSpan("ReactRouter.viteDevServer"));

// call site becomes:  const vite = yield* withViteDevServer;
```

This is exactly the `Effect.gen(...).pipe(...)` shape the basics doc demonstrates (`index.md` "Using Effect.gen" example). Trade-off to note: `Effect.fn` records a call stack-frame boundary; `gen + withSpan` keeps the span but drops that frame. For a one-shot dev-only boot the frame is not worth the fake "callable" surface — hence constant + span wins here. (Confidence: high on the shape match; the "drop the stack frame" consequence is my inference from `internal/effect.ts:1316-1363`, not a doc line.)

---

## Finding 2 (adjacent) — `startApp`: the inner arrow only wraps `gen` → `Effect.fnUntraced`

`server/pipeline.ts:81`

```ts
export const startApp = (port: number) => <E, R>(self: EffectApp<E, R>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(serveApp(port)(self));
    const address = Context.get(context, HttpServer.HttpServer).address;
    if (NetAddress.isInetAddress(address)) return address.port;
    return yield* Effect.die(`startApp expects an inet address, got ${address._tag}`);
  });
```

The inner `(self) => Effect.gen(...)` **is** a function that only wraps and returns `Effect.gen`. But it *uses* `self` (and closes over `port`), so per rule-note #1 this is **not** a gen-constant candidate — the rule routes it to `Effect.fn`/`Effect.fnUntraced`. It's a hot internal helper with no observability value, so `Effect.fnUntraced`:

```ts
export const startApp = (port: number) =>
  Effect.fnUntraced(function* <E, R>(self: EffectApp<E, R>) {
    const context = yield* Layer.build(serveApp(port)(self));
    const address = Context.get(context, HttpServer.HttpServer).address;
    if (NetAddress.isInetAddress(address)) return address.port;
    return yield* Effect.die(`startApp expects an inet address, got ${address._tag}`);
  });
```

This mirrors a real library precedent for an explicitly-signatured `Effect.fnUntraced` smart constructor: `cluster/Entity.ts:619-629` (`export const makeTestClient: <…>(…) => Effect.Effect<…> = Effect.fnUntraced(function*<…>(…)`). The outer `(port) =>` stays a plain function (it configures, doesn't run). *Applied note:* no explicit signature annotation was needed after all — the `function* <E, R>` generics propagate through `fnUntraced`'s `Args` inference here (verified by type-probe: the result keeps `<E, R>(self: EffectApp<E, R>) => Effect<number, ServeError | Without<E>, …>`), unlike `Entity.ts`, which annotates because its body's type params appear in nested returned Effects. The BDD suite pins the generic behavior end-to-end (the steps call `startApp(0)` with a concrete `layerProd(runtime)`). Low priority; behavior and types are identical either way.

---

## Finding 3 (gray zone — probably leave it) — `layerDev` inner callback

`server/reactRouterApp.ts:293`

```ts
export const layerDev = (runtime: AppRuntime) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const vite = yield* withViteDevServer();      // → `yield* withViteDevServer` after Finding 1
      yield* registerReactRouter(router, { mode: "development", vite }, runtime);
    }),
  );
```

Technically `(router) => Effect.gen(...)` is again an arrow wrapping `gen`, but `router` is used, and `HttpRouter.use` **wants** an inline `(router) => Effect` callback (`http/HttpRouter.ts:500-502` — its own doc example passes an inline arrow). Naming a `Effect.fnUntraced` helper here would add a symbol for a single-use inline thunk. I'd leave this as-is; the sibling `layerProd` (`:261`) already avoids `gen` entirely by delegating to `registerReactRouter`, so the file is consistent. Listing it only for completeness.

---

## Citizens already at the target idiom (the reason the hunch under-fires)

Worth naming, because these are what a codebase following the rule is *supposed* to look like — the hunch assumed they'd be arrow→gen and they aren't:

| Site | Shape | Status |
|------|-------|--------|
| `GreetingCard.controller.ts:33` `greetingCard` | `= Effect.gen(function* () {…})` | ✅ the exact target constant form |
| `Feedback.controller.ts:62` `reveal` | `= Effect.gen(…).pipe(Effect.catch(…))` | ✅ constant + combinator via `.pipe` (docs-blessed for constants) |
| `reactRouterApp.ts:82` `renderThrough` | `= Effect.fnUntraced(function* (handle, request) {…})` | ✅ parameterized internal → untraced |
| `api.ts:117` `health` handler | `Effect.fn("Api.health")(function* () {…})` | ✅ traced, name matches the handler |
| `reactRouterApp.ts:127,214` `registerReactRouter`, `withViteDevServer` | `Effect.fn("ReactRouter.*")` | ✅ traced (only `withViteDevServer`'s zero-arity is the Finding 1 nit) |
| `reactRouterApp.ts:195` render handler | `Effect.fn("ReactRouter.render")((request) => renderThrough(handle, request))` | ✅ `Effect.fn` for the span, body a plain composing arrow — matches `Users.ts:83` fixture idiom |
| all 9 `features/greeting.steps.ts` steps | `Effect.fn("Greeting.*")(function* …)` | ✅ traced step boundary; the correct home for spans |
| `features/greeting.steps.ts:77` `attempt` | `<A>(label, f) => Effect.tryPromise({…})` | ✅ smart-constructor arrow (no `gen`); mirrors `Layer.ts:562 forkMemoMap = (p) => sync(…)` |
| `incrementer.ts:106` `increment` service method | `(by = 1) => Queue.offer(…).pipe(…)` | ✅ plain arrow + `.pipe`, no generator needed — matches `fixtures/server/Users/http.ts:17-22`; `Effect.fnUntraced` optional, not required |

React components (`GreetingCard.view.tsx:26`, `Feedback.view.tsx:41`, `Feedback.connected.view.tsx:24`, `root.tsx`) and `Feedback.controller.ts:17,31` return JSX/values, not Effects — out of scope for this rule entirely.

---

## Summary table

| # | Site | Shape today | Verdict | Correct target |
|---|------|-------------|---------|----------------|
| — | `apiApp.ts:59` `apiAppWith` (**your exemplar**) | `(runtime) => Layer` | **Not a candidate** | stays a function (Layer builder, parameterized) |
| 1 | `reactRouterApp.ts:214` `withViteDevServer` | `Effect.fn(…)(function* () {…})`, 0 args | **True hit** | `Effect.gen(…).pipe(Effect.withSpan(…))` + call `yield*` (no `()`) |
| 2 | `pipeline.ts:81` `startApp` (inner) | `(self) => Effect.gen(…)` | **Real, but not a constant** | `Effect.fnUntraced(function* <E,R>(self) {…})` |
| 3 | `reactRouterApp.ts:293` `layerDev` (inner) | `(router) => Effect.gen(…)` | **Gray zone** | leave inline; `HttpRouter.use` wants a callback |
| — | `app.ts:39,63`, `pipeline.ts:52`, `reactRouterApp.ts:261`, `incrementer.ts:85`, `greeter.ts:50,118`, `steps.ts:91` | `(x) => Layer` | **Not candidates** | stay functions (Layer builders) |
| — | `greetingCard`, `reveal`, `renderThrough`, `Api.health`, `registerReactRouter`, render handlers, all BDD steps, `attempt`, `increment` | gen-constant / `Effect.fn` / `fnUntraced` / plain-composing arrow | **Already correct** | none |

**Bottom line:** your instinct encodes a real rule and a real library convention — but this codebase already follows it. The rule forbids *parameterless* arrows that wrap `gen`, and the only such function is `withViteDevServer` (Finding 1). Everything that *looks* like an "unnecessary function" is a `Layer` builder that must be a function, and the exemplar you selected is the clearest example of that. Realistic cleanup: **1 conversion to a constant, 1 (optional) to `Effect.fnUntraced`** — cosmetic, no behavior change.

## Caveats

- Effect source read at `rc.118` (local) vs `rc.117` installed; the cited APIs (`provideRequest`, `HttpRouter.use`, `gen`/`fn`/`fnUntraced` internals, `ManagedRuntime.contextEffect`) are stable across that patch drift as far as the source shows.
- "Converting function→constant is purely cosmetic" rests on `Effect.gen === suspend(...)` (`internal/effect.ts:1252-1258`), which I verified in source; the "drop the stack frame" consequence of Finding 1 is inference from the `fn` impl, not a doc line.
- Classifications are style guidance; there is no lint/CI rule in the Effect repo enforcing them, so frame these as preferences, with `Effect.fn` vs `fnUntraced` decided by whether the boundary deserves a span.
