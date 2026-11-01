import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptKeys } from '@app/schemas';
import {
  createDefaultGraphExecutor,
  createScriptedInferenceHarness,
  type ScriptedInferenceHarness,
} from '@linnlabs/linnkit/testkit';
import { runtimeKernel } from '@linnlabs/linnkit';
import { createDefaultLlmNode } from 'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { AgentRunnerService } from 'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { createRunHandleForFlowTest } from 'src/app-hosts/linnya/adapters/flow/__integration-tests__/runHandleTestHarness';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { createAgentRunnerRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/agentRunnerRuntimeHarness';
import { createScriptedChatModelCatalog } from 'src/app-hosts/linnya/testkit/agent-harness/modelCatalogHarness';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { CommandAgentRunLifecyclePort } from 'src/app-hosts/linnya/adapters/commands/process-owner';
import { AskTool } from 'src/tools/agent_control/ask';

function createRunner(
  engine: ReturnType<typeof createDefaultGraphExecutor>,
  commandAgentRunLifecycle?: CommandAgentRunLifecyclePort,
): AgentRunnerService {
  return new AgentRunnerService(
    engine,
    { searchDocuments: vi.fn().mockResolvedValue([]) } as any,
    { getDb: vi.fn() } as any,
    {
      ...createAgentRunnerRuntimeHarness(),
      commandRuntime: commandAgentRunLifecycle
        ? {
            kind: 'enabled',
            shellToolRuntime: {
              executeShell: vi.fn(),
              executeProcess: vi.fn(),
            },
            agentRunLifecycle: commandAgentRunLifecycle,
          }
        : { kind: 'disabled' },
    },
  );
}

describe('AgentRunnerService interrupted integration', () => {
  let aiHarness: ScriptedInferenceHarness | undefined;
  const modelCatalog = createScriptedChatModelCatalog();

  afterEach(() => {
    aiHarness = undefined;
    vi.restoreAllMocks();
  });

  it('should persist partial final_answer and avoid runtime error events on AbortError', async () => {
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';

    aiHarness = createScriptedInferenceHarness(
      [
        {
          contentChunks: ['第一段输出。', '第二段输出。'],
          throwAfterEvents: abortError,
        },
      ],

    );
    const toolHarness = createToolRuntimeHarness([]);

    const engine = createDefaultGraphExecutor({
      llmNode: createDefaultLlmNode({
        llmCaller: aiHarness.getLlmCaller(),
        toolRuntime: toolHarness.toolRuntime,
        modelCatalog,
      }),
      toolRuntime: toolHarness.toolRuntime,
      observationPreview: defaultObservationPreviewPort,
      maxSteps: 6,
      checkpointer: new runtimeKernel.graph.MemoryCheckpointer(),
    });

    const releaseAgentRunBarrier = vi.fn();
    const endAgentRun = vi.fn<CommandAgentRunLifecyclePort['endAgentRun']>()
      .mockResolvedValue({ release: releaseAgentRunBarrier });
    const runner = createRunner(engine, { endAgentRun });

    const sequencer = new runtimeKernel.execution.EventSequencer('conv_agent_interrupt_1');
    const eventBus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
    const sseSink = vi.fn();
    const request: AgentInvokeRequest = {
      query: '请输出一半后终止',
      promptKey: PromptKeys.DEFAULT,
      model_id: 'scripted-test-model',
      maxSteps: 6,
      enableTools: false,
      availableTools: [],
    };
    const publisher = new runtimeKernel.execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse('turn_agent_interrupt_1'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const hostPorts = {
      eventBus,
      sequencer,
      realtimeSink: sseSink,
      runtimeEventSink: (event: Parameters<typeof publisher.publish>[0], source: string) =>
        publisher.publish(event, source),
      getGeneratedEvents: () => publisher.getGeneratedEvents(),
      drainPersistence: vi.fn().mockResolvedValue(undefined),
    };
    const runHandle = await createRunHandleForFlowTest({
      conversationId: 'conv_agent_interrupt_1',
      turnId: 'turn_agent_interrupt_1',
      request,
      hostPorts,
    });

    const result = await runner.run({
      conversationId: 'conv_agent_interrupt_1',
      turnId: 'turn_agent_interrupt_1',
      request,
      history: [],
      newEvents: [
        {
          type: 'user_input',
          id: 'user_input_1',
          content: '请输出一半后终止',
          timestamp: Date.now(),
          source: 'user',
          turn_id: 'turn_agent_interrupt_1',
          conversation_id: 'conv_agent_interrupt_1',
          version: 1,
        },
      ],
      options: {
        model_id: 'scripted-test-model',
      },
      hostPorts,
      runHandle,
      execution: { kind: 'start' },
    });

    expect(result.terminationReason).toBe('interrupted');
    expect(result.events.some(event => event.type === 'error')).toBe(false);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'final_answer',
          content: '第一段输出。第二段输出。',
          is_complete: false,
        }),
      ])
    );
    expect(endAgentRun).toHaveBeenCalledOnce();
    expect(endAgentRun).toHaveBeenCalledWith({
      conversationId: 'conv_agent_interrupt_1',
      agentRunId: 'turn_agent_interrupt_1',
    });
    expect(releaseAgentRunBarrier).toHaveBeenCalledOnce();
    toolHarness.restore();
  });

  it('LLM 终态失败只发布一条 classified error，并由同一事实结算 run', async () => {
    aiHarness = createScriptedInferenceHarness([
      {
        failure: {
          kind: 'provider',
          code: 'provider_http_401',
          retryable: false,
        },
      },
    ]);
    const toolHarness = createToolRuntimeHarness([]);
    const engine = createDefaultGraphExecutor({
      llmNode: createDefaultLlmNode({
        llmCaller: aiHarness.getLlmCaller(),
        toolRuntime: toolHarness.toolRuntime,
        modelCatalog,
      }),
      toolRuntime: toolHarness.toolRuntime,
      observationPreview: defaultObservationPreviewPort,
      maxSteps: 6,
      checkpointer: new runtimeKernel.graph.MemoryCheckpointer(),
    });
    const runner = createRunner(engine);
    const conversationId = 'conv_agent_llm_failure_once';
    const turnId = 'turn_agent_llm_failure_once';
    const sequencer = new runtimeKernel.execution.EventSequencer(conversationId);
    const eventBus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
    const request: AgentInvokeRequest = {
      query: '触发一次 Provider 失败',
      promptKey: PromptKeys.DEFAULT,
      model_id: 'scripted-test-model',
      maxSteps: 6,
      enableTools: false,
      availableTools: [],
    };
    const publisher = new runtimeKernel.execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse(turnId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const hostPorts = {
      eventBus,
      sequencer,
      realtimeSink: vi.fn(),
      runtimeEventSink: (event: Parameters<typeof publisher.publish>[0], source: string) =>
        publisher.publish(event, source),
      getGeneratedEvents: () => publisher.getGeneratedEvents(),
      drainPersistence: vi.fn().mockResolvedValue(undefined),
    };
    const runHandle = await createRunHandleForFlowTest({
      conversationId,
      turnId,
      request,
      hostPorts,
    });

    const result = await runner.run({
      conversationId,
      turnId,
      request,
      history: [],
      newEvents: [
        {
          type: 'user_input',
          id: 'user_input_llm_failure_once',
          content: request.query,
          timestamp: Date.now(),
          source: 'user',
          turn_id: turnId,
          conversation_id: conversationId,
          version: 1,
        },
      ],
      options: { model_id: 'scripted-test-model' },
      hostPorts,
      runHandle,
      execution: { kind: 'start' },
    });

    const errorEvents = result.events.filter(event => event.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({
      error_code: 'llm.provider_http_401',
      retryable: false,
    });
    expect(await runHandle.meta()).toMatchObject({
      status: 'failed',
      errorIfAny: {
        errorCode: 'llm.provider_http_401',
        recoverable: false,
      },
    });
    toolHarness.restore();
  });

  it('持久化 drain 失败时必须先把 run 标为 failed，不能留下 completed 终态', async () => {
    aiHarness = createScriptedInferenceHarness([{ contentChunks: ['已完成回答。'] }]);
    const toolHarness = createToolRuntimeHarness([]);
    const engine = createDefaultGraphExecutor({
      llmNode: createDefaultLlmNode({
        llmCaller: aiHarness.getLlmCaller(),
        toolRuntime: toolHarness.toolRuntime,
        modelCatalog,
      }),
      toolRuntime: toolHarness.toolRuntime,
      observationPreview: defaultObservationPreviewPort,
      maxSteps: 6,
      checkpointer: new runtimeKernel.graph.MemoryCheckpointer(),
    });
    const runner = createRunner(engine);
    const conversationId = 'conv_agent_persistence_failure';
    const turnId = 'turn_agent_persistence_failure';
    const sequencer = new runtimeKernel.execution.EventSequencer(conversationId);
    const eventBus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
    const persistenceError = new Error('tool event transaction failed');
    const request: AgentInvokeRequest = {
      query: '完成一次回答',
      promptKey: PromptKeys.DEFAULT,
      model_id: 'scripted-test-model',
      maxSteps: 6,
      enableTools: false,
      availableTools: [],
    };
    const publisher = new runtimeKernel.execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse(turnId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const hostPorts = {
      eventBus,
      sequencer,
      realtimeSink: vi.fn(),
      runtimeEventSink: (event: Parameters<typeof publisher.publish>[0], source: string) =>
        publisher.publish(event, source),
      getGeneratedEvents: () => publisher.getGeneratedEvents(),
      drainPersistence: vi.fn().mockRejectedValue(persistenceError),
    };
    const runHandle = await createRunHandleForFlowTest({
      conversationId,
      turnId,
      request,
      hostPorts,
    });

    const result = await runner.run({
      conversationId,
      turnId,
      request,
      history: [],
      newEvents: [
        {
          type: 'user_input',
          id: 'user_input_persistence_failure',
          content: '完成一次回答',
          timestamp: Date.now(),
          source: 'user',
          turn_id: turnId,
          conversation_id: conversationId,
          version: 1,
        },
      ],
      options: { model_id: 'scripted-test-model' },
      hostPorts,
      runHandle,
      execution: { kind: 'start' },
    });

    expect(hostPorts.drainPersistence).toHaveBeenCalledOnce();
    expect(result.terminationReason).toBe('error');
    expect(await runHandle.meta()).toMatchObject({
      status: 'failed',
      errorIfAny: expect.objectContaining({ message: persistenceError.message }),
    });
    toolHarness.restore();
  });

  it('wait_user 暂停后恢复同一 Agent run，并只在真实终态收口命令 owner', async () => {
    aiHarness = createScriptedInferenceHarness(
      [
        {
          toolCalls: [
            {
              id: 'ask_command_lifecycle_1',
              name: 'ask',
              argumentsJson: JSON.stringify({
                questions: [
                  {
                    id: 'continue',
                    type: 'single',
                    question: '是否继续执行？',
                    options: [
                      { id: 'yes', label: '继续' },
                      { id: 'no', label: '停止' },
                    ],
                    required: true,
                  },
                ],
              }),
            },
          ],
        },
        { contentChunks: ['已按用户选择继续执行。'] },
      ],
    );
    const toolHarness = createToolRuntimeHarness([new AskTool()]);
    const engine = createDefaultGraphExecutor({
      llmNode: createDefaultLlmNode({
        llmCaller: aiHarness.getLlmCaller(),
        toolRuntime: toolHarness.toolRuntime,
        modelCatalog,
      }),
      toolRuntime: toolHarness.toolRuntime,
      observationPreview: defaultObservationPreviewPort,
      // 模拟生产中的共享 executor 默认值低于当前 Agent definition。
      maxSteps: 2,
      checkpointer: new runtimeKernel.graph.MemoryCheckpointer(),
    });
    const releaseAgentRunBarrier = vi.fn();
    const endAgentRun = vi.fn<CommandAgentRunLifecyclePort['endAgentRun']>()
      .mockResolvedValue({ release: releaseAgentRunBarrier });
    const runner = createRunner(engine, { endAgentRun });
    const conversationId = 'conv_command_lifecycle_resume';
    const turnId = 'turn_command_lifecycle_resume';
    const sequencer = new runtimeKernel.execution.EventSequencer(conversationId);
    const eventBus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
    const request: AgentInvokeRequest = {
      query: '必要时先询问我，再继续执行',
      promptKey: PromptKeys.DEFAULT,
      model_id: 'scripted-test-model',
      maxSteps: 6,
      enableTools: true,
      availableTools: ['ask'],
    };
    const publisher = new runtimeKernel.execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse(turnId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const hostPorts = {
      eventBus,
      sequencer,
      realtimeSink: vi.fn(),
      runtimeEventSink: (event: Parameters<typeof publisher.publish>[0], source: string) =>
        publisher.publish(event, source),
      getGeneratedEvents: () => publisher.getGeneratedEvents(),
      drainPersistence: vi.fn().mockResolvedValue(undefined),
    };
    const runHandle = await createRunHandleForFlowTest({
      conversationId,
      turnId,
      request,
      hostPorts,
    });
    const userInput = {
      type: 'user_input' as const,
      id: 'user_input_command_lifecycle_resume',
      content: request.query,
      timestamp: Date.now(),
      source: 'user' as const,
      turn_id: turnId,
      conversation_id: conversationId,
      version: 1 as const,
    };

    const paused = await runner.run({
      conversationId,
      turnId,
      request,
      history: [],
      newEvents: [userInput],
      options: { model_id: 'scripted-test-model' },
      hostPorts,
      runHandle,
      execution: { kind: 'start' },
    });
    const interaction = paused.events.find(
      event => event.type === 'requires_user_interaction',
    );
    if (!interaction || interaction.type !== 'requires_user_interaction') {
      throw new Error('真实 ask 执行没有进入 wait_user');
    }

    expect(paused.checkpointNodeId).toBe('wait_user');
    expect(await runHandle.meta()).toMatchObject({ status: 'awaiting_user' });
    expect(endAgentRun).not.toHaveBeenCalled();

    const completed = await runner.run({
      conversationId,
      turnId,
      request,
      // 生产 resume 从 EventStore 读取包含原始 user_input 的完整历史。
      history: [userInput, ...paused.events],
      newEvents: [],
      options: { model_id: 'scripted-test-model' },
      hostPorts,
      runHandle,
      execution: {
        kind: 'resume',
        expectedCheckpointRevision: interaction.checkpoint_revision,
      },
    });

    expect(completed.checkpointNodeId).not.toBe('wait_user');
    expect(completed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'final_answer',
          content: '已按用户选择继续执行。',
          is_complete: true,
        }),
      ]),
    );
    const contextUsageSnapshots = completed.events.filter(
      event => event.type === 'context_usage_snapshot',
    );
    expect(contextUsageSnapshots).toHaveLength(2);
    expect(contextUsageSnapshots.map(event => event.user_message_id)).toEqual([
      userInput.id,
      userInput.id,
    ]);
    expect(await runHandle.meta()).toMatchObject({ status: 'completed' });
    expect(endAgentRun).toHaveBeenCalledOnce();
    expect(endAgentRun).toHaveBeenCalledWith({
      conversationId,
      agentRunId: turnId,
    });
    expect(releaseAgentRunBarrier).toHaveBeenCalledOnce();
    aiHarness.assertAllTurnsConsumed();
    toolHarness.restore();
  });
});
