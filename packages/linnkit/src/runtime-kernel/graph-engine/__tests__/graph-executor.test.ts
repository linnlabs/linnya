/**
 * @file src/core/graph-engine/__tests__/graph-executor.test.ts
 * @description GraphExecutor 核心单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphExecutor } from '../engine';
import type { Checkpointer } from '../checkpointer/base';
import { MemoryCheckpointer } from '../checkpointer/memoryCheckpointer';
import type { EngineState, GraphNode, NodeResult } from '../types';
import { createThoughtEvent, routeRuntimeEvent, RunIdSchema } from '../../../contracts';
import { EventBus, EventSequencer, RuntimeEventPublisher } from '../../execution';

function createRoutedTestEvent(id: string) {
  return routeRuntimeEvent(
    createThoughtEvent(id, 'conv_test', 'turn_test', id, { is_complete: true }),
    { run_id: 'run_test', lane: 'foreground', visibility: 'conversation' }
  );
}

function createRuntimeEventSink() {
  const sequencer = new EventSequencer('conv_test');
  const eventBus = new EventBus(sequencer.getExecutionId());
  const publisher = new RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('run_test'),
    lane: 'foreground',
    visibility: 'conversation',
  });
  return (event: Parameters<typeof routeRuntimeEvent>[0], source: string) =>
    publisher.publish(event, source);
}

async function nextTask(): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}

describe('GraphExecutor - 核心单元测试', () => {
  let mockCheckpointer: Checkpointer;
  let executor: GraphExecutor;

  beforeEach(() => {
    mockCheckpointer = {
      save: vi.fn<Checkpointer['save']>().mockResolvedValue(undefined),
      load: vi.fn<Checkpointer['load']>().mockResolvedValue(null),
      clear: vi.fn<Checkpointer['clear']>().mockResolvedValue(undefined),
    };

    executor = new GraphExecutor(mockCheckpointer, { maxSteps: 10 });
  });

  describe('1. 基础功能测试', () => {
    it('应该正确注册和执行节点', async () => {
      const mockNode: GraphNode = {
        id: 'test',
        run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
      };

      executor.registerNode(mockNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: {},
      });

      await executor.runUntilYield('conv_1');

      expect(mockNode.run).toHaveBeenCalled();
    });

    it('应该在 prime 时设置初始状态', async () => {
      const initialLocal = { stepCount: 0, userId: '123' };

      await executor.prime('conv_1', initialLocal, 'user');

      expect(mockCheckpointer.save).toHaveBeenCalledWith('conv_1', {
        nodeId: 'user',
        local: { stepCount: 0, userId: '123' },
        revision: 1,
        schemaVersion: 1,
      });
    });

    it('应该在 prime 时移除不可 checkpoint 的运行时引用', async () => {
      await executor.prime(
        'conv_1',
        {
          memory: {},
          stepCount: 0,
          signal: new AbortController().signal,
          runtimeEventSink: () => undefined,
          summarizationCallbacks: { onSummarizationStart: () => undefined },
          toolContext: { runId: 'run-1' },
        },
        'user'
      );

      const saveCall = vi.mocked(mockCheckpointer.save).mock.calls[0];
      expect(saveCall[1].local).not.toHaveProperty('memory');
      expect(saveCall[1].local).not.toHaveProperty('signal');
      expect(saveCall[1].local).not.toHaveProperty('runtimeEventSink');
      expect(saveCall[1].local).not.toHaveProperty('summarizationCallbacks');
      expect(saveCall[1].local).not.toHaveProperty('toolContext');
      expect(saveCall[1].local).toMatchObject({ stepCount: 0 });
    });

    it('应该正确使用 setNode 切换节点', async () => {
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'user',
        local: { stepCount: 1 },
      });

      await executor.setNode('conv_1', 'llm');

      expect(mockCheckpointer.save).toHaveBeenCalledWith('conv_1', {
        nodeId: 'llm',
        local: { stepCount: 1 },
        revision: 1,
        schemaVersion: 1,
      });
    });
  });

  describe('2. 执行循环测试', () => {
    it('应该正确执行单步路由', async () => {
      const userNode: GraphNode = {
        id: 'user',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'llm',
          events: [createRoutedTestEvent('user_input')],
        }),
      };
      const llmNode: GraphNode = {
        id: 'llm',
        run: vi.fn().mockResolvedValue({
          kind: 'yield',
          events: [createRoutedTestEvent('final_answer')],
        }),
      };

      executor.registerNode(userNode);
      executor.registerNode(llmNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'user',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.events).toHaveLength(2);
      expect(result.stepCount).toBe(2);
    });

    it('应该支持多步路由链', async () => {
      const nodes = ['node1', 'node2', 'node3'].map((id, i) => ({
        id,
        run: vi.fn().mockResolvedValue({
          kind: i === 2 ? 'yield' : 'route',
          nextNodeId: `node${i + 2}`,
          events: [createRoutedTestEvent(`event${i + 1}`)],
        }),
      }));

      nodes.forEach(n => executor.registerNode(n));

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'node1',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(3);
      expect(result.events).toHaveLength(3);
    });

    it('应该在 yield 时正确暂停', async () => {
      const node: GraphNode = {
        id: 'wait',
        run: vi.fn().mockResolvedValue({
          kind: 'yield',
          events: [createRoutedTestEvent('waiting')],
        }),
      };

      executor.registerNode(node);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'wait',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(1);
      expect(result.events).toHaveLength(1);
      expect(result.checkpoint.nodeId).toBe('wait');
    });

    it('终端返回的 checkpoint 应与持久化快照一致并剥离运行时引用', async () => {
      const node: GraphNode = {
        id: 'wait',
        run: vi.fn().mockResolvedValue({
          kind: 'yield',
          events: [],
        }),
      };

      executor.registerNode(node);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'wait',
        local: {
          signal: new AbortController().signal,
          toolContext: { runId: RunIdSchema.parse('run-1') },
          retained: 'value',
        },
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.checkpoint.local).toMatchObject({ retained: 'value' });
      expect(result.checkpoint.local).not.toHaveProperty('signal');
      expect(result.checkpoint.local).not.toHaveProperty('toolContext');
      const saveCalls = vi.mocked(mockCheckpointer.save).mock.calls;
      const lastSaveCall = saveCalls[saveCalls.length - 1];
      if (!lastSaveCall) {
        throw new Error('expected checkpoint save');
      }
      expect(lastSaveCall[1]).toBe(result.checkpoint);
    });

    it('应该在 pause 时正确暂停', async () => {
      const node: GraphNode = {
        id: 'wait-user',
        run: vi.fn().mockResolvedValue({
          kind: 'pause',
          events: [createRoutedTestEvent('waiting_user')],
        }),
      };

      executor.registerNode(node);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'wait-user',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(1);
      expect(result.checkpoint.nodeId).toBe('wait-user');
    });

    it('应该累积所有节点产生的事件', async () => {
      const node1: GraphNode = {
        id: 'node1',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'node2',
          events: [createRoutedTestEvent('event1'), createRoutedTestEvent('event2')],
        }),
      };
      const node2: GraphNode = {
        id: 'node2',
        run: vi.fn().mockResolvedValue({
          kind: 'yield',
          events: [createRoutedTestEvent('event3')],
        }),
      };

      executor.registerNode(node1);
      executor.registerNode(node2);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'node1',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.events).toHaveLength(3);
    });

    it('应该准确记录执行的步数', async () => {
      const nodes = [1, 2, 3, 4, 5].map(i => ({
        id: `node${i}`,
        run: vi.fn().mockResolvedValue({
          kind: i === 5 ? 'yield' : 'route',
          nextNodeId: `node${i + 1}`,
          events: [],
        }),
      }));

      nodes.forEach(n => executor.registerNode(n));

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'node1',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(5);
    });

    it('应该在达到 maxSteps 时停止执行', async () => {
      const loopNode: GraphNode = {
        id: 'loop',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'loop',
          events: [createRoutedTestEvent('loop_event')],
        }),
      };

      executor.registerNode(loopNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'loop',
        local: {
          conversationId: 'conv_budget_loop',
          turnId: 'turn_budget_loop',
          runtimeEventSink: createRuntimeEventSink(),
        },
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(10);
      expect(loopNode.run).toHaveBeenCalledTimes(10);
    });

    it('应该支持自定义 maxSteps', async () => {
      const customExecutor = new GraphExecutor(mockCheckpointer, { maxSteps: 3 });

      const loopNode: GraphNode = {
        id: 'loop',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'loop',
          events: [],
        }),
      };

      customExecutor.registerNode(loopNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'loop',
        local: {
          conversationId: 'conv_custom_budget',
          turnId: 'turn_custom_budget',
          runtimeEventSink: createRuntimeEventSink(),
        },
      });

      const result = await customExecutor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(3);
    });

    it('共享 executor 应按 session 覆盖步数预算并据此上报 lifecycle', async () => {
      const emit = vi.fn();
      const sessionExecutor = new GraphExecutor(new MemoryCheckpointer(), {
        maxSteps: 10,
        telemetryPort: { emit },
      });
      const loopNode: GraphNode = {
        id: 'loop',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'loop',
          events: [],
        }),
      };
      sessionExecutor.registerNode(loopNode);

      const result = await sessionExecutor.startSession(
        'run_session_budget',
        {
          conversationId: 'conv_session_budget',
          turnId: 'turn_session_budget',
          runtimeEventSink: createRuntimeEventSink(),
        },
        'loop',
        { maxSteps: 3 },
      );

      expect(result.stepCount).toBe(3);
      expect(loopNode.run).toHaveBeenCalledTimes(3);
      expect(result.events).toEqual([
        expect.objectContaining({
          type: 'error',
          error_code: 'engine.budget_exhausted',
          details: { maxSteps: 3, stepCount: 3 },
        }),
      ]);
      const terminalLifecycle = emit.mock.calls
        .map(call => call[0])
        .find(event => event.kind === 'run_lifecycle' && event.phase === 'completed');
      expect(terminalLifecycle).toMatchObject({
        stepsUsed: 3,
        maxSteps: 3,
        terminalReason: 'step_budget_exhausted',
      });
    });

    it('maxSteps 预算真正耗尽时应发出 ENGINE_BUDGET_EXHAUSTED error event', async () => {
      const budgetExecutor = new GraphExecutor(mockCheckpointer, { maxSteps: 2 });
      const loopNode: GraphNode = {
        id: 'loop',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'loop',
          events: [],
        }),
      };
      const llmNode: GraphNode = {
        id: 'llm',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'llm',
          events: [],
        }),
      };

      budgetExecutor.registerNode(loopNode);
      budgetExecutor.registerNode(llmNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'loop',
        local: {
          conversationId: 'conv_budget',
          turnId: 'turn_budget',
          runtimeEventSink: createRuntimeEventSink(),
        },
      });

      const result = await budgetExecutor.runUntilYield('conv_1');
      const errorEvents = result.events.filter(event => event.type === 'error');

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        conversation_id: 'conv_budget',
        turn_id: 'turn_budget',
        error_code: 'engine.budget_exhausted',
        retryable: false,
        details: {
          maxSteps: 2,
          stepCount: 2,
        },
      });
    });
  });

  describe('3. 状态管理测试', () => {
    it('应该正确加载已保存的状态', async () => {
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'saved',
        local: { count: 5 },
      });

      const node: GraphNode = {
        id: 'saved',
        run: vi.fn(state => {
          expect(state.local?.count).toBe(5);
          return Promise.resolve({ kind: 'yield', events: [] } satisfies NodeResult);
        }),
      };

      executor.registerNode(node);
      await executor.runUntilYield('conv_1');

      expect(node.run).toHaveBeenCalled();
    });

    it('应该正确合并 checkpoint 和 ephemeral 状态', async () => {
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: { persistent: 'data', count: 1 },
      });

      await executor.prime('conv_1', { memory: { temp: 'data' }, count: 2 }, 'test');

      const node: GraphNode = {
        id: 'test',
        run: vi.fn(state => {
          expect(state.local?.count).toBe(2); // ephemeral 覆盖
          expect(state.local?.persistent).toBe('data'); // persistent 保留
          expect(state.local?.memory).toBeDefined(); // memory 存在
          return Promise.resolve({ kind: 'yield', events: [] } satisfies NodeResult);
        }),
      };

      executor.registerNode(node);
      await executor.runUntilYield('conv_1');

      expect(node.run).toHaveBeenCalled();
    });

    it('同 checkpointKey 的并发 runUntilYield 应串行执行，避免 ephemeral/checkpoint 交错', async () => {
      const serialExecutor = new GraphExecutor(mockCheckpointer, { maxSteps: 10 });
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: {},
      });

      let activeRuns = 0;
      let maxActiveRuns = 0;
      let releaseFirstRun!: () => void;
      const firstRunCanFinish = new Promise<void>(resolve => {
        releaseFirstRun = resolve;
      });
      const node: GraphNode = {
        id: 'test',
        run: vi.fn(async () => {
          activeRuns++;
          maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
          if (activeRuns === 1) {
            await firstRunCanFinish;
          }
          activeRuns--;
          return { kind: 'yield', events: [] } satisfies NodeResult;
        }),
      };
      serialExecutor.registerNode(node);

      const firstRun = serialExecutor.runUntilYield('shared-checkpoint');
      await nextTask();
      const secondRun = serialExecutor.runUntilYield('shared-checkpoint');
      await nextTask();

      expect(node.run).toHaveBeenCalledTimes(1);
      releaseFirstRun();

      await Promise.all([firstRun, secondRun]);

      expect(node.run).toHaveBeenCalledTimes(2);
      expect(maxActiveRuns).toBe(1);
    });

    it('不同 checkpointKey 的 runUntilYield 不应被同一把锁阻塞', async () => {
      const parallelExecutor = new GraphExecutor(mockCheckpointer, { maxSteps: 10 });
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: {},
      });

      let activeRuns = 0;
      let maxActiveRuns = 0;
      let releaseRuns!: () => void;
      const runsCanFinish = new Promise<void>(resolve => {
        releaseRuns = resolve;
      });
      const node: GraphNode = {
        id: 'test',
        run: vi.fn(async () => {
          activeRuns++;
          maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
          await runsCanFinish;
          activeRuns--;
          return { kind: 'yield', events: [] } satisfies NodeResult;
        }),
      };
      parallelExecutor.registerNode(node);

      const firstRun = parallelExecutor.runUntilYield('checkpoint-a');
      await nextTask();
      const secondRun = parallelExecutor.runUntilYield('checkpoint-b');
      await nextTask();

      expect(node.run).toHaveBeenCalledTimes(2);
      releaseRuns();
      await Promise.all([firstRun, secondRun]);

      expect(maxActiveRuns).toBe(2);
    });

    it('startSession 应原子保护初始化与执行，拒绝第二个 run 覆盖同一 checkpoint', async () => {
      const stored = new Map<string, EngineState>();
      const checkpointer: Checkpointer = {
        load: vi.fn(async key => stored.get(key) ?? null),
        save: vi.fn(async (key, state) => {
          stored.set(key, structuredClone(state));
        }),
        clear: vi.fn(async key => {
          stored.delete(key);
        }),
      };
      const sessionExecutor = new GraphExecutor(checkpointer, { maxSteps: 10 });
      let releaseFirst!: () => void;
      const firstCanFinish = new Promise<void>(resolve => {
        releaseFirst = resolve;
      });
      const observedOwners: string[] = [];
      sessionExecutor.registerNode({
        id: 'test',
        run: vi.fn(async (state: EngineState) => {
          observedOwners.push(String(state.local?.owner));
          await firstCanFinish;
          return { kind: 'yield', events: [] } satisfies NodeResult;
        }),
      });

      const first = sessionExecutor.startSession('shared-run', { owner: 'foreground' }, 'test');
      await nextTask();
      const second = sessionExecutor.startSession('shared-run', { owner: 'title' }, 'test');
      await nextTask();

      expect(observedOwners).toEqual(['foreground']);
      releaseFirst();
      await expect(first).resolves.toMatchObject({
        checkpoint: { local: { owner: 'foreground' } },
      });
      await expect(second).rejects.toThrow('Graph checkpoint already exists');
      expect(observedOwners).toEqual(['foreground']);
    });

    it('resumeSession 应只接受 wait_user 的当前 revision，并保留原 run 状态', async () => {
      const stored = new Map<string, EngineState>();
      const checkpointer: Checkpointer = {
        load: vi.fn(async key => stored.get(key) ?? null),
        save: vi.fn(async (key, state) => {
          stored.set(key, structuredClone(state));
        }),
        clear: vi.fn(async key => {
          stored.delete(key);
        }),
      };
      stored.set('run-hitl', {
        nodeId: 'wait_user',
        revision: 4,
        local: { conversationId: 'conversation-1', history: [] },
      });
      const sessionExecutor = new GraphExecutor(checkpointer, { maxSteps: 10 });
      sessionExecutor.registerNode({
        id: 'llm',
        run: vi.fn(async (state: EngineState) => {
          expect(state.local?.conversationId).toBe('conversation-1');
          expect(state.local?.newEvents).toEqual([{ type: 'tool_output' }]);
          expect(state.local?.executorLocal).toMatchObject({
            maxSteps: 3,
            stepCount: 1,
            remainingSteps: 2,
          });
          return { kind: 'yield', events: [] } satisfies NodeResult;
        }),
      });

      await expect(
        sessionExecutor.resumeSession('run-hitl', {
          expectedRevision: 4,
          localPatch: { newEvents: [{ type: 'tool_output' }] },
          maxSteps: 3,
        })
      ).resolves.toMatchObject({ checkpoint: { nodeId: 'llm' } });

      await expect(
        sessionExecutor.resumeSession('run-hitl', {
          expectedRevision: 4,
          localPatch: { newEvents: [{ type: 'tool_output' }] },
        })
      ).rejects.toThrow('revision conflict');
    });

    it('wait-user resume 保留同一 run 的上下文压缩进度，并采用本 execution 的新策略', async () => {
      const checkpointer = new MemoryCheckpointer();
      const sessionExecutor = new GraphExecutor(checkpointer, { maxSteps: 10 });
      const initialExecutorLocal = {
        stepCount: 0,
        finalStepPolicy: 'final_answer' as const,
        finalStepForcedTools: ['old-tool'],
        runLockedModelId: 'old-model',
        contextCompaction: {
          attemptCount: 3,
          committedCount: 2,
          lastCommittedFingerprint: 'compaction-before-wait',
        },
      };

      sessionExecutor.registerNode({
        id: 'wait_user',
        run: async () => ({ kind: 'pause', events: [] }),
      });
      sessionExecutor.registerNode({
        id: 'llm',
        run: async (state: EngineState) => {
          expect(state.local?.executorLocal).toMatchObject({
            finalStepPolicy: 'force_tools',
            finalStepForcedTools: ['new-tool'],
            systemReminderPolicy: {
              enabledRuleIds: ['last_steps'],
            },
            contextCompaction: {
              attemptCount: 3,
              committedCount: 2,
              lastCommittedFingerprint: 'compaction-before-wait',
            },
          });
          expect(state.local?.executorLocal).not.toHaveProperty('runLockedModelId');
          return { kind: 'yield', events: [] } satisfies NodeResult;
        },
      });

      const started = await sessionExecutor.startSession('run-context-compaction-resume', {
        conversationId: 'conversation-1',
        executorLocal: initialExecutorLocal,
      }, 'wait_user');
      expect(started.checkpoint.local?.executorLocal?.contextCompaction).toEqual(
        initialExecutorLocal.contextCompaction,
      );

      const resumed = await sessionExecutor.resumeSession('run-context-compaction-resume', {
        expectedRevision: started.checkpoint.revision ?? 0,
        localPatch: {
          executorLocal: {
            stepCount: 0,
            finalStepPolicy: 'force_tools',
            finalStepForcedTools: ['new-tool'],
            systemReminderPolicy: {
              enabledRuleIds: ['last_steps'],
            },
          },
        },
      });

      expect(resumed.checkpoint.local?.executorLocal).toMatchObject({
        finalStepPolicy: 'force_tools',
        finalStepForcedTools: ['new-tool'],
        contextCompaction: initialExecutorLocal.contextCompaction,
      });
      expect(resumed.checkpoint.local?.executorLocal).not.toHaveProperty('runLockedModelId');
    });

    it('进入 llm 节点时应显式标记首次调用与续跑调用', async () => {
      const llmInvocationStates: Array<Record<string, unknown>> = [];
      const userNode: GraphNode = {
        id: 'user',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'llm',
          events: [],
        }),
      };
      const llmNode: GraphNode = {
        id: 'llm',
        run: vi.fn((state: EngineState) => {
          const executorLocal = state.local?.executorLocal;
          llmInvocationStates.push({
            stepCount: executorLocal?.stepCount,
            llmInvocationKind: executorLocal?.llmInvocationKind,
            llmInvocationCount: executorLocal?.llmInvocationCount,
          });
          return Promise.resolve({
            kind: llmInvocationStates.length === 1 ? 'route' : 'yield',
            nextNodeId: llmInvocationStates.length === 1 ? 'tool' : undefined,
            events: [],
          } satisfies NodeResult);
        }),
      };
      const toolNode: GraphNode = {
        id: 'tool',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'llm',
          events: [],
        }),
      };

      executor.registerNode(userNode);
      executor.registerNode(llmNode);
      executor.registerNode(toolNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'user',
        local: {},
      });

      await executor.runUntilYield('conv_1');

      expect(llmInvocationStates).toEqual([
        {
          stepCount: 2,
          llmInvocationKind: 'user_initiated',
          llmInvocationCount: 1,
        },
        {
          stepCount: 4,
          llmInvocationKind: 'continuation',
          llmInvocationCount: 2,
        },
      ]);
    });

    it('直接从 llm 节点启动时，第一次 LLM 调用仍应是 user_initiated', async () => {
      const llmInvocationStates: Array<Record<string, unknown>> = [];
      const llmNode: GraphNode = {
        id: 'llm',
        run: vi.fn((state: EngineState) => {
          const executorLocal = state.local?.executorLocal;
          llmInvocationStates.push({
            stepCount: executorLocal?.stepCount,
            llmInvocationKind: executorLocal?.llmInvocationKind,
            llmInvocationCount: executorLocal?.llmInvocationCount,
          });
          return Promise.resolve({ kind: 'yield', events: [] } satisfies NodeResult);
        }),
      };

      executor.registerNode(llmNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'llm',
        local: {},
      });

      await executor.runUntilYield('child_run_checkpoint');

      expect(llmInvocationStates).toEqual([
        {
          stepCount: 1,
          llmInvocationKind: 'user_initiated',
          llmInvocationCount: 1,
        },
      ]);
    });
  });

  describe('4. 错误处理', () => {
    it('节点绕过 admission 返回草稿事实时立即拒绝写入 journal', async () => {
      const node: GraphNode = {
        id: 'draft-producer',
        run: vi.fn().mockResolvedValue({
          kind: 'yield',
          events: [
            createThoughtEvent('draft-event', 'conv_test', 'turn_test', 'unpublished', {
              is_complete: true,
            }),
          ],
        }),
      };
      executor.registerNode(node);
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'draft-producer',
        local: {},
      });

      await expect(executor.runUntilYield('run_test')).rejects.toThrow(
        'Graph node returned an event before run admission: draft-event'
      );
    });

    it('应该在没有可执行节点时正确返回', async () => {
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'nonexistent',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.events).toEqual([]);
      expect(result.stepCount).toBe(1);
    });

    it('应该在路由到不存在的节点时停止', async () => {
      const node: GraphNode = {
        id: 'start',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          nextNodeId: 'nonexistent',
          events: [createRoutedTestEvent('routed')],
        }),
      };

      executor.registerNode(node);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'start',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(2);
      expect(result.events).toHaveLength(1);
    });

    it('应该传播节点执行错误', async () => {
      const testError = new Error('Node execution failed');
      const node: GraphNode = {
        id: 'failing',
        run: vi.fn().mockRejectedValue(testError),
      };

      executor.registerNode(node);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'failing',
        local: {},
      });

      await expect(executor.runUntilYield('conv_1')).rejects.toThrow('Node execution failed');
    });

    it('应该传播 checkpointer.save 错误', async () => {
      const saveError = new Error('Save failed');
      vi.mocked(mockCheckpointer.save).mockRejectedValue(saveError);

      await expect(executor.prime('conv_1', {}, 'test')).rejects.toThrow('Save failed');
    });

    it('应该传播 checkpointer.load 错误', async () => {
      const loadError = new Error('Load failed');
      vi.mocked(mockCheckpointer.load).mockRejectedValue(loadError);

      await expect(executor.runUntilYield('conv_1')).rejects.toThrow('Load failed');
    });

    it('应该处理 route 没有 nextNodeId 的情况', async () => {
      const testNode: GraphNode = {
        id: 'test',
        run: vi.fn().mockResolvedValue({
          kind: 'route',
          // nextNodeId 缺失，引擎会使用默认值 'user'
          events: [],
        }),
      };
      const userNode: GraphNode = {
        id: 'user',
        run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
      };

      executor.registerNode(testNode);
      executor.registerNode(userNode);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: {},
      });

      const result = await executor.runUntilYield('conv_1');

      expect(result.stepCount).toBe(2);
    });
  });

  describe('5. B2-engine Batch 3: graph_node telemetry', () => {
    it('每次 node.run 都会 emit 一次 graph_node 事件，含 nodeId/durationMs/scope', async () => {
      const emit = vi.fn();
      const telemetryExecutor = new GraphExecutor(mockCheckpointer, {
        maxSteps: 10,
        telemetryPort: { emit },
      });

      const node: GraphNode = {
        id: 'test',
        run: vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 5));
          return { kind: 'yield', events: [] } as NodeResult;
        }),
      };
      telemetryExecutor.registerNode(node);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: {
          conversationId: 'runtime_conversation',
          runId: 'run_real_1',
          parentRunId: 'run_parent_1',
          turnId: 'turn_x',
        },
      } as EngineState);

      await telemetryExecutor.runUntilYield('checkpoint_telemetry');

      const graphNodeEvents = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'graph_node');
      expect(graphNodeEvents).toHaveLength(1);
      const event = graphNodeEvents[0];
      expect(event.nodeId).toBe('test');
      expect(typeof event.durationMs).toBe('number');
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(event.scope).toEqual({
        conversationId: 'runtime_conversation',
        runId: 'run_real_1',
        parentRunId: 'run_parent_1',
        turnId: 'turn_x',
      });
    });

    it('多步路由：每次 node 切换都各自 emit graph_node', async () => {
      const emit = vi.fn();
      const telemetryExecutor = new GraphExecutor(mockCheckpointer, {
        maxSteps: 10,
        telemetryPort: { emit },
      });

      const start: GraphNode = {
        id: 'start',
        run: vi.fn().mockResolvedValue({ kind: 'route', nextNodeId: 'end', events: [] }),
      };
      const end: GraphNode = {
        id: 'end',
        run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
      };
      telemetryExecutor.registerNode(start);
      telemetryExecutor.registerNode(end);

      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'start',
        local: {},
      } as EngineState);

      await telemetryExecutor.runUntilYield('conv_multi');

      const graphNodeEvents = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'graph_node');
      expect(graphNodeEvents).toHaveLength(2);
      expect(graphNodeEvents[0].nodeId).toBe('start');
      expect(graphNodeEvents[1].nodeId).toBe('end');
    });

    it('node.run 抛错时仍然 emit graph_node（try/finally 兜底）', async () => {
      const emit = vi.fn();
      const telemetryExecutor = new GraphExecutor(mockCheckpointer, {
        maxSteps: 10,
        telemetryPort: { emit },
      });

      const exploding: GraphNode = {
        id: 'boom',
        run: vi.fn().mockRejectedValue(new Error('boom')),
      };
      telemetryExecutor.registerNode(exploding);
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'boom',
        local: {},
      } as EngineState);

      await expect(telemetryExecutor.runUntilYield('conv_boom')).rejects.toThrow('boom');
      const graphNodeEvents = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'graph_node');
      expect(graphNodeEvents).toHaveLength(1);
      expect(graphNodeEvents[0]).toMatchObject({ kind: 'graph_node', nodeId: 'boom' });
    });

    it('未传 telemetryPort 时使用 noopTelemetry，不影响行为', async () => {
      // 已经在 beforeEach 中创建的默认 executor 跑通即可
      const node: GraphNode = {
        id: 'test',
        run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
      };
      executor.registerNode(node);
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: {},
      } as EngineState);

      await expect(executor.runUntilYield('conv_default')).resolves.toBeDefined();
    });
  });

  describe('6. B2-engine Batch 4: run_lifecycle telemetry', () => {
    function createEmittingExecutor(emit: ReturnType<typeof vi.fn>): GraphExecutor {
      return new GraphExecutor(mockCheckpointer, {
        maxSteps: 10,
        telemetryPort: { emit },
      });
    }

    it('正常 yield 路径：先 spawned 后 completed，runId 一致', async () => {
      const emit = vi.fn();
      const exec = createEmittingExecutor(emit);
      const node: GraphNode = {
        id: 'test',
        run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
      };
      exec.registerNode(node);
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: { conversationId: 'runtime_lifecycle', turnId: 'turn_lifecycle' },
      } as EngineState);

      await exec.runUntilYield('checkpoint_lifecycle');

      const lifecycle = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'run_lifecycle');
      expect(lifecycle).toHaveLength(2);
      expect(lifecycle[0].phase).toBe('spawned');
      expect(lifecycle[1].phase).toBe('completed');
      expect(lifecycle[0].runId).toBe(lifecycle[1].runId);
      expect(lifecycle[0].runId).toBe('checkpoint_lifecycle');
      expect(lifecycle[0].scope).toEqual({
        conversationId: 'runtime_lifecycle',
        runId: 'checkpoint_lifecycle',
        turnId: 'turn_lifecycle',
      });
      expect(lifecycle[1].scope).toEqual({
        conversationId: 'runtime_lifecycle',
        runId: 'checkpoint_lifecycle',
        turnId: 'turn_lifecycle',
      });
      expect(lifecycle[1]).toMatchObject({
        stepsUsed: 1,
        maxSteps: 10,
        terminalReason: 'completed',
      });
    });

    it('run_lifecycle 使用运行时真实 runId，而不是生成临时 runId', async () => {
      const emit = vi.fn();
      const exec = createEmittingExecutor(emit);
      const node: GraphNode = {
        id: 'test',
        run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
      };
      exec.registerNode(node);
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: {
          conversationId: 'runtime_lifecycle',
          runId: 'run_real_lifecycle',
          parentRunId: 'run_parent_lifecycle',
          turnId: 'turn_lifecycle',
        },
      } as EngineState);

      await exec.runUntilYield('checkpoint_lifecycle');

      const lifecycle = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'run_lifecycle');
      expect(lifecycle).toHaveLength(2);
      expect(lifecycle.map(event => event.runId)).toEqual([
        'run_real_lifecycle',
        'run_real_lifecycle',
      ]);
      expect(lifecycle.every(event => event.scope.runId === 'run_real_lifecycle')).toBe(true);
      expect(lifecycle.every(event => event.scope.parentRunId === 'run_parent_lifecycle')).toBe(
        true
      );
    });

    it('node 抛非 AbortError：phase=failed', async () => {
      const emit = vi.fn();
      const exec = createEmittingExecutor(emit);
      const node: GraphNode = {
        id: 'boom',
        run: vi.fn().mockRejectedValue(new Error('boom')),
      };
      exec.registerNode(node);
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'boom',
        local: {},
      } as EngineState);

      await expect(exec.runUntilYield('conv_fail')).rejects.toThrow('boom');

      const lifecycle = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'run_lifecycle');
      expect(lifecycle.map(e => e.phase)).toEqual(['spawned', 'failed']);
      expect(lifecycle[1]).toMatchObject({
        stepsUsed: 1,
        maxSteps: 10,
        terminalReason: 'failed',
      });
    });

    it('AbortSignal 命中：phase=cancelled', async () => {
      const emit = vi.fn();
      const exec = createEmittingExecutor(emit);
      const node: GraphNode = {
        id: 'test',
        run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
      };
      exec.registerNode(node);
      const abortedSignal = { aborted: true } as AbortSignal;
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'test',
        local: { signal: abortedSignal },
      } as EngineState);

      await expect(exec.runUntilYield('conv_abort')).rejects.toMatchObject({ name: 'AbortError' });

      const lifecycle = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'run_lifecycle');
      expect(lifecycle.map(e => e.phase)).toEqual(['spawned', 'cancelled']);
      expect(lifecycle[1]).toMatchObject({
        stepsUsed: 1,
        maxSteps: 10,
        terminalReason: 'cancelled',
      });
    });

    it('checkpointer.load 抛错：仍 emit spawned + failed（finally 兜底）', async () => {
      const emit = vi.fn();
      const exec = createEmittingExecutor(emit);
      vi.mocked(mockCheckpointer.load).mockRejectedValue(new Error('load fail'));

      await expect(exec.runUntilYield('conv_load_fail')).rejects.toThrow('load fail');

      const lifecycle = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'run_lifecycle');
      expect(lifecycle.map(e => e.phase)).toEqual(['spawned', 'failed']);
      expect(lifecycle[1]).toMatchObject({
        stepsUsed: 0,
        maxSteps: 10,
        terminalReason: 'failed',
      });
    });

    it('步数预算真实耗尽时记录 step_budget_exhausted，而不是普通完成', async () => {
      const emit = vi.fn();
      const exec = new GraphExecutor(mockCheckpointer, {
        maxSteps: 2,
        telemetryPort: { emit },
      });
      exec.registerNode({
        id: 'loop',
        run: vi.fn().mockResolvedValue({ kind: 'route', nextNodeId: 'loop', events: [] }),
      });
      exec.registerNode({
        id: 'llm',
        run: vi.fn().mockResolvedValue({ kind: 'route', nextNodeId: 'llm', events: [] }),
      });
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'loop',
        local: {
          conversationId: 'conv_budget_telemetry',
          turnId: 'turn_budget_telemetry',
          runtimeEventSink: createRuntimeEventSink(),
        },
      });

      await exec.runUntilYield('run_budget_telemetry');

      const lifecycle = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'run_lifecycle');
      expect(lifecycle[1]).toMatchObject({
        phase: 'completed',
        stepsUsed: 2,
        maxSteps: 2,
        terminalReason: 'step_budget_exhausted',
      });
    });

    it('LLM 在预算边界前成功收尾时记录 step_budget_forced_completion', async () => {
      const emit = vi.fn();
      const exec = new GraphExecutor(mockCheckpointer, {
        maxSteps: 3,
        telemetryPort: { emit },
      });
      exec.registerNode({
        id: 'start',
        run: vi.fn().mockResolvedValue({ kind: 'route', nextNodeId: 'llm', events: [] }),
      });
      exec.registerNode({
        id: 'llm',
        run: vi.fn((state: EngineState) => {
          expect(state.local?.executorLocal?.phase).toBe('force_final_answer');
          return Promise.resolve({ kind: 'yield', events: [] } satisfies NodeResult);
        }),
      });
      vi.mocked(mockCheckpointer.load).mockResolvedValue({
        nodeId: 'start',
        local: {},
      });

      await exec.runUntilYield('run_forced_completion');

      const lifecycle = emit.mock.calls.map(c => c[0]).filter(e => e.kind === 'run_lifecycle');
      expect(lifecycle[1]).toMatchObject({
        phase: 'completed',
        stepsUsed: 2,
        maxSteps: 3,
        terminalReason: 'step_budget_forced_completion',
      });
    });
  });
});
