import { describe, expect, it } from 'vitest';
import {
  ConversationSelectedAgentIdSchema,
  ConversationUiMessageSchema,
  type ConversationInteractionResponseRequest,
  type ConversationNextRequest,
  type ConversationUiMessage,
} from '@app/schemas';
import {
  createConversationControlUseCase,
  type ConversationControlExecutionProgressSnapshot,
  type ConversationControlFlowAcceptance,
  type ConversationControlRunRecord,
  type ConversationControlUseCasePorts,
} from '..';
import type { ExecutionAuditExport } from '../../execution-audit-export';

function accepted(
  conversationId: string,
  executionId = 'execution-1',
  incomingEventId = 'message-1',
): ConversationControlFlowAcceptance {
  return {
    conversationId,
    incomingEventIds: [incomingEventId],
    turnId: 'turn-1',
    runId: 'run-1',
    executionId,
    agentId: 'plugin_agent_fixture',
    acceptedAt: 120,
  };
}

function run(
  status: ConversationControlRunRecord['status'],
  overrides: Partial<ConversationControlRunRecord> = {},
): ConversationControlRunRecord {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    agentSpecId: 'plugin_agent_fixture',
    status,
    startedAt: 100,
    updatedAt: 110,
    metadata: {
      lane: 'foreground',
      turnId: 'turn-1',
      executionId: 'execution-1',
    },
    ...overrides,
  };
}

function activeInteractionMessage() {
  return ConversationUiMessageSchema.parse({
    message_id: 'tool-message-1',
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    sort_seq: 2,
    timestamp: 109,
    content: '请确认演示文稿计划',
    merge_key: 'tool:run-1:tool-call-1',
    presentation: null,
    run_id: 'run-1',
    role: 'assistant',
    message_type: 'tool_calls',
    payload: {
      tool_call_id: 'tool-call-1',
      tool_name: 'ppt_plan',
      status: 'loading',
      phase: 'update',
      data: { title: '三页计划' },
      interaction: {
        status: 'active',
        interactionId: 'interaction-1',
        runId: 'run-1',
        checkpointRevision: 3,
        resumeToken: 'renderer-projection-token',
      },
      started_at: 105,
    },
  });
}

function finalAnswerMessage(): Extract<ConversationUiMessage, { message_type: 'final_answer' }> {
  const message = ConversationUiMessageSchema.parse({
    message_id: 'answer-1',
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    sort_seq: 3,
    timestamp: 130,
    content: '演示文稿已生成。',
    merge_key: null,
    presentation: 'message',
    run_id: 'run-1',
    role: 'assistant',
    message_type: 'final_answer',
    payload: {
      answer_id: 'answer-segment-1',
      is_complete: true,
      completion_reason: 'terminal',
      first_token_at: 125,
    },
  });
  if (message.message_type !== 'final_answer') {
    throw new Error('fixture must produce a final_answer');
  }
  return message;
}

