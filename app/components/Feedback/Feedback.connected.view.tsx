import { useCallback } from "react";
import { useFetcher, useFormAction } from "react-router";
import type { FeedbackViewModel } from "./Feedback.model.ts";
import { Feedback } from "./Feedback.view.tsx";

/**
 * Connects the feedback sub-viewmodel to the reveal route action.
 *
 * The model stays one state shape across server render and interaction:
 * it starts as the server-rendered variant, and every reveal replaces it
 * with whatever the action resolves with - the next `FeedbackViewModel`,
 * arriving as the fetcher's data (latest wins). The submit itself carries
 * nothing: the reveal is a function of the server's own state, so there is
 * no model round-trip.
 *
 * `useFormAction` resolves the submit URL the same way `<Form>` would,
 * which for this index route means `/?index`: React Router requires the
 * `?index` marker to target an index route with a mutation.
 *
 * @example
 * // From the route component, with the encoded sub-viewmodel:
 * <ConnectedFeedback {...model.feedback} />
 */
export const ConnectedFeedback = (model: FeedbackViewModel) => {
  const fetcher = useFetcher<FeedbackViewModel>();
  const action = useFormAction();
  const dispatch = useCallback(
    () => fetcher.submit(new FormData(), { method: "post", action }),
    [fetcher, action],
  );
  return (
    <Feedback
      {...(fetcher.data ?? model)}
      dispatch={dispatch}
      isPending={fetcher.state !== "idle"}
    />
  );
};
