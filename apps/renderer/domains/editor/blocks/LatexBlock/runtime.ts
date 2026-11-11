import { useLatexEditorStore } from './store/latexEditor';
import { createLatexEditorActions } from './orchestration/createLatexEditorActions';
const runtimes = new WeakMap<
  ReturnType<typeof useLatexEditorStore>,
  ReturnType<typeof createLatexEditorActions>
>();
export function useLatexEditorActions() {
  const state = useLatexEditorStore();
  let actions = runtimes.get(state);
  if (!actions) {
    actions = createLatexEditorActions(state);
    runtimes.set(state, actions);
  }
  return actions;
}
