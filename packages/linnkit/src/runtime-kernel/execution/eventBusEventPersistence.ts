import type { EventEnvelope, RoutedRuntimeEvent, RuntimeEvent } from '../../contracts';
import type { EventStore } from '../graph-engine/event-store/base';
import { shouldPersistRuntimeEvent } from '../events/eventGovernance';
import type { EventBus } from './event-bus';

export interface EventBusEventPersistenceOptions {
  eventBus: EventBus;
  eventStore: EventStore;
  nextEventStoreId: () => string;
}

/**
 * EventBus durable consumer：按发布顺序串行写入事实，并在 run 进入终态前传播首个失败。
 * root、child 与 standalone runtime 共用这一实现，宿主不再各自维护 persistence queue。
 */
export class EventBusEventPersistence {
  private readonly scheduledEventIds = new Set<string>();
  private writeTail: Promise<void> = Promise.resolve();
  private firstWriteError: unknown;
  private connected = false;

  constructor(private readonly options: EventBusEventPersistenceOptions) {}

  connect(): void {
    if (this.connected) {
      throw new Error('[EventBusEventPersistence] consumer is already connected');
    }
    this.connected = true;
    this.options.eventBus.on('event', this.onEvent);
    this.options.eventBus.once('close', this.disconnect);
  }

  async drain(): Promise<void> {
    await this.writeTail;
    if (this.firstWriteError !== undefined) {
      throw this.firstWriteError;
    }
  }

  /**
   * 在 EventBus fan-out 前提交一条 durable fact。
   *
   * 中文备注：自动上下文压缩会立即使用 `history_summary`
   * 重建后续 Prompt，因此必须先确认事实已落盘，再让 realtime 和其它
   * observer 看到它。这仍复用同一条写队列，并用事件 ID 防止随后的
   * EventBus publish 重复落库。
   */
  async commitBeforePublish(event: RoutedRuntimeEvent): Promise<void> {
    if (!shouldPersistRuntimeEvent(event)) {
      throw new Error(
        `[EventBusEventPersistence] commit-before-publish requires a durable event: ${event.type}`,
      );
    }
    if (this.scheduledEventIds.has(event.id)) {
      throw new Error(
        `[EventBusEventPersistence] event was already scheduled before durable commit: ${event.id}`,
      );
    }
    await this.scheduleWrite(event);
  }

  /** 已由 Host admission transaction 提交的 incoming fact 不得再次落盘。 */
  acknowledgePersisted(events: readonly RuntimeEvent[]): void {
    for (const event of events) {
      this.scheduledEventIds.add(event.id);
    }
  }

  private readonly onEvent = (envelope: EventEnvelope<RoutedRuntimeEvent>): void => {
    const event = envelope.payload;
    if (!shouldPersistRuntimeEvent(event) || this.scheduledEventIds.has(event.id)) {
      return;
    }

    void this.scheduleWrite(event).catch(() => undefined);
  };

  private scheduleWrite(event: RoutedRuntimeEvent): Promise<void> {
    this.scheduledEventIds.add(event.id);
    const eventStoreId = this.options.nextEventStoreId();
    const write = this.writeTail.then(async () => {
      await this.options.eventStore.append({ eventStoreId, event });
    });
    this.writeTail = write;
    void write.catch((error: unknown) => {
      this.firstWriteError ??= error;
    });
    return write;
  }

  private readonly disconnect = (): void => {
    if (!this.connected) return;
    this.options.eventBus.off('event', this.onEvent);
    this.connected = false;
  };
}
