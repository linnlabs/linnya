/**
 * @file src/agent/runtime-kernel/execution/event-bus.ts
 * @description 内存中的事件总线
 *
 * 功能 (What):
 * - 提供一个中央事件中心，用于发布和订阅 `EventEnvelope` 事件。
 * - 解耦事件的产生方（如 Runners）和消费方（如持久化、SSE推送）。
 * - 保证事件处理的逻辑集中化。
 *
 * 这是一个简单的内存实现，为每个执行流程（execution）创建一个实例。
 */

import { Logger } from '../../shared/logger';
import { isRoutedRuntimeEvent } from '../../contracts';
import type { EventEnvelope, RoutedRuntimeEvent, RuntimeEvent } from '../../contracts';

const logger = new Logger('EventBus');

// 定义事件总线可以发出的事件类型
type EventBusEvents = {
  'event': (envelope: EventEnvelope<RoutedRuntimeEvent>) => void;
  'error': (error: Error) => void;
  'close': () => void;
};

// 使用轻量内存 emitter，避免 Node EventEmitter 的 any listener 边界污染公开类型。
type EventListener = (...args: never[]) => void;

class TypedEventEmitter<TEvents extends Record<string, EventListener>> {
  private readonly listeners = new Map<keyof TEvents, Set<TEvents[keyof TEvents]>>();
  private maxListeners = 10;

  on<TEvent extends keyof TEvents>(event: TEvent, listener: TEvents[TEvent]): this {
    const listeners = this.getListeners(event);
    listeners.add(listener);
    if (listeners.size > this.maxListeners) {
      logger.warn('EventBus listener count exceeds configured max', {
        event: String(event),
        count: listeners.size,
        maxListeners: this.maxListeners,
      });
    }
    return this;
  }

  off<TEvent extends keyof TEvents>(event: TEvent, listener: TEvents[TEvent]): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  once<TEvent extends keyof TEvents>(event: TEvent, listener: TEvents[TEvent]): this {
    const onceListener = ((...args: Parameters<TEvents[TEvent]>) => {
      this.off(event, onceListener);
      listener(...args);
    }) as TEvents[TEvent];
    this.on(event, onceListener);
    return this;
  }

  emit<TEvent extends keyof TEvents>(event: TEvent, ...args: Parameters<TEvents[TEvent]>): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }
    for (const listener of [...listeners]) {
      const typedListener = listener as TEvents[TEvent];
      typedListener(...args);
    }
    return true;
  }

  removeAllListeners<TEvent extends keyof TEvents>(event?: TEvent): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  private getListeners<TEvent extends keyof TEvents>(event: TEvent): Set<TEvents[keyof TEvents]> {
    const existing = this.listeners.get(event);
    if (existing) {
      return existing;
    }
    const created = new Set<TEvents[keyof TEvents]>();
    this.listeners.set(event, created);
    return created;
  }
}

/**
 * 事件总线类
 *
 * 为每一次执行（execution）实例化一次，管理该执行生命周期内的所有事件。
 */
export class EventBus extends TypedEventEmitter<EventBusEvents> {
  public readonly executionId: string; // 🔥 改为 public 以便外部访问

  constructor(executionId: string) {
    super();
    this.executionId = executionId;
    this.setMaxListeners(30); // 默认10个，增加一些以防多工具监听等场景
    logger.info(`EventBus created for execution ${this.executionId}`);
  }

  /**
   * 发布一个事件到总线
   * @param envelope - 经过序列器包装的事件信封
   */
  publish(envelope: EventEnvelope<RuntimeEvent>): void {
    if (envelope.trace.execution_id !== this.executionId) {
      const error = new Error('EventEnvelope execution_id does not match EventBus instance.');
      logger.error('Mismatched execution_id', {
        busExecutionId: this.executionId,
        eventExecutionId: envelope.trace.execution_id,
        eventSeq: envelope.seq,
      });
      this.emit('error', error);
      return;
    }

    if (!isRoutedRuntimeEvent(envelope.payload)) {
      const error = new Error(
        'EventBus only accepts RuntimeEvent with formal run routing identity.',
      );
      logger.error('RuntimeEvent is missing formal run routing identity', {
        executionId: this.executionId,
        eventId: envelope.payload.id,
        eventType: envelope.payload.type,
      });
      this.emit('error', error);
      return;
    }

    this.emit('event', { ...envelope, payload: envelope.payload });
  }

  /**
   * 关闭总线，清理所有监听器
   */
  close(): void {
    logger.info(`Closing EventBus for execution ${this.executionId}`);
    this.emit('close');
    this.removeAllListeners();
  }
}
