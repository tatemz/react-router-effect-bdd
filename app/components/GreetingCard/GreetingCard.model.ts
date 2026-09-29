import { Schema } from "effect";
import { FeedbackViewModel } from "../Feedback/Feedback.model.ts";

/**
 * How many greetings the counter has applied: a whole number that cannot
 * go backwards, so a negative count is unrepresentable in the viewmodel
 * rather than filtered at render time.
 */
const GreetingCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * The home page's greeting card viewmodel: the greeter's message, the
 * greeting count the `Incrementer` had applied at render time, and the
 * feedback sub-viewmodel it hosts. Building one requires all three, so a
 * page cannot render without stating which feedback state it starts in.
 *
 * The count is eventually consistent: the `Incrementer` applies increments
 * asynchronously, so a freshly accepted greeting may not be reflected yet.
 *
 * @example
 * import { GreetingCardViewModel } from "./GreetingCard.model.ts";
 *
 * GreetingCardViewModel.decodeUnknownSync({
 *   _tag: "GreetingCard",
 *   message: "Hello!",
 *   count: 3,
 *   feedback: { _tag: "NotRevealed" },
 * });
 * // GreetingCardViewModel.decodeUnknownSync({
 * //   _tag: "GreetingCard", message: "Hello!", count: -1, feedback: { _tag: "NotRevealed" },
 * // }); // throws: count must be >= 0
 */
export type GreetingCardViewModel = typeof GreetingCardViewModel.Type;
export const GreetingCardViewModel = Schema.TaggedStruct("GreetingCard", {
  message: Schema.NonEmptyString,
  count: GreetingCount,
  feedback: FeedbackViewModel,
});
