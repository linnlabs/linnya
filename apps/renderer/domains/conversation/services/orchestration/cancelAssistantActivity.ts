import { useConversationState } from '../../store/conversationState';
import { useExecutionState } from '../../store/executionState';
import { cancelInteractiveRun } from '../../features/interactive-run';
import { useAnnotationRunOrchestrator } from './annotationRunOrchestrator';
import { cancelContributedAssistantRuns } from '../../ports/contributedAssistantRunCancellationPort';

/** 取消前台、独立批注和已贡献任务；仍保持原同步返回与后台取消错误记录。 */
export function cancelAssistantActivity(): void {
  const conversationState = useConversationState();
  const executionState = useExecutionState();
  const conversationId = conversationState.activeConversationId;
  if (conversationId) {
    void cancelInteractiveRun(conversationId).catch((error: unknown) => {
      console.error('[AssistantStore] foreground run cancellation workflow failed', error);
    });
  }
  executionState.cancelCurrentStream();
  useAnnotationRunOrchestrator().cancelAnnotationRun(conversationId ?? undefined);
  cancelContributedAssistantRuns();
}
