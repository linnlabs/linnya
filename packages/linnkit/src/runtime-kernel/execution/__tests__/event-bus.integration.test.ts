/**
 * @file src/agent/runtime-kernel/execution/__tests__/event-bus.integration.test.ts
 * @description 事件总线集成测试 - 验证 EventSequencer + EventBus 的协同工作
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../event-bus';
import { EventSequencer } from '../sequencer';
import type { RuntimeEvent } from '../../../contracts';
import type { EventEnvelope as Envelope } from 'linnkit/contracts';
import { RunIdSchema, ToolCallIdSchema } from '../../../contracts';

type EventEnvelope = Envelope<RuntimeEvent>;

describe('事件总线集成测试', () => {
  const routingIdentity = {
    run_id: RunIdSchema.parse('run_1'),
    lane: 'foreground' as const,
    visibility: 'conversation' as const,
  };
  let eventBus: EventBus;
  let sequencer: EventSequencer;
  let receivedEnvelopes: EventEnvelope[];

  beforeEach(() => {
    receivedEnvelopes = [];
    sequencer = new EventSequencer('conv_1');
    eventBus = new EventBus(sequencer.getExecutionId());

    // 订阅事件
    eventBus.on('event', envelope => {
      receivedEnvelopes.push(envelope);
    });
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  describe('1. 基础事件发布', () => {
    it('应该正确包装和发布事件', () => {
      const event: RuntimeEvent = {
        ...routingIdentity,
        type: 'user_input',
        id: 'msg_1',
        content: 'Hello',
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        source: 'user',
      };

      const envelope = sequencer.wrapEvent(event, 'test');
      eventBus.publish(envelope);

      expect(receivedEnvelopes).toHaveLength(1);
      expect(receivedEnvelopes[0].payload.id).toBe('msg_1');
      expect(receivedEnvelopes[0].seq).toBe(1);
    });

    it('应该为多个事件分配递增序号', () => {
      const events: RuntimeEvent[] = [
        {
          ...routingIdentity,
          type: 'user_input',
          id: 'msg_1',
          content: 'Hello',
          conversation_id: 'conv_1',
          timestamp: Date.now(),
          turn_id: 'turn_1',
          version: 1,
          source: 'user',
        },
        {
          ...routingIdentity,
          type: 'thought',
          id: 'thought_1',
          content: 'Thinking...',
          conversation_id: 'conv_1',
          timestamp: Date.now(),
          turn_id: 'turn_1',
          version: 1,
          is_complete: true,
        },
      ];

      events.forEach(event => {
        const envelope = sequencer.wrapEvent(event, 'test');
        eventBus.publish(envelope);
      });

      expect(receivedEnvelopes).toHaveLength(2);
      expect(receivedEnvelopes[0].seq).toBe(1);
      expect(receivedEnvelopes[1].seq).toBe(2);
    });
  });

  describe('2. 执行上下文验证', () => {
    it('应该拒绝错误 execution_id 的事件', () => {
      const errorHandler = vi.fn();
      eventBus.on('error', errorHandler);

      const event: RuntimeEvent = {
        ...routingIdentity,
        type: 'user_input',
        id: 'msg_1',
        content: 'Hello',
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        source: 'user',
      };

      // 创建带有错误 execution_id 的信封
      const badEnvelope: EventEnvelope = {
        seq: 1,
        timestamp: Date.now(),
        trace: {
          execution_id: 'wrong_execution_id',
          trace_id: 'trace_1',
        },
        source: 'test',
        payload: event,
      };

      eventBus.publish(badEnvelope);

      expect(errorHandler).toHaveBeenCalled();
      expect(receivedEnvelopes).toHaveLength(0); // 事件不应该被发送
    });

    it('应该保留执行上下文', () => {
      const event: RuntimeEvent = {
        ...routingIdentity,
        type: 'tool_call_decision',
        id: 'decision_1',
        tool_name: 'search',
        tool_call_id: ToolCallIdSchema.parse('call_1'),
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        phase: 'start',
        status: 'loading',
        args: { query: 'test' },
      };

      const envelope = sequencer.wrapEvent(event, 'agent-runner');
      eventBus.publish(envelope);

      expect(receivedEnvelopes[0].trace.execution_id).toBe(sequencer.getExecutionId());
      expect(receivedEnvelopes[0].source).toBe('agent-runner');
    });
  });

  describe('3. 事件数据完整性', () => {
    it('应该保留所有事件属性', () => {
      const event: RuntimeEvent = {
        ...routingIdentity,
        type: 'tool_output',
        id: 'output_1',
        tool_name: 'search',
        tool_call_id: ToolCallIdSchema.parse('call_1'),
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        observation: 'found 2 results',
        data: { results: ['result1', 'result2'] },
        status: 'success',
      };

      const envelope = sequencer.wrapEvent(event, 'tool-node');
      eventBus.publish(envelope);

      const received = receivedEnvelopes[0].payload as typeof event;
      expect(received.tool_name).toBe('search');
      expect(received.data).toEqual({ results: ['result1', 'result2'] });
      expect(received.status).toBe('success');
    });

    it('应该支持可选的渲染提示', () => {
      const event: RuntimeEvent = {
        ...routingIdentity,
        type: 'final_answer',
        id: 'answer_1',
        content: 'The answer is 42',
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        answer_id: 'ans_1',
        is_complete: true,
        completion_reason: 'terminal',
      };

      const envelope = sequencer.wrapEvent(event, 'llm-node', {
        renderHint: { content: 'markdown' },
        runLocation: 'backend',
      });
      eventBus.publish(envelope);

      expect(receivedEnvelopes[0].render_hint).toEqual({ content: 'markdown' });
      expect(receivedEnvelopes[0].run_location).toBe('backend');
    });
  });

  describe('4. 多订阅者场景', () => {
    it('应该将事件分发给所有订阅者', () => {
      const subscriber1Events: EventEnvelope[] = [];
      const subscriber2Events: EventEnvelope[] = [];

      eventBus.on('event', envelope => {
        subscriber1Events.push(envelope);
      });

      eventBus.on('event', envelope => {
        subscriber2Events.push(envelope);
      });

      const event: RuntimeEvent = {
        ...routingIdentity,
        type: 'user_input',
        id: 'msg_1',
        content: 'Hello',
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        source: 'user',
      };

      const envelope = sequencer.wrapEvent(event, 'test');
      eventBus.publish(envelope);

      // 原始订阅者 + 两个新订阅者 = 3个
      expect(receivedEnvelopes).toHaveLength(1);
      expect(subscriber1Events).toHaveLength(1);
      expect(subscriber2Events).toHaveLength(1);
    });
  });

  describe('5. 序号管理', () => {
    it('应该保证序号严格递增', () => {
      const events: RuntimeEvent[] = Array.from({ length: 10 }, (_, i) => ({
        ...routingIdentity,
        type: 'thought' as const,
        id: `thought_${i}`,
        content: `Thought ${i}`,
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        is_complete: true,
      }));

      events.forEach(event => {
        const envelope = sequencer.wrapEvent(event, 'test');
        eventBus.publish(envelope);
      });

      // 验证序号
      for (let i = 0; i < 10; i++) {
        expect(receivedEnvelopes[i].seq).toBe(i + 1);
      }
    });

    it('应该返回当前序号', () => {
      expect(sequencer.getCurrentSeq()).toBe(0);

      const event: RuntimeEvent = {
        ...routingIdentity,
        type: 'user_input',
        id: 'msg_1',
        content: 'Hello',
        conversation_id: 'conv_1',
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        source: 'user',
      };

      sequencer.wrapEvent(event, 'test');
      expect(sequencer.getCurrentSeq()).toBe(1);

      sequencer.wrapEvent(event, 'test');
      expect(sequencer.getCurrentSeq()).toBe(2);
    });
  });
});
