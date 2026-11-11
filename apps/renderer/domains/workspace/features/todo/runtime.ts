import { useTodoStore } from './store/todoStore';
import { createTodoRuntime } from './orchestration/createTodoRuntime';

const runtimes = new WeakMap<
  ReturnType<typeof useTodoStore>,
  ReturnType<typeof createTodoRuntime>
>();

/** 待办订阅与请求按 Pinia 生命周期隔离，组件重挂载不会重复订阅。 */
export function useTodoActions() {
  const store = useTodoStore();
  let runtime = runtimes.get(store);
  if (!runtime) {
    runtime = createTodoRuntime(store);
    runtimes.set(store, runtime);
  }
  return runtime;
}
