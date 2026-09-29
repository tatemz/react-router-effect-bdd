import { Effect } from "effect";
import { Greeter } from "../../../domain/greeter.ts";
import { Incrementer } from "../../../domain/incrementer.ts";
import { GreetingCardViewModel } from "./GreetingCard.model.ts";

/**
 * Builds the greeting card's initial viewmodel from the request's `Greeter`
 * and `Incrementer`.
 *
 * The count is read after this render's own `greet`, with one `yieldNow` so
 * the counter's worker fiber gets a turn to apply it before the read; the
 * `Incrementer` is eventually consistent, so under concurrent traffic the
 * count may still lag the accepted greetings, and it never decreases. The
 * interaction after this first render belongs to the
 * feedback sub-view's route action, so the card always starts in the
 * `NotRevealed` state; the still-typed `makeEffect` keeps validation visible
 * in the error channel.
 *
 * @example
 * import { Effect, Layer } from "effect";
 * import { Greeter } from "../../../domain/greeter.ts";
 * import { Incrementer } from "../../../domain/incrementer.ts";
 * import { greetingCard } from "./GreetingCard.controller.ts";
 *
 * // provideMerge, so the controller reads the very counter the greeter bumps.
 * const model = Effect.runSync(
 *   Effect.provide(
 *     greetingCard,
 *     Layer.provideMerge(Greeter.layerEnglish, Incrementer.greetingCountLayer),
 *   ),
 * ); // GreetingCardViewModel
 */
export const greetingCard = Effect.gen(function* () {
  const greeter = yield* Greeter;
  const greetingCount = yield* Incrementer;
  const message = yield* greeter.greet;
  // Let the counter's worker fiber apply this render's increment before
  // reading, so the card normally shows its own greeting's number.
  yield* Effect.yieldNow;
  const count = yield* greetingCount.value;
  return yield* GreetingCardViewModel.makeEffect({
    message,
    count,
    feedback: { _tag: "NotRevealed" },
  });
});
