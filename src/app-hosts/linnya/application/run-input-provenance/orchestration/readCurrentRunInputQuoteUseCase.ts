import { RunInputQuoteSchema } from '@app/schemas';
import type { RunDescriptorStore } from '../../run-resumption';
import { requireRootInputEventId } from '../functions/requireRootInputEventId';
import { matchRunInputQuote } from '../functions/matchRunInputQuote';
import { readAdmittedInputText } from '../functions/readAdmittedInputText';

export async function readCurrentRunInputQuoteUseCase(input: {
  conversationId: string;
  agentRunId: string;
  quote: string;
  store: Pick<RunDescriptorStore, 'load' | 'loadEvents'>;
  signal: AbortSignal;
}) {
  input.signal.throwIfAborted();
  const descriptor = await input.store.load(input.agentRunId);
  const eventId = requireRootInputEventId(descriptor, input);
  const [event] = await input.store.loadEvents(input.conversationId, [eventId]);
  input.signal.throwIfAborted();
  const { text, inputRunId } = readAdmittedInputText(event);
  const matched = matchRunInputQuote(text, input.quote);
  return RunInputQuoteSchema.parse({
    conversationId: input.conversationId, agentRunId: input.agentRunId,
    inputEventId: eventId, inputRunId, ...matched,
  });
}