function contextCompactionAuditFixture(): ExecutionAuditExport['contextCompaction'] {
  const completed = {
    kind: 'context_compaction' as const,
    runId: 'run-1',
    emittedAt: 118,
    durationMs: 900,
    modelId: 'model-a',
    compactionIndex: 1,
    maxCompactionsPerRun: 12,
    generationAttempted: true,
    triggerRatio: 0.8,
    targetRatio: 0.5,
    beforeTokens: 8_500,
    inputBudgetTokens: 10_000,
    compactionInputTokens: 6_000,
    afterTokens: 4_800,
    replacedMessageCount: 20,
    replacedToolGroupCount: 5,
    keptToolGroupCount: 2,
    summaryOutputTokens: 600,
    compressionRatio: 0.1,
    usage: {
      inputTokens: 6_100,
      outputTokens: 580,
      cacheReadTokens: 5_500,
      confidence: 'actual' as const,
    },
    outcome: 'completed' as const,
    forcedPhaseRecovery: false,
  };
  const preflightRefusal = {
    kind: 'context_compaction' as const,
    runId: 'run-1',
    emittedAt: 119,
    durationMs: 0,
    modelId: 'model-a',
    compactionIndex: 2,
    maxCompactionsPerRun: 12,
    generationAttempted: false,
    triggerRatio: 0.8,
    targetRatio: 0.5,
    beforeTokens: 10_100,
    inputBudgetTokens: 10_000,
    replacedMessageCount: 0,
    replacedToolGroupCount: 0,
    keptToolGroupCount: 2,
    outcome: 'insufficient' as const,
    forcedPhaseRecovery: false,
    failureReason: 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
  };

  return {
    observations: 2,
    attempts: 1,
    completed: 1,
    failed: 0,
    insufficient: 1,
    aborted: 0,
    skipped: 0,
    durationMs: 900,
    compactionInputTokensReported: 6_000,
    summaryOutputTokensReported: 600,
    releasedTokensReported: 3_700,
    providerActualCalls: 1,
    estimateCalls: 0,
    missingUsageCalls: 0,
    actualTokens: {
      inputTokens: 6_100,
      outputTokens: 580,
      cacheReadTokensReported: 5_500,
    },
    byRun: [{
      runId: 'run-1',
      observations: 2,
      attempts: 1,
      completed: 1,
      failed: 0,
      insufficient: 1,
      aborted: 0,
      skipped: 0,
      durationMs: 900,
      maxCompactionsPerRun: 12,
      compactionInputTokensReported: 6_000,
      summaryOutputTokensReported: 600,
      releasedTokensReported: 3_700,
      providerActualCalls: 1,
      estimateCalls: 0,
      missingUsageCalls: 0,
      actualTokens: {
        inputTokens: 6_100,
        outputTokens: 580,
        cacheReadTokensReported: 5_500,
      },
      events: [completed, preflightRefusal],
    }],
  };
}

