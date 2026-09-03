import type { EventEnvelope, RoutedRuntimeEvent } from '../../contracts';
import type { EventBus } from '../execution';
import { projectChildRuntimeEventToSubRunTrace } from './projectChildRuntimeEventToSubRunTrace';
import type { SubRunTracePublisher } from './subrunTrace.types';

export interface ChildRunParentTraceProjectionOptions {
  childEventBus: EventBus;
  parentTracePublisher: SubRunTracePublisher;
}

/**
 * child EventBus 的父级 read-model consumer。
 *
 * 投影失败在 terminal drain 时传播，不能从同步 EventBus listener 直接抛出，
 * 否则同一 child fact 的 persistence、observation 与 journal 会因监听器顺序产生分叉。
 */
export class ChildRunParentTraceProjection {
  private firstProjectionError: unknown;
  private connected = false;

  constructor(private readonly options: ChildRunParentTraceProjectionOptions) {}

  connect(): void {
    if (this.connected) {
      throw new Error('[ChildRunParentTraceProjection] consumer is already connected');
    }
    this.connected = true;
    this.options.childEventBus.on('event', this.onEvent);
    this.options.childEventBus.once('close', this.disconnect);
  }

  async drain(): Promise<void> {
    if (this.firstProjectionError !== undefined) {
      throw this.firstProjectionError;
    }
  }

  private readonly onEvent = (envelope: EventEnvelope<RoutedRuntimeEvent>): void => {
    if (this.firstProjectionError !== undefined) {
      return;
    }
    const trace = projectChildRuntimeEventToSubRunTrace(envelope.payload);
    if (!trace) {
      return;
    }
    try {
      this.options.parentTracePublisher.publish(trace);
    } catch (error) {
      this.firstProjectionError = error;
    }
  };

  private readonly disconnect = (): void => {
    if (!this.connected) return;
    this.options.childEventBus.off('event', this.onEvent);
    this.connected = false;
  };
}
