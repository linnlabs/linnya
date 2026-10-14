export type InteractiveRunStatus =
  | 'starting'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'continuing'
  | 'reconnecting'
  | 'awaiting_user'
  | 'submitting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type InteractiveRunTerminalStatus = Extract<
  InteractiveRunStatus,
  'completed' | 'failed' | 'cancelled'
>;

export interface PendingRunInteraction {
  interactionId: string;
  runId: string;
  toolCallId: string;
  checkpointRevision: number;
  resumeToken: string;
}

export interface InteractiveRunSnapshot {
  conversationId: string;
  runId?: string;
  turnId?: string;
  executionId?: string;
  status: InteractiveRunStatus;
  pendingInteraction?: PendingRunInteraction;
  pause?: { settled: boolean; updatedAt: number; reason?: string };
  error?: string;
  /** 已投影的运行错误消息身份；控制错误没有该字段，避免重复显示或掩盖本地错误。 */
  errorNoticeId?: string;
}

/** 输入区只暴露这三种动作，控制收口通过禁用表达，不创建 waiting/cancel 按钮。 */
export type ComposerRunAction = 'send' | 'pause' | 'resume';

export interface ComposerRunControl {
  readonly action: ComposerRunAction;
  readonly disabled: boolean;
}
