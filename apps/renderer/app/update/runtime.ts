import { useUpdateStore } from './store/updateStore';
import { createUpdateActions } from './orchestration/createUpdateActions';
const runtimes = new WeakMap<
  ReturnType<typeof useUpdateStore>,
  ReturnType<typeof createUpdateActions>
>();

export function useUpdateActions() {
  const store = useUpdateStore();
  let actions = runtimes.get(store);
  if (!actions) {
    actions = createUpdateActions(store);
    runtimes.set(store, actions);
  }
  return actions;
}
