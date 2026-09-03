import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { reconcileInteractiveRunCommandFailure } from './reconcileInteractiveRunCommandFailure';
import { reconcileTerminalConversationView } from '../../../services/orchestration/reconcileTerminalConversationView';
import { requestForegroundRunCancellation } from './interactiveRunApi';

export interface CancelInteractiveRunDeps {
  readonly reconcileSettledView?: (conversationId: string) => Promise<void>;
  /** 取消来源必须由调用方明确传入，不能把 rerun 或 transport 清理伪装成用户点击。 */
  readonly reason?: 'user_cancelled' | 'rerun_replaced_foreground_run';
}

export async function cancelInteractiveRun(
  conversationId: string,
  deps: CancelInteractiveRunDeps = {},
): Promise<boolean> {
  const store = useInteractiveRunStore();
  const reconcileSettledView = deps.reconcileSettledView ?? reconcileTerminalConversationView;
  const run = store.beginCancelling(conversationId);
  if (!run?.runId) {
    store.abortTransport(conversationId);
    store.completeTerminalSettlement(conversationId, 'cancelled');
    return false;
  }
  const runId = run.runId;

  const settlement = await (async () => {
    try {
      return await requestForegroundRunCancellation(runId, {
        conversation_id: conversationId,
        reason: deps.reason ?? 'user_cancelled',
      });
    } catch (error) {
      await reconcileInteractiveRunCommandFailure(conversationId, error);
      throw error;
    }
  })();

  // Host 返回的是竞争后的持久终态，不是“按钮点击意图”。先按事实终止旧 reader，再读取
  // durable tail；否则自然完成恰好赢过 cancel 时，Renderer 会虚构一个 cancelled 状态。
  store.completeTerminalSettlement(conversationId, settlement.terminal_status);
  try {
    await reconcileSettledView(conversationId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const reconciliationError = new Error(
      `Run ${runId} settled as ${settlement.terminal_status}, but durable conversation reconciliation failed: ${reason}`,
    );
    store.recordCommandError(conversationId, reconciliationError.message);
    throw reconciliationError;
  }
  return true;
}
