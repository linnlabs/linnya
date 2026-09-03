import { requireEventStoreId } from './base';
import type { EventRangeOptions, EventStore, PersistedEvent } from './base';
import { cloneEngineStateValue } from '../functions/engineStateSnapshot';
import { requirePersistableRoutedRuntimeEvent } from '../../events';

function clonePersistedEvent(event: PersistedEvent): PersistedEvent {
  return cloneEngineStateValue(event);
}

export class MemoryEventStore implements EventStore {
  private readonly store = new Map<string, PersistedEvent[]>();

  async append(event: PersistedEvent): Promise<void> {
    requireEventStoreId(event.eventStoreId);
    const routedEvent = requirePersistableRoutedRuntimeEvent(event.event);
    const conversationId = routedEvent.conversation_id;
    const current = this.store.get(conversationId) ?? [];
    current.push(clonePersistedEvent(event));
    this.store.set(conversationId, current);
  }

  async range(conversationId: string, opts: EventRangeOptions = {}): Promise<PersistedEvent[]> {
    const events = [...(this.store.get(conversationId) ?? [])]
      .filter((event) => (opts.fromEventStoreId ? event.eventStoreId > opts.fromEventStoreId : true))
      .filter((event) => (opts.toEventStoreId ? event.eventStoreId <= opts.toEventStoreId : true));

    if (opts.limit === undefined) {
      return events.map(clonePersistedEvent);
    }

    return events.slice(0, opts.limit).map(clonePersistedEvent);
  }

  async latestEventStoreId(conversationId: string): Promise<string | null> {
    const events = this.store.get(conversationId) ?? [];
    const latest = events.length > 0 ? events[events.length - 1] : undefined;
    return latest?.eventStoreId ?? null;
  }

  async truncate(
    conversationId: string,
    opts: { beforeEventStoreId?: string; beforeMs?: number },
  ): Promise<void> {
    const events = this.store.get(conversationId) ?? [];
    const retained = events.filter((event) => {
      if (opts.beforeEventStoreId && event.eventStoreId < opts.beforeEventStoreId) {
        return false;
      }
      if (opts.beforeMs !== undefined && event.event.timestamp < opts.beforeMs) {
        return false;
      }
      return true;
    });
    this.store.set(conversationId, retained);
  }
}
