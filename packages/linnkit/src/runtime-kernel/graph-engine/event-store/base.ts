import type { RoutedRuntimeEvent } from '../../../contracts';

export type PersistedEvent = {
  /** EventStore 内用于稳定分页的单调游标，不等同于 RuntimeEvent.id。 */
  eventStoreId: string;
  event: RoutedRuntimeEvent;
};

export type EventRangeOptions = {
  fromEventStoreId?: string;
  toEventStoreId?: string;
  limit?: number;
};

export interface EventStore {
  append(event: PersistedEvent): Promise<void>;
  range(conversationId: string, opts?: EventRangeOptions): Promise<PersistedEvent[]>;
  latestEventStoreId(conversationId: string): Promise<string | null>;
  truncate?(conversationId: string, opts: { beforeEventStoreId?: string; beforeMs?: number }): Promise<void>;
}

export function requireEventStoreId(eventStoreId: string): string {
  if (eventStoreId.trim().length === 0) {
    throw new Error('PersistedEvent.eventStoreId must be a non-empty storage cursor.');
  }
  return eventStoreId;
}

export function createMonotonicEventStoreIdFactory(
  nowProvider: () => number = () => Date.now(),
): () => string {
  let lastTimestamp = 0;
  let counter = 0;

  return () => {
    // 存储游标必须服从进程内发布顺序；系统时钟回拨不能让历史分页倒退。
    const timestamp = Math.max(nowProvider(), lastTimestamp);
    if (timestamp === lastTimestamp) {
      counter += 1;
    } else {
      lastTimestamp = timestamp;
      counter = 0;
    }

    return `${String(timestamp).padStart(13, '0')}-${String(counter).padStart(4, '0')}`;
  };
}
