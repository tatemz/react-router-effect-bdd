import { Effect, SchemaIssue } from "effect";
import { Incrementer } from "../../../domain/incrementer.ts";
import { FeedbackViewModel } from "./Feedback.model.ts";

/**
 * The secret the reveal hands out, told with the greeting count it was
 * revealed at. A function of the count so the revealed state has a single
 * source of truth for its wording; the count itself comes from the request's
 * `Incrementer`.
 *
 * @example
 * import { revealedMessage } from "./Feedback.controller.ts";
 *
 * revealedMessage(7);
 * // "The secret: this model round-tripped through a route action at greeting #7."
 */
export const revealedMessage = (count: number) =>
  `The secret: this model round-tripped through a route action at greeting #${count}.`;

const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * The failure view model for a schema issue: the formatted issue becomes the
 * `Failed` message. The `||` fallback makes the `NonEmptyString` invariant
 * unbreakable, so `make` here cannot throw.
 *
 * @example
 * // Inside reveal's failure path, for an encode failure:
 * // failedFromIssue(issue); // { _tag: "Failed", message: <formatted issue> }
 */
const failedFromIssue = (issue: SchemaIssue.Issue): FeedbackViewModel =>
  FeedbackViewModel.make({
    _tag: "Failed",
    message: formatIssue(issue) || "The reveal failed.",
  });

/**
 * The reveal program: the `Revealed` view model for the current greeting
 * count, always total — a schema failure is carried as the `Failed`
 * variant, so callers always receive a renderable view model.
 *
 * The reveal reads no client state: the secret is a function of the
 * server's own `Incrementer`, which is why the route action needs nothing
 * from the submitted form. Like `greetingCard`, this is the whole effect;
 * the route action is just the run-promise boundary, which supplies the
 * current request's context so the reveal reads the same `Incrementer` the
 * loader's greeting bumped. The count is eventually consistent, so it may
 * lag the accepted greetings; it never decreases.
 *
 * @example
 * import { Context, Effect } from "effect";
 * import { Incrementer } from "../../../domain/incrementer.ts";
 * import type { AppDeps } from "../../../server/deps.ts";
 * import { reveal } from "./Feedback.controller.ts";
 *
 * const context: Context.Context<AppDeps> = Context.make(
 *   Incrementer,
 *   Incrementer.of({ increment: () => Effect.void, value: Effect.succeed(7) }),
 * );
 * const next = Effect.runSync(Effect.provide(reveal, context));
 * // { _tag: "Revealed", message: "The secret: … at greeting #7." }
 */
export const reveal: Effect.Effect<
  FeedbackViewModel,
  never,
  Incrementer
> = Effect.gen(function* () {
  const greetingCount = yield* Incrementer;
  yield* Effect.yieldNow;
  const count = yield* greetingCount.value;
  return yield* FeedbackViewModel.makeEffect({
    _tag: "Revealed",
    message: revealedMessage(count),
  });
}).pipe(Effect.catch((issue) => Effect.succeed(failedFromIssue(issue))));
