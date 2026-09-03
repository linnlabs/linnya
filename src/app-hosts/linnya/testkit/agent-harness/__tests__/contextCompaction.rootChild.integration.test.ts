import { PromptKeys } from '@app/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import {
  audit,
  childRuns,
  childRunTrace,
  graph,
  llm,
  runSupervisor,
  telemetry,
} from '@linnlabs/linnkit/runtime-kernel';
import * as testkit from '@linnlabs/linnkit/testkit';

import { createLinnyaChildRunInvoker } from 'src/app-hosts/linnya/adapters/child-runs/childRunInvokerFactory';
import { createDefaultLlmNode } from 'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { SCRIPTED_MODEL_ID } from 'src/app-hosts/linnya/testkit/agent-harness/modelCatalogHarness';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import {
  CONVERSATION_ID,
  ROOT_RUN_ID,
  ROOT_TURN_ID,
  RunTwoCompactingChildrenTool,
  createBelowThresholdContextBuilder,
  createChildLifecycle,
  createCompactionModelCatalog,
  createLatch,
  createNearThresholdContextHarness,
  createOldToolHistory,
  createRegisteredChildInvoker,
  createRootEventHost,
  createRootGraph,
  messageText,
  tokenizer,
  validCheckpoint,
  waitUntilAborted,
  type ContextHarness,
} from './contextCompactionRootChildHarness';

