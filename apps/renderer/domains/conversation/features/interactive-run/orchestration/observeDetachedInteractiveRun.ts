import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { isInteractiveRunBusy } from '../functions/interactiveRunTransitions';
import { projectRunSettlementResponse } from '../functions/projectRunSettlementResponse';
import { projectActiveRunResponse } from '../functions/projectActiveRunResponse';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';
import { fetchActiveForegroundRun, fetchForegroundRunSettlement } from './interactiveRunApi';
import { refreshDetachedConversationView } from '../../../services/orchestration/refreshDetachedConversationView';

/** 本窗口没有在途运行：从没运行过、已终态或已收口暂停。CLI 等其它入口可能在这时写入新运行。 */
function isIdleForExternalRuns(snapshot: InteractiveRunSnapshot | undefined): boolean {
  if (!snapshot) return true;
  if (snapshot.status === 'paused') return snapshot.pause?.settled === true;
  return snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled';
}

/**
 * 空闲时只按 durable revision 刷新当前窗口；窗口确有新内容时再查询是否出现了别的入口启动的在途运行，
 * 有则接入控制快照，之后由运行观察接管。revision 未变时不发第二个请求。
 * 失败不改控制状态：本窗口没有需要对账的运行，下一次观察重试。
 */
async function observeIdleConversation(
  conversationId: string,
  current: InteractiveRunSnapshot | undefined
): Promise<void> {
  const store = useInteractiveRunStore();
  const isCurrent = () => store.snapshotFor(conversationId) === current && !store.hasTransport(conversationId);
  try {
    const refresh = await refreshDetachedConversationView(
      conversationId,
      isCurrent,
      store.transportGenerationFor(conversationId)
    );
    if (refresh !== 'updated' || !isCurrent()) return;
    const next = projectActiveRunResponse(await fetchActiveForegroundRun(conversationId));
    if (next && isCurrent()) store.synchronizeSnapshot(conversationId, next);
  } catch {
    // 空闲观察没有运行可收敛；网络或投影暂时不可用时保留当前窗口，下一次观察重试。
  }
}

/** 没有 reader 时只观察 Backend；不暂停、不重新发送、不生成任何执行事实。 */
export async function observeDetachedInteractiveRun(conversationId: string): Promise<void> {
  const store = useInteractiveRunStore();
  const current = store.snapshotFor(conversationId);
  if (store.hasTransport(conversationId)) return;
  if (isIdleForExternalRuns(current)) {
    await observeIdleConversation(conversationId, current);
    return;
  }
  if (
    !current ||
    (!isInteractiveRunBusy(current) && !(current.status === 'paused' && !current.pause?.settled)) ||
    current.status === 'awaiting_user'
  )
    return;
  try {
    const next = current.runId
      ? projectRunSettlementResponse(
          await fetchForegroundRunSettlement(conversationId, current.runId),
          current
        )
      : projectActiveRunResponse(await fetchActiveForegroundRun(conversationId));
    if (store.snapshotFor(conversationId) !== current || store.hasTransport(conversationId)) return;
    // exact-run settlement 已经过 Host 持久化屏障；终态也先同步当前窗口，失败时保留观察重试。
    const refresh = await refreshDetachedConversationView(conversationId, () => (
      store.snapshotFor(conversationId) === current && !store.hasTransport(conversationId)
    ), store.transportGenerationFor(conversationId));
    if (refresh === 'preparing' || store.snapshotFor(conversationId) !== current || store.hasTransport(conversationId)) return;
    store.synchronizeSnapshot(conversationId, next);
  } catch (error) {
    if (store.snapshotFor(conversationId) !== current || store.hasTransport(conversationId)) return;
    store.synchronizeSnapshot(conversationId, {
      ...current,
      status: 'reconnecting',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
