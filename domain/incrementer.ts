import { Context, Effect, Layer, Metric, Queue } from "effect";

/**
 * A counter driven by asynchronous increment commands.
 *
 * `increment` enqueues a command and returns immediately; a background fiber
 * drains the queue and applies each command to an incremental `Metric.Counter`
 * held in the service's own `Metric.MetricRegistry`. `value` reads that
 * counter, so it is *eventually consistent*: right after an `increment` the
 * reported count may still lag the accepted commands, but it converges to
 * their total.
 *
 * The counter is `incremental: true`, so the state can never decrease; the
 * monotonicity invariant is enforced by the metric, not by scattered checks.
 *
 * @example
 * import { Effect, Layer } from "effect";
 * import { Incrementer } from "./incrementer.ts";
 *
 * const program = Effect.gen(function* () {
 *   const incrementer = yield* Incrementer;
 *   yield* incrementer.increment(); // accepted, applied asynchronously
 *   yield* incrementer.increment(4);
 *   // Eventually consistent: yield until the worker has applied both.
 *   let count = yield* incrementer.value;
 *   while (count !== 5) {
 *     yield* Effect.yieldNow;
 *     count = yield* incrementer.value;
 *   }
 *   return count;
 * });
 *
 * const count = await Effect.runPromise(
 *   Effect.provide(program, Incrementer.layer("greeting-count")),
 * );
 * // count === 5
 */
export class Incrementer extends Context.Service<
  Incrementer,
  {
    /**
     * Enqueue an increment of `by` (default `1`).
     *
     * Returns as soon as the command is accepted; the background worker
     * applies it later, so `value` may lag this call for a moment.
     *
     * @example
     * import { Incrementer } from "./incrementer.ts";
     *
     * const incrementer = yield* Incrementer;
     * yield* incrementer.increment(); // accepted +1, applied asynchronously
     * yield* incrementer.increment(4); // accepted +4
     */
    readonly increment: (by?: number) => Effect.Effect<void>;
    /**
     * The last applied count.
     *
     * Eventually consistent: it may lag the accepted `increment` commands,
     * but it never decreases.
     *
     * @example
     * import { Incrementer } from "./incrementer.ts";
     *
     * const incrementer = yield* Incrementer;
     * const count = yield* incrementer.value; // e.g. 5
     */
    readonly value: Effect.Effect<number>;
  }
>()("Incrementer") {
  /**
   * The live `Incrementer` for a named counter: an unbounded command queue,
   * one worker fiber applying commands to the counter, and a private
   * `MetricRegistry` so the count cannot collide with metrics registered
   * elsewhere.
   *
   * The worker fiber is scoped to the layer; closing the layer's scope shuts
   * the queue down, after which `increment` dies rather than silently
   * dropping the command.
   *
   * @example
   * import { Incrementer } from "./incrementer.ts";
   *
   * const greetingCounter = Incrementer.layer("greeting-count");
   */
  static readonly layer = (counterName: string) =>
    Layer.effect(
      Incrementer,
      Effect.gen(function* () {
        const commands = yield* Queue.unbounded<number>();
        const registry: Metric.MetricRegistry = new Map();
        const counter = Metric.counter(counterName, {
          description: `Total applied increments (${counterName})`,
          incremental: true,
        });

        const worker = Effect.forever(
          Queue.take(commands).pipe(
            Effect.flatMap((by) => Metric.update(counter, by)),
          ),
        );
        yield* Effect.provideService(worker, Metric.MetricRegistry, registry).pipe(
          Effect.forkScoped,
        );

        return Incrementer.of({
          increment: (by = 1) =>
            Queue.offer(commands, by).pipe(
              Effect.flatMap((accepted) =>
                accepted
                  ? Effect.void
                  : Effect.die("Incrementer is shut down"),
              ),
            ),
          value: Effect.provideService(
            Effect.map(Metric.value(counter), (state) => state.count),
            Metric.MetricRegistry,
            registry,
          ),
        });
      }),
    );

  /**
   * The `"greeting-count"` counter: one `greet`, one increment.
   *
   * Named here so the counter's identity belongs to the counting domain,
   * not to whichever feature happens to be counted. Composition roots
   * provide this layer at the top of the call stack
   * (`Layer.provide(greeterLayer, Incrementer.greetingCountLayer)`), which
   * keeps the wiring visible at the composition and lets a test swap in its
   * own counter.
   *
   * @example
   * import { Incrementer } from "./incrementer.ts";
   *
   * const counter = Incrementer.greetingCountLayer; // Layer.Layer<Incrementer>
   */
  static readonly greetingCountLayer = Incrementer.layer("greeting-count");
}
