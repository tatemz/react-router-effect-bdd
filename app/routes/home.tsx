import { data } from "react-router";
import type { Route } from "./+types/home";
import { appRuntimeContext } from "../../server/runtime.ts";
import { greetingCard } from "../components/GreetingCard/GreetingCard.controller.ts";
import { GreetingCard } from "../components/GreetingCard/GreetingCard.view.tsx";
import type { FeedbackViewModel } from "../components/Feedback/Feedback.model.ts";
import { reveal } from "../components/Feedback/Feedback.controller.ts";

/**
 * The home route's data: the greeting card, built by the same Effect program
 * the Next version ran in its server component.
 *
 * This is the run-promise boundary; `greetingCard` is the whole program, and
 * the app's `ManagedRuntime` (the composition root's `Greeter` and
 * `Incrementer`, carried by `server/reactRouterApp.ts` under
 * `appRuntimeContext`) is what it runs with. Reading the runtime outside
 * the app throws: rendering outside the app is a bug, not a supported mode.
 *
 * @example
 * // With the app serving (pnpm start), a plain GET carries the card:
 * //   curl -s http://localhost:3456/ | grep '<main id="message">'
 * //   # <main id="message">Hello!</main>
 */
export async function loader({ context }: Route.LoaderArgs) {
  return await context.get(appRuntimeContext).runPromise(greetingCard);
}

/**
 * The reveal action: the route mutation, replacing the Next version's
 * server action.
 *
 * The reveal needs nothing from the submitted form: the secret is a
 * function of the server's own state, not of client state, so the action
 * ignores the request body and runs the `reveal` program against the app's
 * runtime - reading the very `Incrementer` the loader's greeting bumped -
 * and answers with the revealed model.
 *
 * @example
 * // The hydrated view POSTs an (empty) form through a fetcher; the action
 * // answers with the revealed model regardless of what was submitted:
 * //   fetcher.submit(new FormData(), { method: "post", action })
 */
export async function action({ context }: Route.ActionArgs) {
  const next = await context.get(appRuntimeContext).runPromise(reveal);
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
