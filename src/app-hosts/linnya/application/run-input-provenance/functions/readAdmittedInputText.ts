import type { RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { getRenderableRuntimeEventContent } from '../../../context/agent/userInputContext';
import { RunInputQuoteError } from '../definitions/runInputQuoteError';

export function readAdmittedInputText(event: RoutedRuntimeEvent | undefined) {
  if (!event || event.type !== 'user_input' || event.lane !== 'foreground' || event.visibility !== 'conversation') {
    throw new RunInputQuoteError('unavailable', 'The admitted event is not a visible conversation user input.');
  }
  const text = getRenderableRuntimeEventContent(event);
  if (text === undefined) throw new RunInputQuoteError('unavailable', 'The admitted input has no text.');
  return { text, inputRunId: event.run_id };
}
