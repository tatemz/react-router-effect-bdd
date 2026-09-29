import { Schema } from "effect";

/**
 * The feedback sub-viewmodel: the secret is still hidden (show the reveal
 * form), it has been revealed (show the feedback message), or the reveal
 * failed (show the error). A tagged union, so "revealed without a message"
 * is unrepresentable and failure is a state the view must handle, not a
 * thrown exception.
 *
 * This model is also the connected view's state: it seeds it with the
 * server-rendered variant, and the reveal action returns the next variant,
 * so there is one state shape across render and interaction.
 *
 * @example
 * import { Schema } from "effect";
 * import { FeedbackViewModel } from "./Feedback.model.ts";
 *
 * FeedbackViewModel.decodeUnknownSync({ _tag: "NotRevealed" }); // { _tag: "NotRevealed" }
 * // FeedbackViewModel.decodeUnknownSync({ _tag: "Revealed" }); // throws: missing message
 */
export type FeedbackViewModel = typeof FeedbackViewModel.Type;
export const FeedbackViewModel = Schema.TaggedUnion({
  NotRevealed: {},
  Revealed: { message: Schema.NonEmptyString },
  Failed: { message: Schema.NonEmptyString },
});
