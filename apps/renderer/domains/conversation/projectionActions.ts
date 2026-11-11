import { useConversationProjection } from './projection';
import { useConversationState } from './store/conversationState';
const projectionActions = new WeakMap<
  ReturnType<typeof useConversationState>,
  ReturnType<typeof createAssistantProjectionActions>
>();
function createAssistantProjectionActions() {
  const projection = useConversationProjection(),
    state = useConversationState();
  return {
    ...projection,
    mergeConversationMetadata(conversationId: string, metadata: Record<string, unknown>): void {
      state.mergeConversationMetadata(conversationId, metadata);
      projection.mergeConversationMetadata(conversationId, metadata);
    },
  };
}
/** 对话投影命令入口，状态聚合 store 不反向装配异步投影。 */
export function useConversationProjectionActions() {
  const owner = useConversationState();
  let actions = projectionActions.get(owner);
  if (!actions) {
    actions = createAssistantProjectionActions();
    projectionActions.set(owner, actions);
  }
  return actions;
}
