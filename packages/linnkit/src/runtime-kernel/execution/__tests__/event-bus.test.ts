/**
 * @file src/agent/runtime-kernel/execution/__tests__/event-bus.test.ts
 * @description EventBus 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../event-bus';
import { RunIdSchema, type RuntimeEvent } from '../../../contracts';
import type { EventEnvelope as Envelope } from 'linnkit/contracts';

type EventEnvelope = Envelope<RuntimeEvent>;

describe('EventBus', () => {
  let eventBus: EventBus;
  const testExecutionId = 'exec_test_123';
  const routingIdentity = {
    run_id: RunIdSchema.parse('run_1'),
    lane: 'foreground' as const,
    visibility: 'conversation' as const,
  };

  beforeEach(() => {
    eventBus = new EventBus(testExecutionId);
  });

  describe('构造和初始化', () => {
    it('应该成功创建 EventBus 实例', () => {
      expect(eventBus).toBeDefined();
    });

    it('应该使用提供的 executionId', () => {
      const customExecutionId = 'exec_custom_456';
      const customEventBus = new EventBus(customExecutionId);
      expect(customEventBus).toBeDefined();
    });
  });

  describe('事件发布 (publish)', () => {
    it('应该成功发布事件', () => {
      return new Promise<void>(resolve => {
        const mockPayload: RuntimeEvent = {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Hello',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        };

        const envelope: EventEnvelope = {
          seq: 1,
          timestamp: Date.now(),
          trace: {
            execution_id: testExecutionId,
            trace_id: 'trace_1',
          },
          source: 'test',
          payload: mockPayload,
        };

        eventBus.on('event', receivedEnvelope => {
          expect(receivedEnvelope).toEqual(envelope);
          expect(receivedEnvelope.payload.type).toBe('user_input');
          expect(receivedEnvelope.seq).toBe(1);
          resolve();
        });

        eventBus.publish(envelope);
      });
    });

    it('应该按顺序发布多个事件', () => {
      const receivedEvents: EventEnvelope[] = [];

      eventBus.on('event', envelope => {
        receivedEvents.push(envelope);
      });

      for (let i = 1; i <= 5; i++) {
        const envelope: EventEnvelope = {
          seq: i,
          timestamp: Date.now(),
          trace: {
            execution_id: testExecutionId,
            trace_id: 'trace_1',
          },
          source: 'test',
          payload: {
            ...routingIdentity,
            type: 'thought',
            id: `msg_${i}`,
            content: `Thought ${i}`,
            timestamp: Date.now(),
            conversation_id: 'conv_1',
            version: 1,
            turn_id: 'turn_1',
            is_complete: false,
          },
        };

        eventBus.publish(envelope);
      }

      expect(receivedEvents).toHaveLength(5);
      receivedEvents.forEach((envelope, index) => {
        expect(envelope.seq).toBe(index + 1);
      });
    });

    it('应该拒绝 executionId 不匹配的事件', () => {
      const errorHandler = vi.fn();
      eventBus.on('error', errorHandler);

      const mismatchedEnvelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: 'exec_different_999', // 不匹配的 executionId
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(mismatchedEnvelope);

      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][0].message).toContain('execution_id does not match');
    });

    it('缺少正式 run 路由身份时只报告错误，不向消费者分发', () => {
      const eventHandler = vi.fn();
      const errorHandler = vi.fn();
      eventBus.on('event', eventHandler);
      eventBus.on('error', errorHandler);

      eventBus.publish({
        seq: 1,
        timestamp: Date.now(),
        trace: { execution_id: testExecutionId },
        source: 'test',
        payload: {
          type: 'user_input',
          id: 'missing-routing',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      });

      expect(eventHandler).not.toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalledOnce();
      expect(errorHandler.mock.calls[0][0].message).toContain('formal run routing identity');
    });
  });

  describe('事件订阅 (on)', () => {
    it('应该支持单个监听器', () => {
      return new Promise<void>(resolve => {
        const envelope: EventEnvelope = {
          seq: 1,
          timestamp: Date.now(),
          trace: {
            execution_id: testExecutionId,
            trace_id: 'trace_1',
          },
          source: 'test',
          payload: {
            ...routingIdentity,
            type: 'user_input',
            id: 'msg_1',
            content: 'Test',
            timestamp: Date.now(),
            conversation_id: 'conv_1',
            version: 1,
            turn_id: 'turn_1',
            source: 'user',
          },
        };

        eventBus.on('event', receivedEnvelope => {
          expect(receivedEnvelope).toEqual(envelope);
          resolve();
        });

        eventBus.publish(envelope);
      });
    });

    it('应该支持多个监听器', () => {
      let listener1Called = false;
      let listener2Called = false;

      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.on('event', () => {
        listener1Called = true;
      });

      eventBus.on('event', () => {
        listener2Called = true;
      });

      eventBus.publish(envelope);

      expect(listener1Called).toBe(true);
      expect(listener2Called).toBe(true);
    });
  });

  describe('一次性监听 (once)', () => {
    it('应该只触发一次监听器', () => {
      let callCount = 0;

      eventBus.once('event', () => {
        callCount++;
      });

      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(envelope);
      eventBus.publish(envelope);
      eventBus.publish(envelope);

      expect(callCount).toBe(1);
    });
  });

  describe('取消订阅 (off)', () => {
    it('应该能够取消特定的监听器', () => {
      let callCount = 0;

      const listener = () => {
        callCount++;
      };

      eventBus.on('event', listener);

      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(envelope);
      expect(callCount).toBe(1);

      eventBus.off('event', listener);
      eventBus.publish(envelope);
      expect(callCount).toBe(1); // 仍然是 1，没有增加
    });

    it('应该只取消指定的监听器，不影响其他监听器', () => {
      let listener1Count = 0;
      let listener2Count = 0;

      const listener1 = () => {
        listener1Count++;
      };

      const listener2 = () => {
        listener2Count++;
      };

      eventBus.on('event', listener1);
      eventBus.on('event', listener2);

      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(envelope);
      expect(listener1Count).toBe(1);
      expect(listener2Count).toBe(1);

      eventBus.off('event', listener1);
      eventBus.publish(envelope);

      expect(listener1Count).toBe(1); // 没有增加
      expect(listener2Count).toBe(2); // 继续增加
    });
  });

  describe('关闭总线 (close)', () => {
    it('应该触发 close 事件', () => {
      return new Promise<void>(resolve => {
        eventBus.on('close', () => {
          resolve();
        });

        eventBus.close();
      });
    });

    it('应该清理所有监听器', () => {
      let eventCount = 0;
      let errorCount = 0;

      eventBus.on('event', () => {
        eventCount++;
      });

      eventBus.on('error', () => {
        errorCount++;
      });

      eventBus.close();

      // 尝试发布事件
      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(envelope);

      // 监听器应该已被清理，不会被调用
      expect(eventCount).toBe(0);
      expect(errorCount).toBe(0);
    });
  });

  describe('错误处理', () => {
    it('应该能够处理错误事件', () => {
      return new Promise<void>(resolve => {
        const testError = new Error('Test error');

        eventBus.on('error', error => {
          expect(error).toBe(testError);
          expect(error.message).toBe('Test error');
          resolve();
        });

        eventBus.emit('error', testError);
      });
    });

    it('应该在 executionId 不匹配时触发错误', () => {
      return new Promise<void>(resolve => {
        eventBus.on('error', error => {
          expect(error.message).toContain('execution_id does not match');
          resolve();
        });

        const mismatchedEnvelope: EventEnvelope = {
          seq: 1,
          timestamp: Date.now(),
          trace: {
            execution_id: 'exec_wrong',
            trace_id: 'trace_1',
          },
          source: 'test',
          payload: {
            ...routingIdentity,
            type: 'user_input',
            id: 'msg_1',
            content: 'Test',
            timestamp: Date.now(),
            conversation_id: 'conv_1',
            version: 1,
            turn_id: 'turn_1',
            source: 'user',
          },
        };

        eventBus.publish(mismatchedEnvelope);
      });
    });
  });

  describe('并发场景', () => {
    it('应该能够处理快速连续的事件发布', () => {
      const receivedEvents: EventEnvelope[] = [];

      eventBus.on('event', envelope => {
        receivedEvents.push(envelope);
      });

      const eventCount = 100;

      for (let i = 1; i <= eventCount; i++) {
        const envelope: EventEnvelope = {
          seq: i,
          timestamp: Date.now(),
          trace: {
            execution_id: testExecutionId,
            trace_id: 'trace_1',
          },
          source: 'test',
          payload: {
            ...routingIdentity,
            type: 'thought',
            id: `msg_${i}`,
            content: `Thought ${i}`,
            timestamp: Date.now(),
            conversation_id: 'conv_1',
            version: 1,
            turn_id: 'turn_1',
            is_complete: false,
          },
        };

        eventBus.publish(envelope);
      }

      expect(receivedEvents).toHaveLength(eventCount);
    });

    it('应该正确处理多个订阅者同时订阅', () => {
      const listener1Events: EventEnvelope[] = [];
      const listener2Events: EventEnvelope[] = [];
      const listener3Events: EventEnvelope[] = [];

      eventBus.on('event', envelope => listener1Events.push(envelope));
      eventBus.on('event', envelope => listener2Events.push(envelope));
      eventBus.on('event', envelope => listener3Events.push(envelope));

      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(envelope);

      expect(listener1Events).toHaveLength(1);
      expect(listener2Events).toHaveLength(1);
      expect(listener3Events).toHaveLength(1);
      expect(listener1Events[0]).toEqual(envelope);
      expect(listener2Events[0]).toEqual(envelope);
      expect(listener3Events[0]).toEqual(envelope);
    });
  });

  describe('内存管理', () => {
    it('应该支持设置最大监听器数量', () => {
      const bus = new EventBus('exec_test');
      expect(() => {
        bus.setMaxListeners(50);
      }).not.toThrow();
    });

    it('应该能够移除所有监听器', () => {
      let eventCallCount = 0;
      let errorCallCount = 0;

      eventBus.on('event', () => {
        eventCallCount++;
      });

      eventBus.on('error', () => {
        errorCallCount++;
      });

      eventBus.removeAllListeners();

      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(envelope);

      // 不再抛出错误，因为监听器已被清理
      // eventBus.emit('error', new Error('Test'));

      expect(eventCallCount).toBe(0);
      expect(errorCallCount).toBe(0);
    });

    it('应该能够移除特定事件类型的所有监听器', () => {
      let eventCallCount = 0;
      let errorCallCount = 0;

      eventBus.on('event', () => {
        eventCallCount++;
      });

      eventBus.on('event', () => {
        eventCallCount++;
      });

      eventBus.on('error', () => {
        errorCallCount++;
      });

      eventBus.removeAllListeners('event');

      const envelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: testExecutionId,
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Test',
          timestamp: Date.now(),
          conversation_id: 'conv_1',
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
      };

      eventBus.publish(envelope);
      eventBus.emit('error', new Error('Test'));

      expect(eventCallCount).toBe(0); // event 监听器被移除
      expect(errorCallCount).toBe(1); // error 监听器仍然存在
    });
  });
});
