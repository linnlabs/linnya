import type { RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { IEventStore } from '../../persistence/event-store';

export async function readResearchSourceEvents(params: {
  readonly eventStore: Pick<IEventStore, 'openRunSession' | 'readEvents'>;
  readonly conversationId: string;
  readonly sourceRunId: string;
}): Promise<readonly RoutedRuntimeEvent[]> {
  // 正式 owner 核对 run 归属，不接受把 root 的 conversation history 冒充 child 的来源。
  await params.eventStore.openRunSession(params.conversationId, params.sourceRunId);
  const events: RoutedRuntimeEvent[] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = await params.eventStore.readEvents(params.conversationId, {
      direction: 'forward', limit: 1000, ...(cursor === undefined ? {} : { cursor }),
    });
    events.push(...page.events.filter(event => event.run_id === params.sourceRunId));
    if (!page.hasMore) return events;
    if (page.nextCursor === undefined || page.nextCursor === cursor) {
      throw new Error('Research source event reader returned an incomplete pagination cursor.');
    }
    cursor = page.nextCursor;
  }
}
