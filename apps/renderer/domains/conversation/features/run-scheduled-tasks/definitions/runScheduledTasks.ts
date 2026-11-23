/**
 * 一轮回复里 Agent 建了或改了定时任务时，回答末尾每个任务一张卡片。
 * Conversation 只负责摆放；文字、警告与按钮由 port 实现按定时任务的规则给出。
 */
export interface RunScheduledTaskCardAction {
  readonly id: string;
  readonly label: string;
  readonly variant: 'secondary' | 'ghost';
}

export interface RunScheduledTaskCard {
  readonly taskId: string;
  readonly name: string;
  /** 时间表、下次运行与权限，一行写完。 */
  readonly meta: string;
  /** 完全访问或高于对话档位时为警告样式。 */
  readonly tone: 'normal' | 'warning';
  /** 单独一行的警告；没有为 null。 */
  readonly warning: string | null;
  readonly actions: readonly RunScheduledTaskCardAction[];
}

export interface RunScheduledTasksRequest {
  readonly conversationId: string;
  readonly rootRunIds: readonly string[];
}

export interface RunScheduledTasksPort {
  list(request: RunScheduledTasksRequest): Promise<readonly RunScheduledTaskCard[]>;
  act(card: RunScheduledTaskCard, actionId: string): Promise<void>;
  /** 任务有变化时回调，用于刷新卡片；返回取消订阅。 */
  watch(onChange: () => void): () => void;
}