function fixture(initialRuns: ConversationControlRunRecord[] = []) {
  let runs = [...initialRuns];
  let executionProgress: ConversationControlExecutionProgressSnapshot | null = null;
  let latestExecutionSteps: number | undefined;
  let latestExecutionStepsError: Error | undefined;
  const startRequests: ConversationNextRequest[] = [];
  const responseRequests: ConversationInteractionResponseRequest[] = [];
  const selectedAgentWrites: string[] = [];
  let finalAnswer: ReturnType<typeof finalAnswerMessage> | null = finalAnswerMessage();
  let conversationProjectId: string | null | undefined = 'project-1';

  const ports: ConversationControlUseCasePorts = {
    flow: {
      async start(request) {
        startRequests.push(request);
        runs = [run('pending')];
        return accepted(request.conversation_id ?? 'missing');
      },
      async respond(request) {
        responseRequests.push(request);
        runs = [run('running', {
          metadata: {
            lane: 'foreground',
            turnId: 'turn-1',
            executionId: 'execution-2',
          },
        })];
        return accepted(request.conversation_id, 'execution-2', 'tool-output-1');
      },
      async stop(runId) {
        runs = [run('cancelled', { runId, updatedAt: 140 })];
        return {
          success: true,
          run_id: runId,
          outcome: 'cancelled',
          terminal_status: 'cancelled',
        };
      },
    },
    runs: {
      async findByConversation() {
        return runs;
      },
    },
    executionProgress: {
      async read() {
        return executionProgress;
      },
      async readLatestExecutionSteps() {
        if (latestExecutionStepsError) throw latestExecutionStepsError;
        return latestExecutionSteps;
      },
    },
    projects: { list: () => [{ project_id: 'project-1', name: 'Slides' }] },
    models: {
      list() {
        return {
          chat: [{
            model_config_id: 'chat-model',
            model_name: 'chat-model-upstream',
            display_name: 'Chat Model',
            catalog_source: 'account',
            available: true,
            input_support: { user_image: true, tool_result_image: false },
          }],
          imageGeneration: [{
            model_config_id: 'chatgpt-subscription-gpt-image-2',
            model_name: 'gpt-image-2',
            display_name: 'GPT Image 2',
            catalog_source: 'account',
            available: true,
          }],
        };
      },
      evaluate(modelId, capability) {
        if (modelId === 'chat-model') {
          return capability === 'chat'
            ? { available: true }
            : { available: false, reason: 'capability_missing' };
        }
        if (modelId === 'chatgpt-subscription-gpt-image-2') {
          return capability === 'image_generation'
            ? { available: true }
            : { available: false, reason: 'capability_missing' };
        }
        return undefined;
      },
    },
    history: {
      async list() {
        return { conversations: [], has_more: false };
      },
      async readTail(conversationId) {
        return {
          status: 'ready',
          conversation_id: conversationId,
          messages: [activeInteractionMessage()],
          has_more_before: false,
          has_more_after: false,
          revision: 1,
        };
      },
      async readBefore(conversationId) {
        return {
          status: 'ready',
          conversation_id: conversationId,
          messages: [],
          has_more_before: false,
          has_more_after: true,
          revision: 1,
        };
      },
      async readAfter(conversationId) {
        return {
          status: 'ready',
          conversation_id: conversationId,
          messages: [],
          has_more_before: true,
          has_more_after: false,
          revision: 1,
        };
      },
      async readRunFinalAnswer(conversationId) {
        return { status: 'ready', conversation_id: conversationId, message: finalAnswer };
      },
      async readConversationProjectId() {
        return conversationProjectId;
      },
      async updateSelectedAgent(_conversationId, selectedAgentId) {
        selectedAgentWrites.push(selectedAgentId);
        return true;
      },
    },
    workspaceTools: {
      describe(toolNames) {
        return toolNames.map(name => ({
          name,
          description: `${name} description`,
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        }));
      },
    },
    audit: {
      async export(request) {
        if (request.runId === 'missing-run') return null;
        return {
          generatedAt: 150,
          runs: runs.map(item => ({
            runId: item.runId,
            parentRunId: item.parentRunId,
            agentSpecId: item.agentSpecId,
            status: item.status,
            startedAt: item.startedAt,
            updatedAt: item.updatedAt,
            errorCode: item.errorIfAny?.errorCode,
          })),
          sourceWindow: {
            telemetryEvents: 2,
            earliestTelemetryAt: 101,
            latestTelemetryAt: 120,
            eventFacts: 0,
          },
          llm: {
            calls: 1,
            durationMs: 10,
            providerActualCalls: 1,
            estimateCalls: 0,
            missingUsageCalls: 0,
            actualTokens: { inputTokens: 20, outputTokens: 5, cacheReadTokensReported: 15 },
            byModel: [],
          },
          tools: {
            calls: 1,
            failedCalls: 0,
            durationMs: 10,
            byTool: [],
          },
          toolPairing: {
            complete: true,
            paired: 0,
            decisionMissing: 0,
            terminalMissing: 0,
            duplicateTerminal: 0,
            nameMismatches: 0,
            records: [],
          },
          commands: {
            executions: 0,
            terminalObservations: 0,
            nonZeroExitExecutions: 0,
            runtimeFailureExecutions: 0,
            byExecution: [],
          },
          contextCompaction: contextCompactionAuditFixture(),
          runLifecycle: { byRun: [] },
        };
      },
    },
    createConversationId: () => 'conversation-1',
    now: () => 115,
  };

  return {
    useCase: createConversationControlUseCase(ports),
    startRequests,
    responseRequests,
    selectedAgentWrites,
    setRuns(next: ConversationControlRunRecord[]) {
      runs = [...next];
    },
    setExecutionProgress(next: typeof executionProgress) {
      executionProgress = next;
    },
    setLatestExecutionSteps(next: number | undefined) {
      latestExecutionSteps = next;
    },
    setLatestExecutionStepsError(next: Error | undefined) {
      latestExecutionStepsError = next;
    },
    removeFinalAnswer() {
      finalAnswer = null;
    },
    setConversationProjectId(projectId: string | null | undefined) {
      conversationProjectId = projectId;
    },
  };
}

