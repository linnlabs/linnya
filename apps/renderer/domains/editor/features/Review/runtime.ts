import { useReviewStore } from './store/reviewStore';
import { createReviewActions } from './orchestration/createReviewActions';
const runtimes = new WeakMap<
  ReturnType<typeof useReviewStore>,
  ReturnType<typeof createReviewActions>
>();
export function useReviewActions() {
  const state = useReviewStore();
  let actions = runtimes.get(state);
  if (!actions) {
    actions = createReviewActions(state);
    runtimes.set(state, actions);
  }
  return actions;
}