describe('host-bound root/child context compaction', () => {
  const toolHarnesses: ReturnType<typeof createToolRuntimeHarness>[] = [];

  afterEach(() => {
    for (const harness of toolHarnesses.splice(0)) harness.restore();
    vi.restoreAllMocks();
  });

  it('root 与两个 child 独立压缩，child 摘要不进入 parent prompt 且不占 parent step', async () => {
    const modelCatalog = createCompactionModelCatalog();
    const modelResolver = new llm.ModelResolver({ modelCatalog });
    const eventStore = new graph.MemoryEventStore();
    const nextEventStoreId = graph.createMonotonicEventStoreIdFactory(() => 1_000);
    const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    });
    const rootEventHost = createRootEventHost({
      eventStore,
      nextEventStoreId,
      runId: ROOT_RUN_ID,
    });
    const rootHandle = await supervisor.registerRun({
      runId: ROOT_RUN_ID,
      conversationId: CONVERSATION_ID,
      agentSpec: {
        id: 'context-compaction-root',
        version: '1.0.0',
        capabilities: ['agent'],
        tools: [{ toolId: 'run_two_compacting_children' }],
        contextPolicy: { profileId: 'agent' },
      },
      request: { query: 'run root and children', promptKey: PromptKeys.DEFAULT },
      eventBus: rootEventHost.eventBus,
      eventStore,
      costCollector: {
        snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }),
      },
    });
    await rootHandle.markRunning({ currentNode: 'llm' });

    const childAHarness = createNearThresholdContextHarness({
      marker: 'child-a',
      replacedEventId: 'child-a-old-output',
    });
    const childBHarness = createNearThresholdContextHarness({
      marker: 'child-b',
      replacedEventId: 'child-b-old-output',
    });
    const childAI = testkit.createScriptedInferenceHarness(
      [
        {
          contentChunks: [validCheckpoint('child-a')],
          assertCall: call => {
            const text = messageText(call.messages);
            expect(text).toContain('child-a prompt history=');
            expect(text).toContain('child-a-old-output');
            expect(text).toContain('child-a compaction control');
            expect(text).not.toContain('child-b');
          },
        },
        {
          contentChunks: ['child-a-final'],
          assertCall: call => {
            expect(messageText(call.messages)).toContain('child-a rebuilt prompt');
          },
        },
      ],
      { modelCatalog }
    );
    const childBI = testkit.createScriptedInferenceHarness(
      [
        {
          contentChunks: [validCheckpoint('child-b')],
          assertCall: call => {
            const text = messageText(call.messages);
            expect(text).toContain('child-b prompt history=');
            expect(text).toContain('child-b-old-output');
            expect(text).toContain('child-b compaction control');
            expect(text).not.toContain('child-a');
          },
        },
        {
          contentChunks: ['child-b-final'],
          assertCall: call => {
            expect(messageText(call.messages)).toContain('child-b rebuilt prompt');
          },
        },
      ],
      { modelCatalog }
    );

    const noChildTools = createToolRuntimeHarness([]);
    toolHarnesses.push(noChildTools);
    const createChildRuntime = (
      ai: ReturnType<typeof testkit.createScriptedInferenceHarness>,
      contextHarness: ContextHarness
    ) =>
      createLinnyaChildRunInvoker({
        telemetryPort: telemetry.noopTelemetry,
        auditPort: audit.noopAudit,
        modelResolver,
        modelCatalog,
        createLlmNode: () =>
          createDefaultLlmNode({
            // 传真实 LlmCaller，锁住 host 装配下自动压缩调用不能丢失实例 this。
            llmCaller: ai.getLlmCaller(),
            toolRuntime: noChildTools.toolRuntime,
            contextBuilder: contextHarness.builder,
            modelCatalog,
            modelResolver,
            tokenizer,
          }),
        toolRuntime: noChildTools.toolRuntime,
      });
    const childRuntimeA = createChildRuntime(childAI, childAHarness);
    const childRuntimeB = createChildRuntime(childBI, childBHarness);
    const routedChildRuntime: Pick<childRuns.ChildRunInvoker, 'invoke'> = {
      invoke: params => {
        const marker = params.userMessage === 'child-a-task' ? 'child-a' : 'child-b';
        const target = marker === 'child-a' ? childRuntimeA : childRuntimeB;
        return target.invoke({
          ...params,
          seedHistoryEvents: [...(params.seedHistoryEvents ?? []), ...createOldToolHistory(marker)],
        });
      },
    };
    const registeredChildInvoker = createRegisteredChildInvoker({
      lifecycle: createChildLifecycle({ supervisor, eventStore, nextEventStoreId }),
      childRunInvoker: routedChildRuntime,
    });

    const runChildrenTool = new RunTwoCompactingChildrenTool();
    const rootToolHarness = createToolRuntimeHarness([runChildrenTool]);
    toolHarnesses.push(rootToolHarness);
    const rootContextHarness = createNearThresholdContextHarness({
      marker: 'root',
      replacedEventId: 'root-old-output',
    });
    const rootAI = testkit.createScriptedInferenceHarness(
      [
        {
          contentChunks: [validCheckpoint('root')],
          assertCall: call => {
            const text = messageText(call.messages);
            expect(text).toContain('root prompt history=');
            expect(text).toContain('root-old-output');
            expect(text).toContain('root compaction control');
            expect(text).not.toContain('child-a');
            expect(text).not.toContain('child-b');
          },
        },
        {
          toolCalls: [
            {
              id: 'call-run-children',
              name: runChildrenTool.name,
              argumentsJson: '{}',
            },
          ],
        },
        {
          contentChunks: ['root-final'],
          assertCall: call => {
            const text = messageText(call.messages);
            expect(text).toContain('root prompt history=');
            expect(text).not.toContain('child-a-summary');
            expect(text).not.toContain('child-b-summary');
            expect(text).not.toContain(validCheckpoint('child-a'));
            expect(text).not.toContain(validCheckpoint('child-b'));
          },
        },
      ],
      { modelCatalog }
    );
    const rootLlmNode = createDefaultLlmNode({
      llmCaller: rootAI.getLlmCaller(),
      toolRuntime: rootToolHarness.toolRuntime,
      contextBuilder: rootContextHarness.builder,
      modelCatalog,
      modelResolver,
      tokenizer,
    });
    const rootGraph = createRootGraph({
      llmNode: rootLlmNode,
      toolRuntime: rootToolHarness.toolRuntime,
    });
    const rootHistory = createOldToolHistory('root');
    const rootToolContext = testkit.createToolContextFixture({
      conversationId: CONVERSATION_ID,
      turnId: ROOT_TURN_ID,
      historyEvents: rootHistory,
      patch: {
        runId: ROOT_RUN_ID,
        modelId: SCRIPTED_MODEL_ID,
        abortSignal: rootHandle.signal,
        registeredChildRunInvoker: registeredChildInvoker,
        createSubRunTracePublisher: options =>
          new childRunTrace.RuntimeEventSubRunTracePublisher({
            runtimeEventSink: rootEventHost.runtimeEventSink,
            conversationId: CONVERSATION_ID,
            turnId: ROOT_TURN_ID,
            parentToolCallId: options.parentToolCallId,
            subrunId: options.subrunId,
            subrunParentId: options.subrunParentId,
            source: options.source,
            metadata: options.metadata,
          }),
      },
    });

    const rootResult = await rootGraph.startSession(
      ROOT_RUN_ID,
      {
        conversationId: CONVERSATION_ID,
        turnId: ROOT_TURN_ID,
        request: {
          query: 'run root and children',
          promptKey: PromptKeys.DEFAULT,
          model_id: SCRIPTED_MODEL_ID,
          maxSteps: 8,
          enableTools: true,
          availableTools: [runChildrenTool.name],
        },
        history: rootHistory,
        toolContext: rootToolContext,
        signal: rootHandle.signal,
        executorLocal: { stepCount: 0 },
        runtimeEventSink: rootEventHost.runtimeEventSink,
        runtimeEventCommitPort: rootEventHost.runtimeEventCommitPort,
      },
      'llm'
    );
    await rootEventHost.persistence.drain();
    await rootHandle.markCompleted({
      currentNode: 'completed',
      iterationsUsed: rootResult.stepCount,
    });

    rootAI.assertAllTurnsConsumed();
    childAI.assertAllTurnsConsumed();
    childBI.assertAllTurnsConsumed();
    expect(runChildrenTool.results).toEqual([
      expect.objectContaining({ success: true, finalAnswer: 'child-a-final', stepCount: 1 }),
      expect.objectContaining({ success: true, finalAnswer: 'child-b-final', stepCount: 1 }),
    ]);
    // parent 只统计自己的 llm -> tool -> llm 三个 Graph step；两次 child compaction 不借用父预算。
    expect(rootResult.stepCount).toBe(3);
    expect(rootContextHarness.histories).toHaveLength(2);
    expect(childAHarness.histories[0]).toEqual(expect.arrayContaining(['child-a-old-output']));
    expect(childAHarness.histories[0]).not.toEqual(expect.arrayContaining(['child-b-old-output']));
    expect(childBHarness.histories[0]).toEqual(expect.arrayContaining(['child-b-old-output']));
    expect(childBHarness.histories[0]).not.toEqual(expect.arrayContaining(['child-a-old-output']));

    const summaries = (await eventStore.range(CONVERSATION_ID))
      .map(record => record.event)
      .filter(event => event.type === 'history_summary');
    expect(
      summaries
        .map(event => ({
          id: event.id,
          runId: event.run_id,
          parentRunId: event.parent_run_id,
          lane: event.lane,
          visibility: event.visibility,
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    ).toEqual([
      {
        id: 'child-a-summary',
        runId: 'child-a',
        parentRunId: ROOT_RUN_ID,
        lane: 'child',
        visibility: 'parent-trace',
      },
      {
        id: 'child-b-summary',
        runId: 'child-b',
        parentRunId: ROOT_RUN_ID,
        lane: 'child',
        visibility: 'parent-trace',
      },
      {
        id: 'root-summary',
        runId: ROOT_RUN_ID,
        parentRunId: undefined,
        lane: 'foreground',
        visibility: 'conversation',
      },
    ]);

    rootEventHost.eventBus.close();
  });

  it('终止 root 时同时中断正在压缩的 root 与运行中的 child 生命周期', async () => {
    const modelCatalog = createCompactionModelCatalog();
    const modelResolver = new llm.ModelResolver({ modelCatalog });
    const eventStore = new graph.MemoryEventStore();
    const nextEventStoreId = graph.createMonotonicEventStoreIdFactory(() => 2_000);
    const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    });
    const rootEventHost = createRootEventHost({
      eventStore,
      nextEventStoreId,
      runId: ROOT_RUN_ID,
    });
    const rootHandle = await supervisor.registerRun({
      runId: ROOT_RUN_ID,
      conversationId: CONVERSATION_ID,
      agentSpec: {
        id: 'context-compaction-cancel-root',
        version: '1.0.0',
        capabilities: ['agent'],
        tools: [],
        contextPolicy: { profileId: 'agent' },
      },
      request: { query: 'cancel root', promptKey: PromptKeys.DEFAULT },
      eventBus: rootEventHost.eventBus,
      eventStore,
      costCollector: {
        snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }),
      },
    });
    await rootHandle.markRunning({ currentNode: 'llm' });

    const rootCompactionStarted = createLatch();
    const childMainStarted = createLatch();
    const rootMainCall = vi.fn<llm.LlmCaller['callWithRetries']>(async () => ({
      content: 'root main must not run',
    }));
    const rootCompactionCall = vi.fn<llm.LlmCaller['call']>(
      (_modelId, _messages, _options, signal) => waitUntilAborted(signal, rootCompactionStarted)
    );
    const rootReasoner = new graph.GraphAgentExecutor({
      llmCaller: {
        call: rootCompactionCall,
        callWithRetries: rootMainCall,
      },
      toolRuntime: {
        getToolSchemas: () => [],
        getToolDefinition: () => undefined,
      },
      contextBuilder: createNearThresholdContextHarness({
        marker: 'cancel-root',
        replacedEventId: 'cancel-root-old-output',
      }).builder,
      modelCatalog,
      modelResolver,
      tokenizer,
    });
    const rootGraph = createRootGraph({
      llmNode: new graph.LlmNode({ reasoner: rootReasoner }),
      toolRuntime: {
        getToolSchemas: () => [],
        getToolDefinition: () => undefined,
        executeTool: async () => ({
          success: false,
          error: 'no tools',
          durationMs: 0,
        }),
      },
    });
    const rootHistory = createOldToolHistory('cancel-root');
    const rootExecution = rootGraph.startSession(
      ROOT_RUN_ID,
      {
        conversationId: CONVERSATION_ID,
        turnId: ROOT_TURN_ID,
        request: {
          query: 'cancel root',
          promptKey: PromptKeys.DEFAULT,
          model_id: SCRIPTED_MODEL_ID,
          enableTools: false,
        },
        history: rootHistory,
        toolContext: testkit.createToolContextFixture({
          conversationId: CONVERSATION_ID,
          turnId: ROOT_TURN_ID,
          historyEvents: rootHistory,
          patch: {
            runId: ROOT_RUN_ID,
            modelId: SCRIPTED_MODEL_ID,
            abortSignal: rootHandle.signal,
          },
        }),
        signal: rootHandle.signal,
        executorLocal: { stepCount: 0 },
        runtimeEventSink: rootEventHost.runtimeEventSink,
        runtimeEventCommitPort: rootEventHost.runtimeEventCommitPort,
      },
      'llm'
    );

    const childMainCall = vi.fn<llm.LlmCaller['callWithRetries']>(
      (_modelId, _messages, _options, _eventHandler, signal) =>
        waitUntilAborted(signal, childMainStarted)
    );
    const childUnexpectedCompactionCall = vi.fn<llm.LlmCaller['call']>(async () => {
      throw new Error('低于阈值的 child 不应发起压缩调用');
    });
    const noChildTools = createToolRuntimeHarness([]);
    toolHarnesses.push(noChildTools);
    const childRuntime = createLinnyaChildRunInvoker({
      telemetryPort: telemetry.noopTelemetry,
      auditPort: audit.noopAudit,
      modelResolver,
      modelCatalog,
      createLlmNode: () =>
        createDefaultLlmNode({
          llmCaller: {
            call: childUnexpectedCompactionCall,
            callWithRetries: childMainCall,
          },
          toolRuntime: noChildTools.toolRuntime,
          contextBuilder: createBelowThresholdContextBuilder('cancel-child'),
          modelCatalog,
          modelResolver,
          tokenizer,
        }),
      toolRuntime: noChildTools.toolRuntime,
    });
    const registeredChildInvoker = createRegisteredChildInvoker({
      lifecycle: createChildLifecycle({ supervisor, eventStore, nextEventStoreId }),
      childRunInvoker: childRuntime,
    });
    const childExecution = registeredChildInvoker.invoke({
      promptKey: PromptKeys.DEFAULT,
      userMessage: 'cancel-child-task',
      parentToolContext: testkit.createToolContextFixture({
        conversationId: CONVERSATION_ID,
        turnId: ROOT_TURN_ID,
        historyEvents: [],
        patch: {
          runId: ROOT_RUN_ID,
          modelId: SCRIPTED_MODEL_ID,
          abortSignal: rootHandle.signal,
        },
      }),
      tracePolicy: { subrunId: 'cancel-child' },
      executionPolicy: { modelId: SCRIPTED_MODEL_ID, maxSteps: 4 },
    });

    await vi.waitFor(() => expect(rootCompactionCall).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(childMainCall).toHaveBeenCalledOnce());
    await Promise.all([rootCompactionStarted.promise, childMainStarted.promise]);
    await supervisor.cancel(ROOT_RUN_ID, {
      reason: 'user terminated root run',
      forceCleanup: false,
    });

    await expect(rootExecution).rejects.toMatchObject({ name: 'AbortError' });
    const childResult = await childExecution;
    expect(childResult).toMatchObject({
      success: false,
      cancelled: true,
      subrunId: 'cancel-child',
    });
    expect(rootMainCall).not.toHaveBeenCalled();
    expect(childUnexpectedCompactionCall).not.toHaveBeenCalled();
    expect(childMainCall).toHaveBeenCalledOnce();
    expect(
      (await eventStore.range(CONVERSATION_ID)).filter(
        record => record.event.type === 'history_summary'
      )
    ).toEqual([]);
    await expect(supervisor.peek(ROOT_RUN_ID)).resolves.toMatchObject({
      status: 'cancelled',
    });
    await expect(supervisor.peek(RunIdSchema.parse('cancel-child'))).resolves.toMatchObject({
      status: 'cancelled',
    });

    rootEventHost.eventBus.close();
  });
});
