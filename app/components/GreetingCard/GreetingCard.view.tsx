import { GreetingCardViewModel } from "./GreetingCard.model.ts";
import styles from "./GreetingCard.module.css";
import { ConnectedFeedback } from "../Feedback/Feedback.connected.view.tsx";

/**
 * The presentational greeting card: kicker, the BDD-pinned greeting, the
 * greeting count from the `Incrementer`, the feedback sub-view, and the
 * caption.
 *
 * The BDD scenario pins the exact markup `<main id="message">…</main>`, so
 * `main` stays attribute-free (the module styles it via `.page main`).
 *
 * @example
 * import { GreetingCardViewModel } from "./GreetingCard.model.ts";
 * import { GreetingCard } from "./GreetingCard.view.tsx";
 *
 * const model: GreetingCardViewModel = {
 *   _tag: "GreetingCard",
 *   message: "Hello!",
 *   count: 1,
 *   feedback: { _tag: "NotRevealed" },
 * };
 * // <GreetingCard {...model} /> renders <main id="message">Hello!</main>
 * // and a "Greeting #1" counter above the reveal form.
 */
export const GreetingCard = (model: GreetingCardViewModel) => (
  <div className={styles.page}>
    <section className={styles.card}>
      <p className={styles.kicker}>Effect × React Router</p>
      <main id="message">{model.message}</main>
      <p className={styles.counter}>Greeting #{model.count}</p>
      <ConnectedFeedback {...model.feedback} />
      <p className={styles.caption}>
        Server-rendered by a <code>Greeter</code> service resolved from the request's
        Effect context.
      </p>
    </section>
  </div>
);
