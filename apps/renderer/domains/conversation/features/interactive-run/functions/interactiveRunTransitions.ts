import type { SSEEvent } from 'linnkit/contracts';
import type {
  InteractiveRunSnapshot,
  PendingRunInteraction,
} from '../definitions/interactiveRun';

export function readPendingRunInteraction(
  event: Extract<SSEEvent, { type: 'requires_user_interaction' }>,
): PendingRunInteraction {
  return {
    interactionId: event.interaction_id,
    runId: event.run_id,
    toolCallId: event.tool_call_id,
    checkpointRevision: event.checkpoint_revision,
    resumeToken: event.resume_token,
  };
}

export function reduceInteractiveRunEvent(
  current: InteractiveRunSnapshot | undefined,
  event: SSEEvent,
): InteractiveRunSnapshot | undefined {
  if (event.lane === 'auxiliary' || event.visibility === 'none') return current;
  /**
   * 用户可以在旧 transport 的 transport_end 到达前提交问卷。beginSubmitting 已把控制权
   * 交给新的 resume transport，此后旧 execution 的迟到事件不得让状态倒退，也不得释放
   * 新 transport 的 controller。每次 resume 都由 host 分配新的 executionId。
   */
  if (
    current?.status === 'submitting'
    && current.executionId
    && event.execution_id === current.executionId
  ) {
    return current;
  }
  // 同一 conversation 只允许一个 foreground run；活跃期内其它 run 的迟到事件没有控制权。
  if (
    isInteractiveRunBusy(current)
    && current?.runId
    && event.run_id
    && event.run_id !== current.runId
  ) {
    return current;
  }
  const identity = {
    conversationId: event.conversation_id,
    runId: event.run_id ?? current?.runId,
    turnId: event.turn_id,
    executionId: event.execution_id ?? current?.executionId,
  };

  if (event.type === 'requires_user_interaction') {
    return {
      ...identity,
      status: 'awaiting_user',
      pendingInteraction: readPendingRunInteraction(event),
    };
  }
  if (event.type === 'error') {
    return {
      ...identity,
      status: 'failed',
      error: event.error,
    };
  }
  if (event.type === 'run_status') {
    if (event.status === 'awaiting_user') {
      return current?.pendingInteraction
        ? { ...current, ...identity, status: 'awaiting_user' }
        : current;
    }
    if (event.status === 'pending' || event.status === 'running' || event.status === 'paused') {
      return {
        ...identity,
        status: event.status === 'pending' ? 'starting' : 'running',
        pendingInteraction: current?.pendingInteraction,
      };
    }
    return {
      ...identity,
      status: event.status === 'cancelled'
        ? 'cancelled'
        : event.status === 'failed'
          ? 'failed'
          : 'completed',
      pendingInteraction: undefined,
      error: event.status === 'failed' ? event.reason_message ?? current?.error : current?.error,
    };
  }
  if (event.type === 'run_execution_metrics' || event.type === 'transport_end') return current;
  return {
    ...identity,
    status: 'running',
    pendingInteraction: current?.pendingInteraction,
  };
}

export function isInteractiveRunBusy(snapshot: InteractiveRunSnapshot | undefined): boolean {
  return snapshot?.status === 'starting'
    || snapshot?.status === 'running'
    || snapshot?.status === 'awaiting_user'
    || snapshot?.status === 'submitting'
    || snapshot?.status === 'cancelling';
}

export function assertInteractiveRunCanStart(
  conversationId: string,
  snapshot: InteractiveRunSnapshot | undefined,
): void {
  if (!isInteractiveRunBusy(snapshot)) return;
  throw new Error(
    `Conversation ${conversationId} already has active foreground run ${snapshot?.runId ?? 'pending-registration'}`,
  );
}
