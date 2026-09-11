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
}
