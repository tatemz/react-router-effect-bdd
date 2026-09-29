import { Bdd } from "effect-bdd";
import { Effect, Layer, Logger, References, Schema } from "effect";
import { chromium } from "playwright";
// The steps touch `document` only through `page.waitForFunction`, which
// serializes the function to the browser; tsconfig's "dom" lib types it.
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
} from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Greeter } from "../domain/greeter.ts";
import { Incrementer } from "../domain/incrementer.ts";
import { Api } from "../server/api.ts";
import { layerProd as appLayerProd } from "../server/app.ts";
import { Language, LanguageSchema } from "../server/config.ts";
import { startApp } from "../server/pipeline.ts";

/**
 * Captures a language name from a step, validated by the `Language` schema.
 *
 * A step like `the app is using the es greeter` binds `language` to `"es"`;
 * any other language fails the step at parse time, not deeper in the run.
 *
 * @example
 * // Matches: "the app is using the en greeter" -> { language: Language.English }
 * // Bdd.given`the app is using the ${language} greeter`(step);
 */
const language = Bdd.capture("language", LanguageSchema);
/**
 * Captures an expected health status string from a step.
 *
 * @example
 * // Matches: "the health check says status ok and greeting Hello!"
 * // -> { status: "ok", greeting: "Hello!" }
 * // Bdd.then`the health check says status ${status} and greeting ${greeting}`(step);
 */
const status = Bdd.capture("status", Schema.String);
/**
 * Captures an expected greeting string from a step.
 *
 * @example
 * // Matches: "the health check says status ok and greeting ¡Hola!"
 * // -> { greeting: "¡Hola!" }
 * // Bdd.then`the health check says status ${status} and greeting ${greeting}`(step);
 */
const greeting = Bdd.capture("greeting", Schema.String);
/**
 * Captures an arbitrary expected string from a step.
 *
 * @example
 * // Matches: "the home page says Hello!" -> { expected: "Hello!" }
 * // Bdd.then`the home page says ${expected}`(step);
 */
const expected = Bdd.capture("expected", Schema.String);
/**
 * Captures a greeting count from a step, parsed from its digits.
 *
 * `FiniteFromString` turns the captured text into a number, so the step can
 * compare it numerically against the reveal's reported count.
 *
 * @example
 * // Matches: "the reveal reports greeting 2" -> { greetingNumber: 2 }
 * // Bdd.then`the reveal reports greeting ${greetingNumber}`(step);
 */
const greetingNumber = Bdd.capture("greetingNumber", Schema.FiniteFromString);

/**
 * Runs a Playwright promise-returning call as an Effect, naming the call in
 * the failure so a browser timeout says which interaction timed out.
 *
 * @example
 * // A failed navigation fails with "open the home page: <reason>",
 * // not an anonymous rejected promise:
 * // yield* attempt("open the home page", () => page.goto(url));
 */
const attempt = <A>(label: string, f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (cause) =>
      `${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/**
 * The greeter a scenario composes: the chosen `Greeter` merged with the
 * `greeting-count` `Incrementer` page renders read.
 *
 * @example
 * const greeter = greeterFor(Language.English); // Greeter + Incrementer, ready to provide
 */
const greeterFor = (language: Language) =>
  Layer.provideMerge(
    Greeter.layerFor(language),
    Incrementer.greetingCountLayer,
  );

/**
 * Keeps logging to warnings and above for the scenarios: the standard
 * default logger stays in place, while `MinimumLogLevel` filters out the
 * server's debug/info HTTP span logs (the canonical level-filter pattern,
 * so a real warning or error still reaches the BDD report).
 *
 * @example
 * Bdd.provide(warnLog)
 */
const warnLog = Logger.layer([Logger.defaultLogger]).pipe(
  Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, "Warn")),
);

/**
 * The shared first `Given`: the greeter language the app serves, recorded
 * as data; the shared `When` composes the fresh `Greeter` merged with the
 * `greeting-count` `Incrementer` page renders read.
 *
 * @example
 * // "the app is using the es greeter" -> { language: Language.Spanish }
 */
const givenGreeterForLanguage = Bdd.given`the app is using the ${language} greeter`(
  Effect.fn("Greeting.appWithGreeter")(
    function* ({ language }: { readonly language: Language }) {
      return { language };
    },
  ),
);

/**
 * The shared `When`: start the scenario's app on an ephemeral port.
 *
 * Composes the real app here (`server/app.ts`'s own primitives);
 * `startApp(0)` binds a free port, and the server lives until the
 * scenario's scope closes.
 *
 * @example
 * // After the Given, the state gains { url, api } for the later steps.
 */
const whenAppIsRunning = Bdd.when`the app is running`(
  Effect.fn("Greeting.appIsRunning")(function* (state: { readonly language: Language }) {
    const port = yield* appLayerProd.pipe(
      HttpRouter.provideRequest(greeterFor(state.language)),
      startApp(0),
    );

    const url = `http://localhost:${port}`;
    const api = yield* HttpApiClient.make(Api, { baseUrl: url });

    return {
      ...state,
      url,
      api,
    };
  }),
);

/**
 * The app's Gherkin feature: the scenarios that pin the POC's observable
 * behavior end to end.
 *
 * Each scenario starts the real app on an ephemeral port (production
 * in-process via `startApp(0)` - see {@link whenAppIsRunning}), and asserts
 * over HTTP, the typed `Api` client, or a real Chromium page. Scenarios are
 * independent: every one gets its own app, counter, and (where used)
 * browser.
 *
 * @example
 * // Run the whole feature from the terminal (`pretest-bdd` builds first):
 * //   pnpm test-bdd
 * // Steps live in this file; the prose lives in features/greeting.feature.
 */
