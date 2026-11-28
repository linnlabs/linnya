import type {
  ConversationActivityList,
  ConversationAttentionNotification,
  ConversationExternalSender,
} from '@app/schemas';

/** 一段等待：同一次运行每停下来等用户一次算一段，等的事情变了（批准 ↔ 回答）另算一段。 */
export interface WaitingEpisode {
  readonly conversationId: string;
  readonly projectId: string | null;
  readonly runId: string;
  readonly kind: ConversationAttentionNotification['kind'];
}

export interface ExternalRunAttentionPorts {
  /** 全工作区非空闲对话的运行状态，与侧栏读的是同一份事实。 */
  readonly listActivities: () => Promise<ConversationActivityList>;
  /** 根运行由外部入口发起时返回登记的发件人；用户在界面里发起的运行返回 null。 */
  readonly readExternalSender: (runId: string) => ConversationExternalSender | null;
  /** 对话不存在时返回 null；标题只用于显示。 */
  readonly readConversationTitle: (conversationId: string) => Promise<string | null>;
  readonly notify: (notification: ConversationAttentionNotification) => Promise<void>;
  readonly logError: (message: string, error: unknown) => void;
}