describe('conversation-control use case', () => {
  it('projects 通过 Workspace 端口返回可用于工具调用的 ID', async () => {
    expect(await fixture().useCase.execute({ schema_version: 1, command: 'projects' })).toEqual({
      schema_version: 1, ok: true, command: 'projects',
      projects: [{ project_id: 'project-1', name: 'Slides' }],
    });
  });

  it('只列出五个正式 Workspace 工具，并复用其真实参数合同', async () => {
    const response = await fixture().useCase.workspaceTools({
      schema_version: 1,
      command: 'workspace_tools',
      action: 'list',
    });
    expect(response).toEqual({
      schema_version: 1,
      ok: true,
      command: 'workspace_tools',
      action: 'list',
      tools: [
        { name: 'list_files', description: 'list_files description' },
        { name: 'read_file', description: 'read_file description' },
        { name: 'grep', description: 'grep description' },
        { name: 'write_file', description: 'write_file description' },
        { name: 'edit_file', description: 'edit_file description' },
      ],
    });
  });

  it('按项目创建可见工具会话，并要求 ToolNode 在批次后直接结算', async () => {
    const test = fixture();
    const response = await test.useCase.workspaceTools({
      schema_version: 1,
      command: 'workspace_tools',
      action: 'call',
      tool_name: 'write_file',
      args: { locator: 'workspace:/notes.md', content: '# Notes' },
      project_id: 'project-1',
    });
    expect(response).toMatchObject({
      action: 'call',
      tool_name: 'write_file',
      receipt: { conversation_id: 'conversation-1', run_id: 'run-1' },
    });
    expect(test.startRequests[0]).toMatchObject({
      conversation_id: 'conversation-1',
      project_id: 'project-1',
      new_events: [{ content: 'CLI 调用 Workspace 工具：write_file' }],
      options: {
        project_metadata: { id: 'project-1' },
        host_tool_call: {
          tool_name: 'write_file',
          completion_mode: 'yield_after_batch',
        },
      },
    });
  });

  it('已有会话继承项目，并拒绝项目不一致或未绑定项目的会话', async () => {
    const existing = fixture();
    await existing.useCase.workspaceTools({
      schema_version: 1,
      command: 'workspace_tools',
      action: 'call',
      tool_name: 'read_file',
      args: { locator: 'workspace:/notes.md' },
      conversation_id: 'conversation-1',
    });
    expect(existing.startRequests[0]).toMatchObject({ project_id: 'project-1' });

    const mismatch = fixture();
    await expect(mismatch.useCase.workspaceTools({
      schema_version: 1,
      command: 'workspace_tools',
      action: 'call',
      tool_name: 'read_file',
      args: { locator: 'workspace:/notes.md' },
      conversation_id: 'conversation-1',
      project_id: 'project-2',
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mismatch.startRequests).toEqual([]);

    const projectless = fixture();
    projectless.setConversationProjectId(null);
    await expect(projectless.useCase.workspaceTools({
      schema_version: 1,
      command: 'workspace_tools',
      action: 'call',
      tool_name: 'read_file',
      args: { locator: 'workspace:/notes.md' },
      conversation_id: 'conversation-1',
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('models 返回可直接用于 CLI 选择的安全模型投影', async () => {
    const response = await fixture().useCase.models({
      schema_version: 1,
      command: 'models',
    });

    expect(response).toEqual({
      schema_version: 1,
      ok: true,
      command: 'models',
      chat: [{
        model_config_id: 'chat-model',
        model_name: 'chat-model-upstream',
        display_name: 'Chat Model',
        catalog_source: 'account',
        available: true,
        input_support: { user_image: true, tool_result_image: false },
      }],
      image_generation: [{
        model_config_id: 'chatgpt-subscription-gpt-image-2',
        model_name: 'gpt-image-2',
        display_name: 'GPT Image 2',
        catalog_source: 'account',
        available: true,
      }],
    });
  });

  it('新会话 send 持久化 Agent 选择并只返回 Host acceptance identity', async () => {
    const test = fixture();
    const response = await test.useCase.send({
      schema_version: 1,
      command: 'send',
      message: '生成一份简单 PPT',
      selected_agent_id: ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture'),
      image_generation_model_id: 'chatgpt-subscription-gpt-image-2',
    });

    expect(response.receipt).toEqual({
      conversation_id: 'conversation-1',
      user_message_id: 'message-1',
      turn_id: 'turn-1',
      run_id: 'run-1',
      execution_id: 'execution-1',
      agent_id: 'plugin_agent_fixture',
      accepted_at: 120,
    });
    expect(test.selectedAgentWrites).toEqual(['plugin_agent_fixture']);
    expect(test.startRequests[0]).toMatchObject({
      conversation_id: 'conversation-1',
      new_events: [{ type: 'user_input', content: '生成一份简单 PPT' }],
      options: {
        selected_agent_id: 'plugin_agent_fixture',
        imageGenerationModelId: 'chatgpt-subscription-gpt-image-2',
        run_lane: 'foreground',
      },
    });
  });

  it('续跑从历史继承项目，并将同一作用域交给 Agent 选择与 Flow', async () => {
    const test = fixture([run('completed')]);
    await test.useCase.send({
      schema_version: 1, command: 'send', message: '继续制作',
      conversation_id: 'conversation-1',
      selected_agent_id: ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture'),
    });
    expect(test.startRequests[0]).toMatchObject({
      conversation_id: 'conversation-1', project_id: 'project-1',
      options: { project_metadata: { id: 'project-1' } },
    });
    expect(test.selectedAgentWrites).toEqual(['plugin_agent_fixture']);
  });

  it.each([
    { stored: 'project-1', explicit: 'project-2' },
    { stored: null, explicit: 'project-1' },
    { stored: undefined, explicit: undefined },
  ])('续跑拒绝跨项目或不存在的会话，不产生持久化副作用：%j', async ({ stored, explicit }) => {
    const test = fixture();
    test.setConversationProjectId(stored);
    await expect(test.useCase.send({
      schema_version: 1, command: 'send', message: '继续',
      conversation_id: 'conversation-1', project_id: explicit,
      selected_agent_id: ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture'),
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(test.startRequests).toEqual([]);
    expect(test.selectedAgentWrites).toEqual([]);
  });

  it('无项目聊天可正常续跑，不猜测 Workspace', async () => {
    const test = fixture();
    test.setConversationProjectId(null);
    await test.useCase.send({
      schema_version: 1, command: 'send', message: '继续聊天',
      conversation_id: 'conversation-1',
    });
    expect(test.startRequests).toHaveLength(1);
    expect(test.startRequests[0]?.project_id).toBeUndefined();
    expect(test.startRequests[0]?.options?.project_metadata).toBeUndefined();
  });

  it('在任何持久化或 Flow side effect 前拒绝不可用的图片模型', async () => {
    const test = fixture();
    await expect(test.useCase.send({
      schema_version: 1,
      command: 'send',
      message: '生成一份简单 PPT',
      selected_agent_id: ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture'),
      image_generation_model_id: 'missing-image-model',
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(test.selectedAgentWrites).toEqual([]);
    expect(test.startRequests).toEqual([]);
  });

  it('在任何持久化或 Flow side effect 前拒绝不存在或用途错误的对话模型', async () => {
    const missing = fixture();
    await expect(missing.useCase.send({
      schema_version: 1,
      command: 'send',
      message: '不要创建失败会话',
      model_id: 'missing-chat-model',
      selected_agent_id: ConversationSelectedAgentIdSchema.parse('slides_agent'),
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(missing.selectedAgentWrites).toEqual([]);
    expect(missing.startRequests).toEqual([]);

    const wrongCapability = fixture();
    await expect(wrongCapability.useCase.send({
      schema_version: 1,
      command: 'send',
      message: '不要把图片模型当成对话模型',
      model_id: 'chatgpt-subscription-gpt-image-2',
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(wrongCapability.startRequests).toEqual([]);
  });

  it('已有活动 foreground run 时拒绝 send，不改 Agent 选择也不启动第二条 run', async () => {
    const test = fixture([run('awaiting_user')]);
    await expect(test.useCase.send({
      schema_version: 1,
      command: 'send',
      message: '不要覆盖当前 run',
      conversation_id: 'conversation-1',
      selected_agent_id: ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture'),
    })).rejects.toMatchObject({ code: 'conversation_busy' });
    expect(test.selectedAgentWrites).toEqual([]);
    expect(test.startRequests).toEqual([]);
  });

  it('status 只暴露 public interaction，respond 从 Host owner 读取一次性凭证并沿用 run', async () => {
    const waiting = run('awaiting_user', {
      metadata: {
        lane: 'foreground',
        turnId: 'turn-1',
        executionId: 'execution-1',
        awaitingUser: {
          interaction: {
            interactionId: 'interaction-1',
            toolCallId: 'tool-call-1',
            checkpointRevision: 3,
            resumeToken: 'host-owner-token',
            status: 'pending',
          },
        },
      },
    });
    const test = fixture([waiting]);
    const status = await test.useCase.status({
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    });
    expect(status.run?.pending_interaction).toEqual({
      interaction_id: 'interaction-1',
      tool_name: 'ppt_plan',
      prompt: '请确认演示文稿计划',
      form: { title: '三页计划' },
    });
    expect(JSON.stringify(status)).not.toContain('resume');

    await expect(test.useCase.respond({
      schema_version: 1,
      command: 'respond',
      conversation_id: 'conversation-1',
      project_id: 'project-2',
      expected_interaction_id: 'interaction-1',
      response: { kind: 'approve' },
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(test.responseRequests).toEqual([]);

    const response = await test.useCase.respond({
      schema_version: 1,
      command: 'respond',
      conversation_id: 'conversation-1',
      expected_interaction_id: 'interaction-1',
      response: { kind: 'approve' },
    });
    expect(response.receipt).toMatchObject({
      run_id: 'run-1',
      execution_id: 'execution-2',
      interaction_id: 'interaction-1',
    });
    expect(test.responseRequests[0]).toMatchObject({
      run_id: 'run-1',
      resume_token: 'host-owner-token',
      tool_name: 'ppt_plan',
      data: { action: 'approve' },
      interaction_status: 'approved',
      project_id: 'project-1',
      project_metadata: { id: 'project-1' },
    });
  });

  it('status 用同一次 running activation 的持久执行进度补充节点与步数', async () => {
    const test = fixture([run('running', {
      currentNode: 'user',
      iterationsUsed: 0,
      updatedAt: 110,
    })]);
    test.setExecutionProgress({
      savedAt: 120,
      currentNode: 'tool',
      executionStepsUsed: 18,
    });

    await expect(test.useCase.status({
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    })).resolves.toMatchObject({
      run: {
        status: 'running',
        current_node: 'tool',
        execution_steps_used: 18,
        run_iterations_used: 0,
        iterations_used: 0,
      },
    });
  });

  it('status 不让恢复前的旧执行进度覆盖新的 running activation', async () => {
    const test = fixture([run('running', {
      currentNode: 'llm',
      iterationsUsed: 20,
      updatedAt: 150,
      metadata: {
        lane: 'foreground',
        turnId: 'turn-1',
        executionId: 'execution-2',
      },
    })]);
    test.setExecutionProgress({
      savedAt: 140,
      currentNode: 'wait_user',
      executionStepsUsed: 19,
    });

    await expect(test.useCase.status({
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    })).resolves.toMatchObject({
      run: {
        execution_id: 'execution-2',
        current_node: 'llm',
        iterations_used: 20,
      },
    });
  });

  it('status 在终态 checkpoint 已清理时仍分别显示最近 execution 与 run 累计步数', async () => {
    const test = fixture([run('completed', { iterationsUsed: 27 })]);
    test.setLatestExecutionSteps(6);

    await expect(test.useCase.status({
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    })).resolves.toMatchObject({
      run: {
        status: 'completed',
        execution_steps_used: 6,
        run_iterations_used: 27,
        iterations_used: 27,
      },
    });
  });

  it('终态 execution telemetry 读取失败时仍返回 RunRegistry 状态', async () => {
    const test = fixture([run('failed', { iterationsUsed: 27 })]);
    test.setLatestExecutionStepsError(new Error('telemetry unavailable'));

    await expect(test.useCase.status({
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    })).resolves.toMatchObject({
      run: {
        status: 'failed',
        run_iterations_used: 27,
        iterations_used: 27,
      },
    });
    const response = await test.useCase.status({
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    });
    expect(response.run?.execution_steps_used).toBeUndefined();
  });

  it('stop 等待 owner 终态后返回真实 cancelled outcome', async () => {
    const test = fixture([run('running')]);
    await expect(test.useCase.stop({
      schema_version: 1,
      command: 'stop',
      conversation_id: 'conversation-1',
      expected_run_id: 'run-1',
      reason: 'benchmark timeout',
    })).resolves.toMatchObject({
      outcome: 'cancelled',
      completed_at: 140,
      requested_reason: 'benchmark timeout',
    });
  });

  it('result 只读取目标 terminal run 的 final_answer，不回退到其它消息', async () => {
    const test = fixture([run('completed', { updatedAt: 130 })]);
    await expect(test.useCase.result({
      schema_version: 1,
      command: 'result',
      conversation_id: 'conversation-1',
      run_id: 'run-1',
    })).resolves.toMatchObject({
      result_status: 'available',
      message: { message_id: 'answer-1', run_id: 'run-1' },
    });

    test.removeFinalAnswer();
    await expect(test.useCase.result({
      schema_version: 1,
      command: 'result',
      conversation_id: 'conversation-1',
      run_id: 'run-1',
    })).resolves.toMatchObject({
      result_status: 'unavailable',
      reason: 'final_answer_missing',
    });
  });

  it('audit 只投影安全聚合字段并保留 telemetry 尽力而为语义', async () => {
    const test = fixture([run('completed', { updatedAt: 130 })]);
    await expect(test.useCase.audit({
      schema_version: 1,
      command: 'audit',
      conversation_id: 'conversation-1',
      run_id: 'run-1',
    })).resolves.toMatchObject({
      command: 'audit',
      requested_run_id: 'run-1',
      completeness: {
        run_registry: 'complete',
        event_store: 'complete',
        telemetry: 'best_effort',
      },
      llm: {
        provider_actual_calls: 1,
        actual_tokens: { input_tokens: 20, output_tokens: 5, cache_read_tokens_reported: 15 },
      },
      tools: { calls: 1, failed_calls: 0 },
      context_compaction: {
        observations: 2,
        attempts: 1,
        by_run: [{
          run_id: 'run-1',
          events: [
            { generation_attempted: true, outcome: 'completed' },
            { generation_attempted: false, outcome: 'insufficient' },
          ],
        }],
      },
    });

    await expect(test.useCase.audit({
      schema_version: 1,
      command: 'audit',
      conversation_id: 'conversation-1',
      run_id: 'missing-run',
    })).rejects.toMatchObject({ code: 'run_not_found' });
  });
});
