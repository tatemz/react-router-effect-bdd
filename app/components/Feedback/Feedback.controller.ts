import { Effect, Match, SchemaIssue, SchemaParser } from "effect";
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

/**
 * The reveal effect: the next `FeedbackViewModel` for the current one.
 *
 * Matched exhaustively on the union, so every transition is explicit:
 * `NotRevealed` reveals; an already-`Revealed` state is returned unchanged,
 * making repeated submits idempotent; `Failed` retries the reveal, so the
 * error state's "Try again" resolves in one submit. Only the reveal paths
 * read the `Incrementer` — the idempotent path answers from the state it
 * was given. The count is eventually consistent, so it may lag the accepted
 * greetings; it never decreases.
 *
 * @example
 * import { Effect, Layer } from "effect";
 * import { Incrementer } from "../../../domain/incrementer.ts";
 * import { revealFeedback } from "./Feedback.controller.ts";
 *
 * const next = Effect.runSync(
 *   Effect.provide(
 *     revealFeedback({ _tag: "NotRevealed" }),
 *     Layer.succeed(Incrementer, Incrementer.of({
 *       increment: () => Effect.void,
 *       value: Effect.succeed(7),
 *     })),
 *   ),
 * ); // { _tag: "Revealed", message: "The secret: … at greeting #7." }
 */
export const revealFeedback = (
  prev: FeedbackViewModel,
): Effect.Effect<FeedbackViewModel, SchemaIssue.Issue, Incrementer> =>
  Match.value(prev).pipe(
    Match.tag("Revealed", (revealed) => Effect.succeed(revealed)),
    Match.tag(
      "NotRevealed",
      "Failed",
      () =>
        Effect.gen(function* () {
          const greetingCount = yield* Incrementer;
          yield* Effect.yieldNow;
          const count = yield* greetingCount.value;
          return yield* FeedbackViewModel.makeEffect({
            _tag: "Revealed",
            message: revealedMessage(count),
          });
        }),
    ),
    Match.exhaustive,
  );

const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * The failure view model for a schema issue: the formatted issue becomes the
 * `Failed` message. The `||` fallback makes the `NonEmptyString` invariant
 * unbreakable, so `make` here cannot throw.
 *
 * @example
 * // Inside revealFromClient's failure path, for a decode failure:
 * // failedFromIssue(issue); // { _tag: "Failed", message: <formatted issue> }
 */
const failedFromIssue = (issue: SchemaIssue.Issue): FeedbackViewModel =>
  FeedbackViewModel.make({
    _tag: "Failed",
    message: formatIssue(issue) || "The reveal failed.",
  });

/**
 * The reveal program: the next `FeedbackViewModel` for whatever a client
 * sent back, always total — failure is carried as the `Failed` variant, so
 * callers always receive a renderable view model.
 *
 * Like `greetingCard`, this is the whole effect; the route action is just
 * the run-promise boundary, which supplies the current request's context so
 * the reveal reads the same `Incrementer` the loader's greeting bumped. Decoding
 * re-validates the previous state because a client can send anything;
 * encoding hands the client plain data. Schema failures on either side are
 * the only thing `Failed` can report, alongside anything `revealFeedback`
 * puts in the error channel.
 *
 * @example
 * import { Context, Effect } from "effect";
 * import { Incrementer } from "../../../domain/incrementer.ts";
 * import type { AppDeps } from "../../../server/deps.ts";
 * import { revealFromClient } from "./Feedback.controller.ts";
 *
 * const context: Context.Context<AppDeps> = Context.make(
 *   Incrementer,
 *   Incrementer.of({ increment: () => Effect.void, value: Effect.succeed(7) }),
 * );
 * const next = Effect.runSync(
 *   Effect.provide(revealFromClient({ _tag: "NotRevealed" }), context),
 * ); // { _tag: "Revealed", message: "The secret: … at greeting #7." }
 */
export const revealFromClient = (clientState: unknown) =>
  Effect.gen(function* () {
    const prev = yield* SchemaParser.decodeUnknownEffect(FeedbackViewModel)(clientState);
    const next = yield* revealFeedback(prev);
    return yield* FeedbackViewModel.makeEffect(next);
  }).pipe(
    Effect.catch((issue) => Effect.succeed(failedFromIssue(issue))),
  );
