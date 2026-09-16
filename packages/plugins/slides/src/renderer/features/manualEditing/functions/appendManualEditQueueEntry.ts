import type { ManualEditQueueEntry } from '../definitions/manualEditQueue';
import { appendManualEditIntent } from './appendManualEditIntent';

export function appendManualEditQueueEntry(
  queue: readonly ManualEditQueueEntry[],
  incoming: ManualEditQueueEntry,
): readonly ManualEditQueueEntry[] {
  const previous = queue[queue.length - 1];
  if (!previous) return [incoming];
  const intents = appendManualEditIntent([previous.intent], incoming.intent);
  const merged = intents.length === 1 ? intents[0] : undefined;
  return merged
    ? [...queue.slice(0, -1), {
        intent: merged,
        clientOperationIds: [...previous.clientOperationIds, ...incoming.clientOperationIds],
      }]
    : [...queue, incoming];
}
