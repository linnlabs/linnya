/**
 * @file src/app-hosts/linnya/adapters/flow/__test-helpers__/mocks.ts
 * @description Flow 宿主适配层测试用的 Mock 工厂函数
 */

import { vi } from 'vitest';
import type { runtimeKernel } from 'linnkit';
import type { IEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface';
import type { KnowledgeBaseService } from 'src/features/knowledge-base/application/knowledgeBaseService';
import type { IncrementalEvent } from '@app/schemas';
import type { RuntimeEvent } from 'linnkit/contracts';
import { RuntimeEvent as RuntimeEventSchema } from 'linnkit/contracts';
import type { FlowConversationAdmissionInput } from '../flow.persistence';

type GraphExecutor = runtimeKernel.graph.GraphExecutor;

/**
 * 创建 Mock ChatService（已废弃，保留用于测试兼容性）
 * @deprecated Chat 模式已整合进统一的 Flow 架构
 */
export function createMockChatService() {
  return {
    processConversationStream: vi.fn().mockResolvedValue({
      conversation_id: 'test_conv',
      events: [],
    }),
  };
}

/**
 * 创建 Mock AgentService
 */
export function createMockAgentService() {
  return {
    invoke: vi.fn().mockResolvedValue({
      conversation_id: 'test_conv',
      stepCount: 1,
    }),
    continue: vi.fn().mockResolvedValue(undefined),
    processAndValidateRequest: vi.fn(),
    determineModelId: vi.fn().mockReturnValue('gpt-4'),
  };
}

/**
 * 创建 Mock GraphExecutor
 */
export function createMockGraphExecutor() {
  return {
    prime: vi.fn().mockResolvedValue(undefined),
    runUntilYield: vi.fn().mockResolvedValue({
      events: [],
      stepCount: 1,
    }),
    setNode: vi.fn().mockResolvedValue(undefined),
    registerNode: vi.fn(),
    ephemeralLocals: new Map(),
  } as any as GraphExecutor;
}

/**
 * 创建 Mock EventStore
 * 基于 host EventStore 的 run session 写入接口
 */
export function createMockEventStore() {
  return {
    beginRunSession: vi.fn().mockResolvedValue({
      runId: 'run-12345',
      conversationId: 'test_conv',
      startedAt: Date.now(),
    }) as any,
    openRunSession: vi.fn().mockResolvedValue({
      runId: 'run-12345',
      conversationId: 'test_conv',
      startedAt: Date.now(),
    }) as any,
    appendEventToRun: vi.fn().mockResolvedValue(undefined) as any,
    completeRun: vi.fn().mockResolvedValue(undefined) as any,
    failRun: vi.fn().mockResolvedValue(undefined) as any,

    // 截断和替换操作 (EventStore 核心接口)
    truncateFromEvent: vi.fn().mockResolvedValue({
      found: true,
      deletedEventCount: 0,
      deletedRunCount: 0,
    }) as any,
    replace: vi.fn().mockResolvedValue({
      found: true,
    }) as any,
    truncateAndReplace: vi.fn().mockResolvedValue({
      success: true,
      truncatedCount: 0,
      latestEvents: [],
    }) as any,

    // SQLiteEventStore 扩展方法 (可选)
    ensureConversation: vi.fn().mockResolvedValue(undefined) as any,
    getLatestEvents: vi.fn().mockResolvedValue([]) as any,
  } as any as IEventStore;
}

/**
 * 创建 Mock KnowledgeBaseService
 */
export function createMockKnowledgeBaseService() {
  return {
    search: vi.fn().mockResolvedValue([]) as any,
    addDocument: vi.fn().mockResolvedValue({ success: true }) as any,
  } as any as KnowledgeBaseService;
}

/**
 * 创建 Mock SSESink (捕获所有事件)
 */
export function createMockSSESink() {
  const events: any[] = [];
  const sink = vi.fn((event: any) => {
    events.push(event);
  });

  return {
    sink,
    events,
    getEvents: () => events,
    getEventsByType: (type: string) => events.filter(e => e.type === type),
    clear: () => events.splice(0, events.length),
  };
}

/**
 * 创建 Mock EventPersistenceCoordinator
 */
export function createMockPersistenceCoordinator() {
  const session = {
    runId: 'run-12345',
    conversationId: 'test_conv',
    startedAt: Date.now(),
  };
  return {
    openRunSession: vi.fn().mockResolvedValue(session),
    createExplicitRunSession: vi.fn().mockResolvedValue(session),
    appendEventsToRun: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    withConversationAdmission: vi.fn(
      async function directAdmission<T>(input: FlowConversationAdmissionInput<T>): Promise<T> {
        return input.admitted();
      },
    ),
    getStats: vi.fn().mockReturnValue({
      totalRuns: 0,
      totalEvents: 0,
      successCount: 0,
      failureCount: 0,
      lastPersistAt: Date.now(),
    }),
    resetStats: vi.fn(),
  };
}

/**
 * 创建 Mock HistoryRepository
 */
export function createMockHistoryRepository() {
  return {
    listConversations: vi.fn().mockResolvedValue({
      conversations: [],
      next_cursor: undefined,
      has_more: false,
    }),
    readEvents: vi.fn().mockResolvedValue({
      events: [],
      next_cursor: undefined,
      has_more: false,
      revision: 0,
    }),
    getMetadata: vi.fn().mockResolvedValue(null),
    updateTitle: vi.fn().mockResolvedValue(true),
    deleteConversation: vi.fn().mockResolvedValue(true),
    truncateFromEvent: vi.fn().mockResolvedValue({
      found: true,
      deletedEventCount: 0,
      deletedRunCount: 0,
    }),
    beginRunSession: vi.fn().mockResolvedValue({
      runId: 'run-12345',
      conversationId: 'test_conv',
      startedAt: Date.now(),
    }),
    openRunSession: vi.fn().mockResolvedValue({
      runId: 'run-12345',
      conversationId: 'test_conv',
      startedAt: Date.now(),
    }),
    appendEventToRun: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    readFrom: vi.fn().mockResolvedValue({ events: [], revision: 0 }),
    readForegroundFrom: vi.fn().mockResolvedValue({ events: [], revision: 0 }),
  };
}

/**
 * 生成测试用的对话历史
 */
export function generateConversationHistory(length: number): RuntimeEvent[] {
  const history: RuntimeEvent[] = [];
  const conversationId = `conv_test_${Date.now()}`;

  for (let i = 0; i < length; i++) {
    const isUser = i % 2 === 0;
    history.push(
      RuntimeEventSchema.parse({
        type: isUser ? 'user_input' : 'final_answer',
        id: `msg_${i}`,
        content: `Message ${i}`,
        timestamp: Date.now() + i * 1000,
        conversation_id: conversationId,
        version: 1,
        turn_id: `turn_${Math.floor(i / 2)}`,
        source: isUser ? 'user' : undefined,
      })
    );
  }

  return history;
}

/**
 * 生成用户输入事件
 */
export function generateUserInput(content: string, turnId?: string): IncrementalEvent {
  return {
    type: 'user_input',
    content,
    timestamp: Date.now(),
    source: 'user',
    turn_id: turnId,
  };
}

/**
 * 生成工具输出事件
 */
export function generateToolOutput(
  toolName: string,
  output: string,
  toolCallId: string,
  status: 'success' | 'error' = 'success'
): IncrementalEvent {
  const common = {
    type: 'tool_output' as const,
    tool_name: toolName,
    tool_call_id: toolCallId,
    observation: output,
    timestamp: Date.now(),
  };
  return status === 'success'
    ? { ...common, status, data: {} }
    : { ...common, status, error: output };
}
