import type { RunDescriptor } from '../../run-resumption';
import { RunInputQuoteError } from '../definitions/runInputQuoteError';

export function requireRootInputEventId(descriptor: RunDescriptor | null, identity: { conversationId: string; agentRunId: string }): string {
  if (!descriptor || descriptor.conversationId !== identity.conversationId || descriptor.runId !== identity.agentRunId || descriptor.child) {
    throw new RunInputQuoteError('unavailable', 'A current root run with its original admitted input is required. Child delegation is not a conversation user input.');
  }
  const eventId = descriptor.request.currentUserEventId;
  if (!eventId || !descriptor.incomingEventIds.includes(eventId)) {
    throw new RunInputQuoteError('unavailable', 'The current run has no durable current user input. History or a generated query cannot replace it.');
  }
  return eventId;
}