export const greetingVisitors = Bdd.feature("Greeting visitors").pipe(
  Bdd.scenario("The home page greets in the chosen language").pipe(
    givenGreeterForLanguage,
    whenAppIsRunning,
    Bdd.then`the home page says ${expected}`(
      Effect.fn("Greeting.homePageSays")(function* ({ expected }, state) {
        const body = yield* HttpClient.get(`${state.url}/`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.text),
        );

        if (!body.includes(`<main id="message">${expected}</main>`)) {
          return yield* Effect.fail(
            `home page at ${state.url} did not say ${expected}`,
          );
        }

        return state;
      }),
    ),
    Bdd.provide(FetchHttpClient.layer),
    Bdd.provide(warnLog),
  ),
  Bdd.scenario("The health check reports the configured greeter").pipe(
    givenGreeterForLanguage,
    whenAppIsRunning,
    Bdd.then`the health check says status ${status} and greeting ${greeting}`(
      Effect.fn("Greeting.healthCheckSays")(function* ({ greeting, status }, state) {
        // Fully typed: `health()` takes no arguments and resolves to the
        // server's `HealthResponse`, so a wrong field or status tag would be
        // a compile error, and a wrong wire shape a Schema error.
        const health = yield* state.api.health();

        if (health.status !== status) {
          return yield* Effect.fail(
            `health status was ${health.status}, expected ${status}`,
          );
        }

        if (health.greeting !== greeting) {
          return yield* Effect.fail(
            `health greeting was ${health.greeting}, expected ${greeting}`,
          );
        }

        return state;
      }),
    ),
    Bdd.provide(FetchHttpClient.layer),
    Bdd.provide(warnLog),
  ),
  Bdd.scenario("The docs endpoint describes the API").pipe(
    givenGreeterForLanguage,
    whenAppIsRunning,
    Bdd.then`the swagger docs and openapi document are served`(
      Effect.fn("Greeting.docsAreServed")(function* (state) {
        const docs = yield* HttpClient.get(`${state.url}/docs`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.text),
        );

        if (!docs.includes("swagger-ui")) {
          return yield* Effect.fail(
            `${state.url}/docs is not the Swagger UI`,
          );
        }

        const openapiResponse = yield* HttpClient.get(
          `${state.url}/openapi.json`,
        ).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.json),
        );
        const openapi = openapiResponse as {
          paths?: Record<string, unknown>;
        };

        if (openapi.paths?.["/health"] === undefined) {
          return yield* Effect.fail(
            "the openapi document does not describe /health",
          );
        }

        return state;
      }),
    ),
    Bdd.provide(FetchHttpClient.layer),
    Bdd.provide(warnLog),
  ),
  Bdd.scenario("The reveal counts the page view and the health check").pipe(
    givenGreeterForLanguage,
    whenAppIsRunning,
    Bdd.when`a browser opens the home page`(
      Effect.fn("Greeting.browserOpensHomePage")(function* (state) {
        // The Scenario Resources pattern from the effect-bdd docs: acquire
        // Chromium inside the step, so scenario-scope finalizers run LIFO -
        // browser first, then the React Router server. Acquiring it earlier (via
        // `Bdd.provide`) would tear the server down while the page still
        // holds a live connection to it.
        const { browser, page } = yield* Effect.acquireRelease(
          Effect.gen(function* () {
            const browser = yield* attempt("launch chromium", () =>
              chromium.launch(),
            );
            const page = yield* attempt("open a page", () => browser.newPage());
            return { browser, page };
          }),
          ({ browser }) =>
            Effect.tryPromise(() => browser.close()).pipe(Effect.ignore),
        );
        yield* attempt("open the home page", () => page.goto(`${state.url}/`));
        // The page render's own greeting is one of the two this reveal will
        // count, and the reveal only works through React: before hydration
        // the SSR'd form would take the native form POST, not the server
        // action. React attaches `__reactFiber$…` expando props when it
        // hydrates a DOM node, so that presence is the hydration signal.
        yield* attempt("wait for the reveal form to hydrate", () =>
          page.waitForFunction(() => {
            const form = document.querySelector("form");
            return (
              form !== null &&
              Object.getOwnPropertyNames(form).some((key) =>
                key.startsWith("__reactFiber$"),
              )
            );
          }),
        );
        return { ...state, page };
      }),
    ),
    Bdd.when`the health endpoint is hit`(
      Effect.fn("Greeting.healthEndpointHit")(function* (state) {
        // The typed client greets through the same per-app Greeter and
        // Incrementer the page render used, advancing the shared counter.
        yield* state.api.health();
        return state;
      }),
    ),
    Bdd.when`the reveal button is clicked`(
      Effect.fn("Greeting.revealButtonClicked")(function* (state) {
        yield* attempt("click the reveal button", () =>
          state.page.getByRole("button", { name: "Reveal me!" }).click(),
        );
        return state;
      }),
    ),
    Bdd.then`the reveal reports greeting ${greetingNumber}`(
      Effect.fn("Greeting.revealReportsGreeting")(function* (
        { greetingNumber: count },
        state,
      ) {
        const reveal = state.page
          .locator("p", { hasText: "at greeting #" })
          .first();
        yield* attempt("wait for the reveal to render", () => reveal.waitFor());
        const text = yield* attempt("read the reveal", () =>
          reveal.textContent(),
        );
        const expectedText = `at greeting #${count}.`;

        if (text === null || !text.includes(expectedText)) {
          return yield* Effect.fail(
            `the reveal said "${text ?? "nothing"}", expected it to report greeting #${count}`,
          );
        }

        return state;
      }),
    ),
    Bdd.provide(FetchHttpClient.layer),
    Bdd.provide(warnLog),
  ),
);
