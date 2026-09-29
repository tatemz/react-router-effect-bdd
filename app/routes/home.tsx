import { data } from "react-router";
import { Effect } from "effect";
import type { Route } from "./+types/home";
import { appDepsContext } from "../../server/deps.ts";
import { greetingCard } from "../components/GreetingCard/GreetingCard.controller.ts";
import { GreetingCard } from "../components/GreetingCard/GreetingCard.view.tsx";
import type { FeedbackViewModel } from "../components/Feedback/Feedback.model.ts";
import { revealFromClient } from "../components/Feedback/Feedback.controller.ts";

/**
 * The home route's data: the greeting card, built by the same Effect program
 * the Next version ran in its server component.
 *
 * This is the run-promise boundary; `greetingCard` is the whole program, and
 * the request's Effect context (the composition root's `Greeter` and
 * `Incrementer`, carried by `server/reactRouter.ts` under `appDepsContext`)
 * is what it runs with. Reading the context outside the pipeline throws:
 * rendering outside the pipeline is a bug, not a supported mode.
 *
 * @example
 * // With the app serving (pnpm start), a plain GET carries the card:
 * //   curl -s http://localhost:3456/ | grep '<main id="message">'
 * //   # <main id="message">Hello!</main>
 */
export async function loader({ context }: Route.LoaderArgs) {
  return await Effect.runPromiseWith(context.get(appDepsContext))(
    greetingCard,
  );
}

/**
 * The reveal action: the route mutation, replacing the Next version's
 * server action.
 *
 * Receives the previous `FeedbackViewModel` round-tripped through the form
 * (the connected view serializes it to JSON under `model`), runs the same
 * `revealFromClient` program against the request's context - so the reveal
 * reads the very `Incrementer` the loader's greeting bumped - and answers
 * with the next model. The program is total: failures arrive as the `Failed`
 * view model, never as a thrown action.
 *
 * @example
 * // The connected view submits the current model as JSON under `model`;
 * // the action answers with the next one:
 * //   fetcher.submit(formData, { method: "post" })
 */
export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const raw = formData.get("model");
  let prev: unknown = raw;
  if (typeof raw === "string") {
    try {
      prev = JSON.parse(raw) as unknown;
    } catch {
      // Leave it as the raw string; revealFromClient's decode reports it
      // as the Failed view model.
    }
  }
  const next = await Effect.runPromiseWith(context.get(appDepsContext))(
    revealFromClient(prev),
  );
  return data(next);
}

/**
 * Skip loader revalidation after the reveal action.
 *
 * A default revalidation would re-run `loader`, greeting again for a submit
 * that asked for no new page data - and the greeting count is observable in
 * the card's own counter. The reveal carries its state in the action's
 * response, so the loader's data stays valid.
 *
 * @example
 * // POST / (the reveal) leaves loaderData - and the counter - untouched.
 */
export function shouldRevalidate() {
  return false;
}

/**
 * The home page: the greeting-card viewmodel rendered with SSR, hydrated
 * for the reveal.
 *
 * `actionData` (a no-JS full-document reveal submit) takes precedence over
 * the loader's initial `NotRevealed` feedback; hydrated submits are handled
 * by the client fetcher and never reach this component as `actionData`.
 *
 * @example
 * // GET / renders <main id="message">Hello!</main> plus "Greeting #1".
 */
export default function Home({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const feedback: FeedbackViewModel =
    actionData !== null &&
    actionData !== undefined &&
    typeof actionData === "object" &&
    "_tag" in (actionData as object)
      ? (actionData as FeedbackViewModel)
      : loaderData.feedback;
  return <GreetingCard {...loaderData} feedback={feedback} />;
}
