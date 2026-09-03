import type { RuntimeEvent } from 'linnkit/contracts';
import type { FlowExecutionResult } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';

export function finalizeSuccessfulRun(params: {
  conversationId: string;
  checkpointNodeId: string;
  stepCount: number;
  events: RuntimeEvent[];
}): FlowExecutionResult {
  return {
    conversation_id: params.conversationId,
    events: [...params.events],
    stepCount: params.stepCount,
    checkpointNodeId: params.checkpointNodeId,
  };
}

export function finalizeFailedRun(params: {
  conversationId: string;
  events: RuntimeEvent[];
  isAbortError: boolean;
}): FlowExecutionResult {
  return {
    conversation_id: params.conversationId,
    events: [...params.events],
    stepCount: 0,
    terminationReason: params.isAbortError ? 'interrupted' : 'error',
  };
}
