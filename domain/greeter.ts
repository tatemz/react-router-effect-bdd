import { Context, Effect, Layer, Match } from "effect";
import { Language } from "../server/config.ts";
import { Incrementer } from "./incrementer.ts";

/**
 * Greets a visitor in one language, counting the greetings.
 *
 * A `Context.Service` with a single `greet` effect, so pages and routes
 * depend on the capability rather than on which language implementation is
 * installed; pick an implementation with `Greeter.layerFor`. Every `greet`
 * increments the `Incrementer` it is given (eventually consistent: the
 * count converges to the number of greetings).
 *
 * @example
 * import { Effect, Layer } from "effect";
 * import { Greeter } from "./greeter.ts";
 * import { Incrementer } from "./incrementer.ts";
 *
 * const greeting = Effect.gen(function* () {
 *   const greeter = yield* Greeter;
 *   return yield* greeter.greet;
 * });
 *
 * Effect.runSync(
 *   Effect.provide(
 *     greeting,
 *     Layer.provide(Greeter.layerSpanish, Incrementer.greetingCountLayer),
 *   ),
 * ); // "¡Hola!"
 */
export class Greeter extends Context.Service<
  Greeter,
  {
    readonly greet: Effect.Effect<string>;
  }
>()("Greeter") {
  /**
   * A `Greeter` that greets with `message` and bumps its `Incrementer` on
   * every greeting.
   *
   * The `Incrementer` requirement stays open on purpose: whoever composes
   * the app owns the counter's lifetime and identity.
   *
   * @example
   * import { Greeter } from "./greeter.ts";
   *
   * // Inside Greeter, the public layers are just this preset applied:
   * const layerEnglish = Greeter.layerGreeting("Hello!");
   */
  private static readonly layerGreeting = (message: string) =>
    Layer.effect(
      Greeter,
      Effect.gen(function* () {
        const greetingCount = yield* Incrementer;
        return Greeter.of({
          greet: Effect.as(greetingCount.increment(), message),
        });
      }),
    );

  /**
   * The English `Greeter`, greeting with "Hello!".
   *
   * The implementation `Greeter.layerFor(Language.English)` returns; it still requires
   * an `Incrementer`, which the composition root provides with
   * `Incrementer.greetingCountLayer`.
   *
   * @example
   * import { Effect, Layer } from "effect";
   * import { Greeter } from "./greeter.ts";
   * import { Incrementer } from "./incrementer.ts";
   *
   * const greeting = Effect.flatMap(Greeter, (greeter) => greeter.greet);
   * Effect.runSync(
   *   Effect.provide(
   *     greeting,
   *     Layer.provide(Greeter.layerEnglish, Incrementer.greetingCountLayer),
   *   ),
   * ); // "Hello!"
   */
  static readonly layerEnglish = Greeter.layerGreeting("Hello!");

  /**
   * The Spanish `Greeter`, greeting with "¡Hola!".
   *
   * The implementation `Greeter.layerFor(Language.Spanish)` returns; it still requires
   * an `Incrementer`, which the composition root provides with
   * `Incrementer.greetingCountLayer`.
   *
   * @example
   * import { Effect, Layer } from "effect";
   * import { Greeter } from "./greeter.ts";
   * import { Incrementer } from "./incrementer.ts";
   *
   * const greeting = Effect.flatMap(Greeter, (greeter) => greeter.greet);
   * Effect.runSync(
   *   Effect.provide(
   *     greeting,
   *     Layer.provide(Greeter.layerSpanish, Incrementer.greetingCountLayer),
   *   ),
   * ); // "¡Hola!"
   */
  static readonly layerSpanish = Greeter.layerGreeting("¡Hola!");

  /**
   * Total mapping from the `Language` enum to an implementation layer.
   *
   * Matched exhaustively over `Language`, so adding an enum member is a
   * compile error until a layer exists for it. The returned layer still
   * requires an `Incrementer`.
   *
   * @example
   * import { Greeter } from "./greeter.ts";
   * import { Language } from "../server/config.ts";
   *
   * const spanish = Greeter.layerFor(Language.Spanish); // Layer.Layer<Greeter, never, Incrementer>
   */
  static layerFor(language: Language): Layer.Layer<Greeter, never, Incrementer> {
    return Match.value(language).pipe(
      Match.when(Language.English, () => Greeter.layerEnglish),
      Match.when(Language.Spanish, () => Greeter.layerSpanish),
      Match.exhaustive,
    );
  }
}
