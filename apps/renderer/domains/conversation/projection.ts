import { useConversationState } from './store/conversationState';
import { createAssistantProjectionRuntime } from './services/orchestration/createAssistantProjectionRuntime';
export type { MessageProjectionState } from './services/messageProjection';
const runtimes = new WeakMap<
  ReturnType<typeof useConversationState>,
  ReturnType<typeof createAssistantProjectionRuntime>
>();
/** reducer 工作区和 SSE 队列不参与 UI 响应式状态，生命周期绑定 Conversation 的 Pinia 实例。 */
export function useConversationProjection() {
  const owner = useConversationState();
  let runtime = runtimes.get(owner);
  if (!runtime) {
    runtime = createAssistantProjectionRuntime();
    runtimes.set(owner, runtime);
  }
  return runtime;
}
