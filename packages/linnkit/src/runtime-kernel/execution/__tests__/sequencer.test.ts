/**
 * @file src/agent/runtime-kernel/execution/__tests__/sequencer.test.ts
 * @description EventSequencer 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventSequencer } from '../sequencer';
import type { RuntimeEvent } from '../../../contracts';

describe('EventSequencer', () => {
  let sequencer: EventSequencer;
  const testConversationId = 'conv_test_123';

  beforeEach(() => {
    sequencer = new EventSequencer(testConversationId);
  });

  describe('构造和初始化', () => {
    it('应该成功创建 EventSequencer 实例', () => {
      expect(sequencer).toBeDefined();
      expect(sequencer.getCurrentSeq()).toBe(0);
    });

    it('应该生成唯一的 executionId', () => {
      const sequencer1 = new EventSequencer(testConversationId);
      const sequencer2 = new EventSequencer(testConversationId);
      
      const execId1 = sequencer1.getExecutionId();
      const execId2 = sequencer2.getExecutionId();
      
      expect(execId1).toBeDefined();
      expect(execId2).toBeDefined();
      expect(execId1).not.toBe(execId2);
    });

    it('应该使用提供的 traceId 或生成新的', () => {
      const customTraceId = 'trace_custom_123';
      const sequencerWithTrace = new EventSequencer(testConversationId, customTraceId);
      
      const context = sequencerWithTrace.getExecutionContext();
      expect(context.trace_id).toBe(customTraceId);
    });

    it('应该在未提供 traceId 时自动生成', () => {
      const context = sequencer.getExecutionContext();
      expect(context.trace_id).toBeDefined();
      expect(context.trace_id).toMatch(/^trace/);
    });
  });

  describe('序号管理', () => {
    it('应该从 0 开始分配序号', () => {
      expect(sequencer.getCurrentSeq()).toBe(0);
    });

    it('应该为每个事件分配单调递增的序号', () => {
      const event1: RuntimeEvent = {
        type: 'user_input',
        id: 'msg_1',
        content: 'Hello',
        timestamp: Date.now(),
        conversation_id: testConversationId,
        version: 1,
        turn_id: 'turn_1',
        source: 'user',
      };

      const event2: RuntimeEvent = {
        type: 'thought',
        id: 'msg_2',
        content: 'Thinking...',
        timestamp: Date.now(),
        conversation_id: testConversationId,
        version: 1,
        turn_id: 'turn_1',
        is_complete: false,
      };

      const envelope1 = sequencer.wrapEvent(event1, 'test');
      const envelope2 = sequencer.wrapEvent(event2, 'test');

      expect(envelope1.seq).toBe(1);
      expect(envelope2.seq).toBe(2);
      expect(sequencer.getCurrentSeq()).toBe(2);
    });

    it('应该保证序号的连续性（无跳跃）', () => {
      const seqNumbers: number[] = [];
      
      for (let i = 0; i < 10; i++) {
        const event: RuntimeEvent = {
          type: 'thought',
          id: `msg_${i}`,
          content: `Content ${i}`,
          timestamp: Date.now(),
          conversation_id: testConversationId,
          version: 1,
          turn_id: 'turn_1',
          is_complete: false,
        };
        
        const envelope = sequencer.wrapEvent(event, 'test');
        seqNumbers.push(envelope.seq);
      }

      // 验证序号连续性
      for (let i = 0; i < seqNumbers.length; i++) {
        expect(seqNumbers[i]).toBe(i + 1);
      }
    });
  });

  describe('事件包装', () => {
    const mockEvent: RuntimeEvent = {
      type: 'user_input',
      id: 'msg_test',
      content: 'Test message',
      timestamp: Date.now(),
      conversation_id: testConversationId,
      version: 1,
      turn_id: 'turn_test',
      source: 'user',
    };

    it('应该正确包装事件为 EventEnvelope', () => {
      const envelope = sequencer.wrapEvent(mockEvent, 'test-source');

      expect(envelope.seq).toBe(1);
      expect(envelope.source).toBe('test-source');
      expect(envelope.payload).toEqual(mockEvent);
      expect(envelope.timestamp).toBeDefined();
      expect(envelope.trace).toBeDefined();
      expect(envelope.trace.execution_id).toBe(sequencer.getExecutionId());
    });

    it('应该正确设置执行上下文', () => {
      const envelope = sequencer.wrapEvent(mockEvent, 'test-source');
      const context = sequencer.getExecutionContext();

      expect(envelope.trace.execution_id).toBe(context.execution_id);
      expect(envelope.trace.trace_id).toBe(context.trace_id);
    });

    it('应该支持可选的 renderHint 参数', () => {
      const envelope = sequencer.wrapEvent(mockEvent, 'test-source', {
        renderHint: { content: 'markdown', card: 'normal' },
      });

      expect(envelope.render_hint).toEqual({ content: 'markdown', card: 'normal' });
    });

    it('应该支持可选的 runLocation 参数', () => {
      const envelope = sequencer.wrapEvent(mockEvent, 'test-source', {
        runLocation: 'backend',
      });

      expect(envelope.run_location).toBe('backend');
    });

    it('应该支持同时设置 renderHint 和 runLocation', () => {
      const envelope = sequencer.wrapEvent(mockEvent, 'test-source', {
        renderHint: { content: 'text', card: 'collapsible' },
        runLocation: 'frontend',
      });

      expect(envelope.render_hint).toEqual({ content: 'text', card: 'collapsible' });
      expect(envelope.run_location).toBe('frontend');
    });

    it('应该为每个包装的事件生成新的时间戳', () => {
      const envelope1 = sequencer.wrapEvent(mockEvent, 'test-source');
      
      // 等待一小段时间
      const start = Date.now();
      while (Date.now() - start < 5) {} // 简单的延迟
      
      const envelope2 = sequencer.wrapEvent(mockEvent, 'test-source');

      expect(envelope2.timestamp).toBeGreaterThanOrEqual(envelope1.timestamp);
    });
  });

  describe('执行上下文', () => {
    it('应该返回一致的执行上下文', () => {
      const context1 = sequencer.getExecutionContext();
      const context2 = sequencer.getExecutionContext();

      expect(context1).toEqual(context2);
      expect(context1.execution_id).toBe(context2.execution_id);
      expect(context1.trace_id).toBe(context2.trace_id);
    });

    it('应该在所有包装的事件中使用相同的执行上下文', () => {
      const event1: RuntimeEvent = {
        type: 'user_input',
        id: 'msg_1',
        content: 'Hello',
        timestamp: Date.now(),
        conversation_id: testConversationId,
        version: 1,
        turn_id: 'turn_1',
        source: 'user',
      };

      const event2: RuntimeEvent = {
        type: 'thought',
        id: 'msg_2',
        content: 'Thinking',
        timestamp: Date.now(),
        conversation_id: testConversationId,
        version: 1,
        turn_id: 'turn_1',
        is_complete: false,
      };

      const envelope1 = sequencer.wrapEvent(event1, 'source1');
      const envelope2 = sequencer.wrapEvent(event2, 'source2');

      expect(envelope1.trace.execution_id).toBe(envelope2.trace.execution_id);
      expect(envelope1.trace.trace_id).toBe(envelope2.trace.trace_id);
    });
  });

  describe('边界条件', () => {
    it('应该能够处理大量事件', () => {
      const eventCount = 1000;
      
      for (let i = 0; i < eventCount; i++) {
        const event: RuntimeEvent = {
          type: 'thought',
          id: `msg_${i}`,
          content: `Content ${i}`,
          timestamp: Date.now(),
          conversation_id: testConversationId,
          version: 1,
          turn_id: 'turn_1',
          is_complete: false,
        };
        
        sequencer.wrapEvent(event, 'test');
      }

      expect(sequencer.getCurrentSeq()).toBe(eventCount);
    });

    it('应该正确处理包含特殊字符的事件内容', () => {
      const specialContent = 'Test with 中文, emoji 🚀, and symbols @#$%';
      const event: RuntimeEvent = {
        type: 'user_input',
        id: 'msg_special',
        content: specialContent,
        timestamp: Date.now(),
        conversation_id: testConversationId,
        version: 1,
        turn_id: 'turn_1',
        source: 'user',
      };

      const envelope = sequencer.wrapEvent(event, 'test');
      if (envelope.payload.type === 'user_input') {
        expect(envelope.payload.content).toBe(specialContent);
      }
    });

    it('应该正确处理空字符串内容', () => {
      const event: RuntimeEvent = {
        type: 'user_input',
        id: 'msg_empty',
        content: '',
        timestamp: Date.now(),
        conversation_id: testConversationId,
        version: 1,
        turn_id: 'turn_1',
        source: 'user',
      };

      const envelope = sequencer.wrapEvent(event, 'test');
      if (envelope.payload.type === 'user_input') {
        expect(envelope.payload.content).toBe('');
      }
    });
  });

  describe('多实例隔离', () => {
    it('不同的 sequencer 实例应该有独立的序号计数', () => {
      const sequencer1 = new EventSequencer('conv_1');
      const sequencer2 = new EventSequencer('conv_2');

      const event: RuntimeEvent = {
        type: 'user_input',
        id: 'msg_test',
        content: 'Test',
        timestamp: Date.now(),
        conversation_id: 'conv_test',
        version: 1,
        turn_id: 'turn_1',
        source: 'user',
      };

      const envelope1 = sequencer1.wrapEvent(event, 'test');
      const envelope2 = sequencer1.wrapEvent(event, 'test');
      const envelope3 = sequencer2.wrapEvent(event, 'test');

      expect(envelope1.seq).toBe(1);
      expect(envelope2.seq).toBe(2);
      expect(envelope3.seq).toBe(1); // sequencer2 从 1 开始
    });

    it('不同的 sequencer 实例应该有不同的 executionId', () => {
      const sequencer1 = new EventSequencer('conv_1');
      const sequencer2 = new EventSequencer('conv_1'); // 相同的 conversationId

      const event: RuntimeEvent = {
        type: 'user_input',
        id: 'msg_test',
        content: 'Test',
        timestamp: Date.now(),
        conversation_id: 'conv_test',
        version: 1,
        turn_id: 'turn_1',
        source: 'user',
      };

      const envelope1 = sequencer1.wrapEvent(event, 'test');
      const envelope2 = sequencer2.wrapEvent(event, 'test');

      expect(envelope1.trace.execution_id).not.toBe(envelope2.trace.execution_id);
    });
  });
});
