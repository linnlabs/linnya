import { runtimeEventToSSEEvent } from 'linnkit/contracts';
import type { RuntimeEvent, SSESubRunTraceEvent } from 'linnkit/contracts';
import type { SubrunTraceBucketMap } from '../definitions/subrunTrace';
import { projectHistoricalSubrunTraceEvent } from './projectHistoricalSubrunTraceEvent';

export function buildSubrunTraceBuckets(
  events: readonly RuntimeEvent[],
  options: { readonly origin?: 'live' | 'historical' } = {},
): SubrunTraceBucketMap {
  const mutableBuckets: Record<string, SSESubRunTraceEvent[]> = {};

  for (const event of events) {
    const sseEvent = runtimeEventToSSEEvent(event);
    if (!isSseSubrunTraceEvent(sseEvent)) {
      continue;
    }

    const bucket = mutableBuckets[sseEvent.subrun_id] ?? [];
    const projectedEvents = options.origin === 'historical'
      ? projectHistoricalSubrunTraceEvent(sseEvent)
      : [sseEvent];
    bucket.push(...projectedEvents);
    mutableBuckets[sseEvent.subrun_id] = bucket;
  }

  const buckets: SubrunTraceBucketMap = {};
  for (const [subrunId, bucketEvents] of Object.entries(mutableBuckets)) {
    buckets[subrunId] = {
      subrun_id: subrunId,
      events: bucketEvents,
    };
  }
  return buckets;
}

function isSseSubrunTraceEvent(event: ReturnType<typeof runtimeEventToSSEEvent>): event is SSESubRunTraceEvent {
  return event !== null && event.type === 'subrun_trace';
}
