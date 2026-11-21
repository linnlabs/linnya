import { watch } from 'vue';
import type { ConversationActivity } from '@app/schemas';
import { useAssistantStore } from '../../../store/assistantStore';
import { useHistoryList } from '../../../history/list';
import { useCommandApprovalProjectionStore } from '../../command-approval';
import { useInteractiveRunStore } from '../../interactive-run';
import { retainSeenRunIds } from '../functions/resolveConversationRunStatus';
import {
  readConversationActivityList,
  subscribeConversationActivityChanged,
} from '../infrastructure/conversationActivityGateway';
import { useConversationActivityStore } from '../store/conversationActivityStore';
import { useConversationActivitySeenStore } from '../store/conversationActivitySeenStore';

let stopLifecycle: (() => void) | null = null;
let inFlight: Promise<void> | null = null;
let rereadRequested = false;

/**
 * 重读全工作区运行状态。同一时刻只有一个请求；请求期间又收到信号时，结束后再读一次，
 * 保证最后一次变化之后至少读过一回。失败保留上一份结果，等下一个信号或窗口回到前台。
 */
export function refreshConversationActivity(): Promise<void> {
  if (inFlight) {
    rereadRequested = true;
    return inFlight;
  }
  const activityStore = useConversationActivityStore();
  const seenStore = useConversationActivitySeenStore();
  inFlight = (async () => {
    do {
      rereadRequested = false;
      activityStore.replace(await readConversationActivityList());
      const activities = new Map<string, ConversationActivity>();
      for (const [conversationId, entry] of activityStore.entries) activities.set(conversationId, entry.activity);
      seenStore.replaceSeenRunIds(retainSeenRunIds(seenStore.seenRunIds, activities));
      // 窗口外新建的对话（CLI send）不在已加载的侧栏列表里，让列表补读，记号才有行可挂。
      useHistoryList().revealConversations([...activityStore.entries].map(([conversationId, entry]) => ({
        conversationId,
        projectId: entry.projectId,
      })));
    } while (rereadRequested);
  })().catch((error: unknown) => {
    console.warn('[ConversationActivity] 读取运行状态失败', error instanceof Error ? error.message : error);
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * 侧栏运行状态的生命周期：先订阅 Host 的失效信号再初次读取。另外三种时机也重读：
 * 审批变化（复用已有审批推送）、窗口回到前台。不设定时轮询。
 *
 * “看过”的两条规则也在这里：正在看的对话出现中断当场记下；本窗口发起暂停或取消时
 * 立刻记下那次运行，避免操作后马上切走时红点冒出来。
 */
export function startConversationActivityLifecycle(): void {
  if (stopLifecycle) return;
  const activityStore = useConversationActivityStore();
  const seenStore = useConversationActivitySeenStore();
  const assistantStore = useAssistantStore();
  const approvalStore = useCommandApprovalProjectionStore();
  const runStore = useInteractiveRunStore();
  seenStore.ensureBaseline(Date.now());

  const unsubscribe = subscribeConversationActivityChanged(() => void refreshConversationActivity());
  const stopApprovalWatch = watch(() => approvalStore.snapshot, () => void refreshConversationActivity());
  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void refreshConversationActivity();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const stopActiveWatch = watch(
    [() => assistantStore.activeConversationId, () => activityStore.entries],
    ([conversationId, entries]) => {
      if (!conversationId) return;
      const activity = entries.get(conversationId)?.activity;
      if (activity?.state === 'interrupted' && activity.run_id) seenStore.markSeen(conversationId, activity.run_id);
    },
    { immediate: true },
  );
  const stopLocalStopWatch = watch(
    () => [...runStore.runsByConversation.values()]
      .filter(run => run.runId && (run.status === 'pausing' || run.status === 'cancelling'))
      .map(run => [run.conversationId, run.runId!] as const),
    stopping => {
      for (const [conversationId, runId] of stopping) seenStore.markSeen(conversationId, runId);
    },
  );

  stopLifecycle = () => {
    unsubscribe();
    stopApprovalWatch();
    stopActiveWatch();
    stopLocalStopWatch();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
  void refreshConversationActivity();
}

export function stopConversationActivityLifecycle(): void {
  stopLifecycle?.();
  stopLifecycle = null;
}
