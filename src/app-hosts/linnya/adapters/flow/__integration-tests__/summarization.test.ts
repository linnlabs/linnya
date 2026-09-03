/**
 * @file 上下文压缩宿主边界测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunnerService } from 'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { createAgentRunnerRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/agentRunnerRuntimeHarness';
import { runtimeKernel } from 'linnkit';
import type { graph } from 'linnkit/runtime-kernel';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { createHistorySummaryEvent, RunIdSchema } from 'linnkit/contracts';
import type { RuntimeEvent } from 'linnkit/contracts';
import type { FlowAgentRunRequest } from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import type { FlowExecutionResult } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { createRunHandleForFlowTest } from 'src/app-hosts/linnya/adapters/flow/__integration-tests__/runHandleTestHarness';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

// Mock dependencies
const mockGraphExecutor = {
  startSession: vi.fn(),
  resumeSession: vi.fn(),
  clearCheckpoint: vi.fn(),
  registerNode: vi.fn(),
};

const mockEventStore = {
  append: vi.fn(),
  listConversations: vi.fn(),
  readMessages: vi.fn(),
  getConversationMetadata: vi.fn(),
  updateTitle: vi.fn(),
  deleteConversation: vi.fn(),
  truncateFromEvent: vi.fn(),
  replace: vi.fn(),
  truncateAndReplace: vi.fn(),
};

const mockKnowledgeBaseService = {
  searchDocuments: vi.fn(),
  getDocument: vi.fn(),
};

const mockDatabaseService = {
  getDb: vi.fn(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeEventCommitPort(value: unknown): value is graph.RuntimeEventCommitPort {
  return typeof value === 'function';
}

function isRuntimeEventSink(value: unknown): value is graph.RuntimeEventSink {
  return typeof value === 'function';
}

describe('上下文压缩宿主边界', () => {
  let agentRunner: AgentRunnerService;
  let runAgent: (runRequest: TestFlowAgentRunRequest) => Promise<FlowExecutionResult>;

  type TestFlowAgentRunRequest = Omit<FlowAgentRunRequest, 'turnId' | 'runHandle' | 'execution'> & {
    turnId?: string;
  };

  const createRunnerHostPorts = (conversationId = 'conv-test') => {
    const sequencer = new runtimeKernel.execution.EventSequencer(conversationId);
    const eventBus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
    const publisher = new runtimeKernel.execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse(`run_${conversationId}`),
      lane: 'foreground',
      visibility: 'conversation',
    });
    return {
      eventBus,
      sequencer,
      realtimeSink: vi.fn(),
      runtimeEventSink: (event: Parameters<typeof publisher.publish>[0], source: string) =>
        publisher.publish(event, source),
      runtimeEventCommitPort: vi.fn().mockResolvedValue(undefined),
      getGeneratedEvents: () => publisher.getGeneratedEvents(),
      drainPersistence: vi.fn().mockResolvedValue(undefined),
    };
  };

  const createHistorySummary = (
    id: string,
    content: string,
    turnId: string,
    options?: {
      timestamp?: number;
      originalMessageCount?: number;
      summarySeq?: number;
    }
  ): RuntimeEvent =>
    createHistorySummaryEvent(
      id,
      'conv-test',
      turnId,
      content,
      [],
      options?.originalMessageCount ?? 0,
      options?.summarySeq ?? 1,
      {
        timestamp: options?.timestamp ?? Date.now(),
      }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });

    agentRunner = new AgentRunnerService(
      mockGraphExecutor as any,
      mockKnowledgeBaseService as any,
      mockDatabaseService as any,
      createAgentRunnerRuntimeHarness()
    );
    runAgent = async runRequest => {
      const turnId = runRequest.turnId ?? 'turn-test';
      const runHandle = await createRunHandleForFlowTest({
        conversationId: runRequest.conversationId,
        turnId,
        request: runRequest.request,
        hostPorts: runRequest.hostPorts,
      });
      return await agentRunner.run({
        ...runRequest,
        turnId,
        runHandle,
        execution: { kind: 'start' },
      });
    };

    // 重置 append mock
    mockEventStore.append.mockResolvedValue('run-123');
    mockGraphExecutor.startSession.mockResolvedValue({
      events: [],
      checkpoint: { nodeId: 'user', local: {} },
      stepCount: 1,
    });
    mockGraphExecutor.clearCheckpoint.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
  });

  describe('1. root durable commit port', () => {
    it('durable commit 与随后 fan-out 应使用同一份 lifecycle-enriched 摘要事实', async () => {
      const hostPorts = createRunnerHostPorts();
      const request: AgentInvokeRequest = {
        query: 'Test root commit port',
        promptKey: 'default',
        maxSteps: 10,
        enableTools: false,
      };

      await runAgent({
        conversationId: 'conv-test',
        request,
        history: [],
        newEvents: [],
        options: {
          activity: { runId: 'activity-run-1', feature: 'table_fill' },
        },
        hostPorts,
      });

      const sessionLocal: unknown = mockGraphExecutor.startSession.mock.calls[0]?.[1];
      if (!isRecord(sessionLocal)) throw new Error('Graph session local 缺失。');
      const commitPort = Reflect.get(sessionLocal, 'runtimeEventCommitPort');
      const eventSink = Reflect.get(sessionLocal, 'runtimeEventSink');
      if (!isRuntimeEventCommitPort(commitPort) || !isRuntimeEventSink(eventSink)) {
        throw new Error('Graph session 缺少上下文压缩事件端口。');
      }

      const summary = createHistorySummary('summary-root', 'Root summary', 'turn-test');
      await commitPort(summary, 'summarization.test');
      const routed = eventSink(summary, 'summarization.test');
      const committedEvent: unknown = hostPorts.runtimeEventCommitPort.mock.calls[0]?.[0];

      expect(committedEvent).toMatchObject({
        id: 'summary-root',
        metadata: {
          activity: { runId: 'activity-run-1', feature: 'table_fill' },
          runtime_trace: expect.objectContaining({ traceId: expect.any(String) }),
        },
      });
      const {
        run_id: runId,
        parent_run_id: parentRunId,
        lane,
        visibility,
        ...publishedFact
      } = routed;
      expect({ runId, parentRunId, lane, visibility }).toMatchObject({
        runId: expect.any(String),
        lane: 'foreground',
        visibility: 'conversation',
      });
      expect(publishedFact).toEqual(committedEvent);
    });
  });

  describe('2. 历史输入边界', () => {
    it('应把超长历史完整交给 Graph', async () => {
      // 模拟超长历史（100条消息）
      const longHistory: RuntimeEvent[] = Array.from({ length: 100 }, (_, i) => {
        if (i % 2 === 0) {
          return {
            type: 'user_input' as const,
            id: `msg-${i}`,
            content: `Message ${i}`,
            conversation_id: 'conv-test',
            timestamp: Date.now() + i * 1000,
            turn_id: `turn-${i}`,
            version: 1,
            source: 'user' as const,
          };
        } else {
          return {
            type: 'final_answer' as const,
            id: `msg-${i}`,
            content: `Message ${i}`,
            conversation_id: 'conv-test',
            timestamp: Date.now() + i * 1000,
            turn_id: `turn-${i}`,
            version: 1,
            answer_id: `ans-${i}`,
            is_complete: true,
            completion_reason: 'terminal' as const,
          };
        }
      });

      const request: AgentInvokeRequest = {
        query: 'New query after long history',
        promptKey: 'default',
        maxSteps: 10,
        enableTools: true,
      };

      await runAgent({
        conversationId: 'conv-test',
        request,
        history: longHistory,
        newEvents: [],
        options: {},
        hostPorts: createRunnerHostPorts(),
      });

      // Graph session 必须按 runId 隔离，同时完整接收历史。
      expect(mockGraphExecutor.startSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          history: longHistory,
        }),
        'user',
        { maxSteps: 10 },
      );
    });

    it('应该处理已有摘要的历史', async () => {
      const historyWithSummary: RuntimeEvent[] = [
        createHistorySummary('summary-1', 'Previous conversation summary', 'turn-0', {
          timestamp: Date.now() - 10000,
          originalMessageCount: 50,
        }),
        {
          type: 'user_input',
          id: 'msg-recent',
          content: 'Recent message',
          conversation_id: 'conv-test',
          timestamp: Date.now(),
          turn_id: 'turn-1',
          version: 1,
          source: 'user',
        },
      ];

      const request: AgentInvokeRequest = {
        query: 'Follow-up question',
        promptKey: 'default',
        maxSteps: 10,
        enableTools: true,
      };

      await runAgent({
        conversationId: 'conv-test',
        request,
        history: historyWithSummary,
        newEvents: [],
        options: {},
        hostPorts: createRunnerHostPorts(),
      });

      // 验证包含摘要的历史被正确传递
      expect(mockGraphExecutor.startSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          history: historyWithSummary,
        }),
        'user',
        { maxSteps: 10 },
      );
    });

    it('应把包含多个摘要的历史完整交给 Graph', async () => {
      const historyWithMultipleSummaries: RuntimeEvent[] = [
        createHistorySummary('summary-old', 'Old summary', 'turn-0', {
          timestamp: Date.now() - 20000,
          originalMessageCount: 30,
          summarySeq: 1,
        }),
        createHistorySummary('summary-new', 'Newer summary', 'turn-1', {
          timestamp: Date.now() - 10000,
          originalMessageCount: 50,
          summarySeq: 2,
        }),
        {
          type: 'user_input',
          id: 'msg-1',
          content: 'Latest message',
          conversation_id: 'conv-test',
          timestamp: Date.now(),
          turn_id: 'turn-2',
          version: 1,
          source: 'user',
        },
      ];

      const request: AgentInvokeRequest = {
        query: 'Test',
        promptKey: 'default',
        maxSteps: 10,
        enableTools: false,
      };

      await runAgent({
        conversationId: 'conv-test',
        request,
        history: historyWithMultipleSummaries,
        newEvents: [],
        options: {},
        hostPorts: createRunnerHostPorts(),
      });

      expect(mockGraphExecutor.startSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          history: historyWithMultipleSummaries,
        }),
        'user',
        { maxSteps: 10 },
      );
    });
  });
});
