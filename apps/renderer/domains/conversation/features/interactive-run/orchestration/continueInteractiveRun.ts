import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { streamConversation } from '../../../services/conversationService';
import { createAssistantStreamCallbacks } from '../../../services/orchestration/createAssistantStreamCallbacks';
import {
  createConversationRequestEventRouter,
  type ConversationEventDispatcher,
} from '../../realtime-event-routing';
import { reconcileInteractiveRunTransportOutcome } from './reconcileInteractiveRunTransportOutcome';
import { reconcileInteractiveRunCommandFailure } from './reconcileInteractiveRunCommandFailure';
import { reconcileTerminalConversationView } from '../../../services/orchestration/reconcileTerminalConversationView';

/** 只发送运行控制身份；绝不构建新消息、重新选模型或修改草稿。 */
export async function continueInteractiveRun(
  conversationId: string,
  dispatcher: ConversationEventDispatcher
): Promise<void> {
  const store = useInteractiveRunStore();
  const current = store.snapshotFor(conversationId);
  if (
    !current?.runId ||
    !current.executionId ||
    current.status !== 'paused' ||
    !current.pause?.settled
  )
    return;
  const controller = new AbortController();
  store.beginContinuation(current, controller);
  try {
    await reconcileTerminalConversationView(conversationId);
    const outcome = await streamConversation(
      {
        conversation_id: conversationId,
        expected_updated_at: current.pause.updatedAt,
        expected_execution_id: current.executionId,
      },
      createAssistantStreamCallbacks({
        callbacks: {},
        signal: controller.signal,
        projectsConversationEvents: true,
        routeEvent: createConversationRequestEventRouter({
          conversationId,
          signal: controller.signal,
          dispatcher,
        }),
        resolveExecutionFailureMessage: () => 'Agent execution interrupted',
      }),
      controller.signal,
      `/api/v1/conversation/runs/${encodeURIComponent(current.runId)}/continue`
    );
    await reconcileInteractiveRunTransportOutcome(conversationId, controller, outcome);
    if (store.isLatestTransport(conversationId, controller)) {
      await reconcileTerminalConversationView(conversationId);
    }
  } catch (error) {
    if (!store.isLatestTransport(conversationId, controller)) throw error;
    store.releaseTransport(conversationId, controller);
    await reconcileInteractiveRunCommandFailure(conversationId, error);
    throw error;
  }
}
