import { storeToRefs } from 'pinia';
import { useBackendHealthStore } from '@app/backend-health';
import { useAssistantStore } from '../../../store/assistantStore';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';
import type { ConversationRunStatus } from '../definitions/conversationRunStatus';
import {
  resolveConversationRunStatus,
  summarizeConversationRunStatuses,
} from '../functions/resolveConversationRunStatus';
import { useConversationActivityStore } from '../store/conversationActivityStore';
import { useConversationActivitySeenStore } from '../store/conversationActivitySeenStore';

const STATUS_LABEL_KEYS: Readonly<Record<ConversationRunStatus, ConversationMessageKey>> = {
  running: 'conversation.sidebar.runStatus.running',
  'awaiting-answer': 'conversation.sidebar.runStatus.awaitingAnswer',
  'awaiting-approval': 'conversation.sidebar.runStatus.awaitingApproval',
  interrupted: 'conversation.sidebar.runStatus.interrupted',
};

const TRAILING_KEYS: Readonly<Partial<Record<ConversationRunStatus, ConversationMessageKey>>> = {
  'awaiting-answer': 'conversation.sidebar.runStatus.trailingAnswer',
  'awaiting-approval': 'conversation.sidebar.runStatus.trailingApproval',
};

const PROJECT_LABEL_KEYS: Readonly<Record<ConversationRunStatus, ConversationMessageKey>> = {
  running: 'conversation.sidebar.runStatus.projectRunning',
  'awaiting-answer': 'conversation.sidebar.runStatus.projectAwaitingAnswer',
  'awaiting-approval': 'conversation.sidebar.runStatus.projectAwaitingApproval',
  interrupted: 'conversation.sidebar.runStatus.projectInterrupted',
};

export interface ConversationRunStatusPresentation {
  readonly status: ConversationRunStatus;
  readonly label: string;
}

/** 侧栏读取运行状态记号的唯一入口；正在看的对话不显示中断。 */
export function useConversationRunStatus() {
  const { entries } = storeToRefs(useConversationActivityStore());
  const seenStore = useConversationActivitySeenStore();
  const assistantStore = useAssistantStore();
  const { conversationMessage } = useConversationLocalization();
  const backendHealth = useBackendHealthStore();

  function statusOf(conversationId: string): ConversationRunStatus | null {
    // 后台停了，记录里的“运行中”已经不是事实；重启后由启动恢复给出真实状态。
    if (backendHealth.isUnavailable) return null;
    const status = resolveConversationRunStatus(conversationId, entries.value.get(conversationId)?.activity, seenStore.$state);
    return status === 'interrupted' && conversationId === assistantStore.activeConversationId ? null : status;
  }

  function presentationOf(conversationId: string): ConversationRunStatusPresentation | null {
    const status = statusOf(conversationId);
    return status ? { status, label: conversationMessage(STATUS_LABEL_KEYS[status]) } : null;
  }

  /** 等你处理时行尾代替时间的文字；其他状态行尾照旧是时间。 */
  function trailingTextOf(conversationId: string): string | null {
    const status = statusOf(conversationId);
    const key = status ? TRAILING_KEYS[status] : undefined;
    return key ? conversationMessage(key) : null;
  }

  function projectSummaryOf(projectId: string): ConversationRunStatusPresentation | null {
    const statuses: (ConversationRunStatus | null)[] = [];
    for (const [conversationId, entry] of entries.value) {
      if (entry.projectId === projectId) statuses.push(statusOf(conversationId));
    }
    const summary = summarizeConversationRunStatuses(statuses);
    return summary
      ? { status: summary.status, label: conversationMessage(PROJECT_LABEL_KEYS[summary.status], { count: summary.count }) }
      : null;
  }

  return { statusOf, presentationOf, trailingTextOf, projectSummaryOf };
}
