import { useCallback, useState } from "react";
import { useFetcher, useFormAction } from "react-router";
import type { FeedbackViewModel } from "./Feedback.model.ts";
import { Feedback } from "./Feedback.view.tsx";

/**
 * Connects the feedback sub-viewmodel to the reveal route action.
 *
 * The model stays one state machine across server render and interaction:
 * it starts as the server-rendered variant, and every reveal replaces it
 * with whatever the action resolves with - the next `FeedbackViewModel`.
 * The route action's response arrives as the fetcher's data (latest wins);
 * the current model is serialized into each submit's form under `model`,
 * because a client can send anything and the action re-validates it.
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
  const [current, setCurrent] = useState<FeedbackViewModel>(model);
  // React-sanctioned "adjust state during render": when a reveal settles,
  // adopt it as the state of record so the next submit round-trips the
  // latest variant.
  const settled = fetcher.data ?? current;
  if (settled !== current) {
    setCurrent(settled);
  }
  const dispatch = useCallback(
    (formData: FormData) => {
      formData.set("model", JSON.stringify(settled));
      fetcher.submit(formData, { method: "post", action });
    },
    [settled, fetcher, action],
  );
  return (
    <Feedback
      {...settled}
      dispatch={dispatch}
      isPending={fetcher.state !== "idle"}
    />
  );
};
