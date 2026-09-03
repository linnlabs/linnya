import { generateRuntimeEventId } from '@linnlabs/linnkit/contracts';
import { execution } from '@linnlabs/linnkit/runtime-kernel';

export interface CreateRunFailureEventInput {
  readonly conversationId: string;
  readonly turnId: string;
  readonly error: unknown;
}

export function createRunFailureEvent(
  input: CreateRunFailureEventInput,
): execution.ClassifiedRuntimeErrorEvent {
  return execution.createRuntimeErrorEvent({
    id: generateRuntimeEventId(),
    conversationId: input.conversationId,
    turnId: input.turnId,
    error: input.error,
    source: 'AgentRunner',
  });
}
