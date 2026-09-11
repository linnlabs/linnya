import {
  CONVERSATION_CONTROL_WORKSPACE_TOOL_NAMES,
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationControlCommandRequest,
  type ConversationControlListRequest,
  type ConversationControlModelsRequest,
  type ConversationControlMessagesRequest,
  type ConversationControlRespondRequest,
  type ConversationControlResultRequest,
  type ConversationControlSendRequest,
  type ConversationControlStatusRequest,
  type ConversationControlStopRequest,
  type ConversationControlWorkspaceToolsRequest,
  type ConversationNextRequest,
} from '@app/schemas';
import { ConversationControlError } from '../definitions/conversationControlError';
import type {
  ConversationControlFlowAcceptance,
  ConversationControlMessageWindow,
  ConversationControlUseCase,
  ConversationControlUseCasePorts,
} from '../definitions/conversationControlUseCase';
import {
  isActiveRun,
  isForegroundRootRun,
  selectLatestTerminalRun,
  selectStatusRun,
} from '../functions/selectForegroundRun';
import { readPendingInteraction } from '../functions/readPendingInteraction';
import { projectRunStatus } from '../functions/projectRunStatus';
import { projectInteractionResponse } from '../functions/projectInteractionResponse';
import { projectExecutionAuditResponse } from '../functions/projectExecutionAudit';
import { projectActiveExecutionProgress } from '../functions/projectActiveExecutionProgress';

function firstIncomingEventId(acceptance: ConversationControlFlowAcceptance): string {
  const eventId = acceptance.incomingEventIds[0];
  if (!eventId) {
    throw new ConversationControlError(
      'internal_error',
      `Run ${acceptance.runId} was accepted without a committed incoming event`,
    );
  }
  return eventId;
}

function assertModelAvailable(
  ports: ConversationControlUseCasePorts,
  modelId: string,
  capability: 'chat' | 'image_generation',
): void {
  const availability = ports.models.evaluate(modelId, capability);
  if (!availability) {
    throw new ConversationControlError('invalid_request', `Model ${modelId} does not exist`);
  }
  if (!availability.available) {
    throw new ConversationControlError(
      'invalid_request',
      `Model ${modelId} is unavailable for ${capability}: ${availability.reason}`,
    );
  }
}

function buildSendRequest(
  request: ConversationControlSendRequest,
  conversationId: string,
  timestamp: number,
): ConversationNextRequest {
  return {
    conversation_id: conversationId,
    project_id: request.project_id,
    new_events: [{
      type: 'user_input',
      timestamp,
      content: request.message,
      source: 'user',
    }],
    options: {
      model_id: request.model_id,
      imageGenerationModelId: request.image_generation_model_id,
      reasoning_effort: request.reasoning_effort,
      selected_agent_id: request.selected_agent_id,
      project_metadata: request.project_id ? { id: request.project_id } : undefined,
      run_lane: 'foreground',
      event_visibility: 'conversation',
    },
  };
}

async function resolveConversationProjectId(
  ports: ConversationControlUseCasePorts,
  request: Pick<ConversationControlSendRequest, 'conversation_id' | 'project_id'>,
): Promise<string | undefined> {
  if (!request.conversation_id) {
    return request.project_id;
  }

  const persistedProjectId = await ports.history.readConversationProjectId(
    request.conversation_id,
  );
  if (persistedProjectId === undefined) {
    throw new ConversationControlError(
      'invalid_request',
      `Conversation ${request.conversation_id} does not exist`,
    );
  }
  if (request.project_id && request.project_id !== persistedProjectId) {
    throw new ConversationControlError(
      'invalid_request',
      `Conversation ${request.conversation_id} belongs to another Workspace project`,
    );
  }
  // 续跑和审批均继承持久化作用域；无项目聊天仍合法，但不能借续跑迁移项目。
  return persistedProjectId ?? undefined;
}

function buildWorkspaceToolRequest(input: {
  readonly request: Extract<ConversationControlWorkspaceToolsRequest, { action: 'call' }>;
  readonly conversationId: string;
  readonly projectId: string;
  readonly timestamp: number;
}): ConversationNextRequest {
  return {
    conversation_id: input.conversationId,
    project_id: input.projectId,
    new_events: [{
      type: 'user_input',
      timestamp: input.timestamp,
      content: `CLI 调用 Workspace 工具：${input.request.tool_name}`,
      source: 'user',
    }],
    options: {
      project_metadata: { id: input.projectId },
      run_lane: 'foreground',
      event_visibility: 'conversation',
      host_tool_call: {
        tool_name: input.request.tool_name,
        args: input.request.args,
        completion_mode: 'yield_after_batch',
      },
    },
  };
}

function projectMessages(
  request: ConversationControlMessagesRequest,
  window: ConversationControlMessageWindow,
) {
  if (window.status === 'anchor-not-found') {
    throw new ConversationControlError('internal_error', 'Unexpected anchor-not-found message window');
  }
  if (window.status === 'preparing') {
    return {
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      ok: true as const,
      command: 'messages' as const,
      status: 'preparing' as const,
      conversation_id: request.conversation_id,
    };
  }
  return {
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    ok: true as const,
    command: 'messages' as const,
    status: 'ready' as const,
    conversation_id: request.conversation_id,
    messages: [...window.messages],
    has_more_before: window.has_more_before,
    has_more_after: window.has_more_after,
    prev_cursor: window.prev_cursor,
    next_cursor: window.next_cursor,
    revision: window.revision,
  };
}

async function readInteractionWindow(
  ports: ConversationControlUseCasePorts,
  conversationId: string,
): Promise<ConversationControlMessageWindow> {
  return ports.history.readTail(conversationId, 200);
}

async function projectStatusResponse(
  ports: ConversationControlUseCasePorts,
  request: ConversationControlStatusRequest,
) {
  const runs = await ports.runs.findByConversation(request.conversation_id);
  const run = selectStatusRun(request.conversation_id, runs, request.expected_run_id);
  if (!run) {
    return {
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      ok: true as const,
      command: 'status' as const,
      conversation_id: request.conversation_id,
      run: null,
    };
  }

  let projectedRun = projectActiveExecutionProgress(
    run,
    run.status === 'running' ? await ports.executionProgress.read(run.runId) : null,
  );
  if (run.status !== 'running') {
    try {
      const executionStepsUsed = await ports.executionProgress.readLatestExecutionSteps?.(
        request.conversation_id,
        run.runId,
      );
      if (executionStepsUsed !== undefined) {
        projectedRun = { ...projectedRun, executionStepsUsed };
      }
    } catch {
      // Telemetry 只补充终态 execution 步数；读取失败不能影响 RunRegistry 的权威状态。
    }
  }

  const window = projectedRun.status === 'awaiting_user'
    ? await readInteractionWindow(ports, request.conversation_id)
    : undefined;
  const interaction = window ? readPendingInteraction(projectedRun, window) : undefined;
  const finalAnswer = projectedRun.status === 'completed'
    ? await ports.history.readRunFinalAnswer(request.conversation_id, projectedRun.runId)
    : undefined;
  return {
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    ok: true as const,
    command: 'status' as const,
    conversation_id: request.conversation_id,
    run: projectRunStatus(
      projectedRun,
      interaction,
      finalAnswer?.status === 'ready' && finalAnswer.message !== null,
    ),
  };
}

export function createConversationControlUseCase(
  ports: ConversationControlUseCasePorts,
): ConversationControlUseCase {
  const useCase: ConversationControlUseCase = {
    async execute(request: ConversationControlCommandRequest) {
      switch (request.command) {
        case 'send': return useCase.send(request);
        case 'models': return useCase.models(request);
        case 'projects': return useCase.projects(request);
        case 'list': return useCase.list(request);
        case 'messages': return useCase.messages(request);
        case 'status': return useCase.status(request);
        case 'respond': return useCase.respond(request);
        case 'stop': return useCase.stop(request);
        case 'result': return useCase.result(request);
        case 'audit': return useCase.audit(request);
        case 'workspace_tools': return useCase.workspaceTools(request);
      }
    },

    async send(request) {
      if (request.model_id) assertModelAvailable(ports, request.model_id, 'chat');
      if (request.image_generation_model_id) {
        assertModelAvailable(
          ports,
          request.image_generation_model_id,
          'image_generation',
        );
      }
      const conversationId = request.conversation_id ?? ports.createConversationId();
      const existingRuns = await ports.runs.findByConversation(conversationId);
      if (existingRuns.some(run => isForegroundRootRun(run) && isActiveRun(run))) {
        throw new ConversationControlError(
          'conversation_busy',
          `Conversation ${conversationId} already has an active foreground run`,
          true,
        );
      }
      const projectId = await resolveConversationProjectId(ports, request);
      if (request.selected_agent_id) {
        const updated = await ports.history.updateSelectedAgent(
          conversationId,
          request.selected_agent_id,
          projectId,
        );
        if (!updated) {
          throw new ConversationControlError(
            'internal_error',
            `Failed to persist selected Agent for conversation ${conversationId}`,
          );
        }
      }
      const acceptance = await ports.flow.start(
        buildSendRequest({ ...request, project_id: projectId }, conversationId, ports.now()),
      );
      return {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true,
        command: 'send',
        receipt: {
          conversation_id: acceptance.conversationId,
          user_message_id: firstIncomingEventId(acceptance),
          turn_id: acceptance.turnId,
          run_id: acceptance.runId,
          execution_id: acceptance.executionId,
          agent_id: acceptance.agentId,
          accepted_at: acceptance.acceptedAt,
        },
      };
    },

    async projects() {
      return {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true,
        command: 'projects',
        projects: ports.projects.list(),
      };
    },

    async models(_request: ConversationControlModelsRequest) {
      const models = ports.models.list();
      return {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true,
        command: 'models',
        chat: [...models.chat],
        image_generation: [...models.imageGeneration],
      };
    },

    async list(request: ConversationControlListRequest) {
      const result = await ports.history.list({
        limit: request.limit,
        cursor: request.cursor,
        search: request.search,
        projectId: request.project_id,
      });
      return {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true,
        command: 'list',
        conversations: [...result.conversations],
        next_cursor: result.next_cursor,
        has_more: result.has_more,
      };
    },

    async messages(request: ConversationControlMessagesRequest) {
      const window = request.window === 'tail'
        ? await ports.history.readTail(request.conversation_id, request.limit)
        : request.window === 'before'
          ? await ports.history.readBefore(request.conversation_id, request.cursor, request.limit)
          : await ports.history.readAfter(request.conversation_id, request.cursor, request.limit);
      return projectMessages(request, window);
    },

    status(request: ConversationControlStatusRequest) {
      return projectStatusResponse(ports, request);
    },

    async respond(request: ConversationControlRespondRequest) {
      const runs = await ports.runs.findByConversation(request.conversation_id);
      const run = selectStatusRun(request.conversation_id, runs);
      if (!run || run.status !== 'awaiting_user') {
        throw new ConversationControlError(
          'no_active_run',
          `Conversation ${request.conversation_id} is not awaiting user input`,
        );
      }
      const interaction = readPendingInteraction(
        run,
        await readInteractionWindow(ports, request.conversation_id),
      );
      if (interaction.interactionId !== request.expected_interaction_id) {
        throw new ConversationControlError(
          'interaction_mismatch',
          `Expected interaction ${request.expected_interaction_id} is no longer pending`,
        );
      }
      const projectId = await resolveConversationProjectId(ports, request);
      const acceptance = await ports.flow.respond(
        projectInteractionResponse({ ...request, project_id: projectId }, run, interaction, ports.now()),
      );
      return {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true,
        command: 'respond',
        receipt: {
          conversation_id: acceptance.conversationId,
          interaction_id: interaction.interactionId,
          turn_id: acceptance.turnId,
          run_id: acceptance.runId,
          execution_id: acceptance.executionId,
          agent_id: acceptance.agentId,
          accepted_at: acceptance.acceptedAt,
        },
      };
    },

    async stop(request: ConversationControlStopRequest) {
      const before = await ports.runs.findByConversation(request.conversation_id);
      const active = before.filter(run => isForegroundRootRun(run) && isActiveRun(run));
      if (active.length !== 1 || !active[0]) {
        throw new ConversationControlError(
          'no_active_run',
          `Conversation ${request.conversation_id} has no single active foreground run`,
        );
      }
      if (active[0].status === 'paused') {
        throw new ConversationControlError(
          'unsupported_runtime_state',
          `Run ${active[0].runId} is in unsupported runtime state paused`,
        );
      }
      if (request.expected_run_id && request.expected_run_id !== active[0].runId) {
        throw new ConversationControlError(
          'run_mismatch',
          `Expected run ${request.expected_run_id}, current run is ${active[0].runId}`,
        );
      }
      const settlement = await ports.flow.stop(
        active[0].runId,
        request.conversation_id,
        request.reason,
      );
      const after = await ports.runs.findByConversation(request.conversation_id);
      const terminal = after.find(run => run.runId === settlement.run_id);
      if (
        !terminal
        || (terminal.status !== 'completed'
          && terminal.status !== 'failed'
          && terminal.status !== 'cancelled')
      ) {
        throw new ConversationControlError(
          'internal_error',
          `Run ${settlement.run_id} did not expose its terminal settlement`,
        );
      }
      return {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true,
        command: 'stop',
        conversation_id: request.conversation_id,
        run_id: terminal.runId,
        requested_reason: request.reason,
        outcome: terminal.status,
        completed_at: terminal.updatedAt,
      };
    },

    async result(request: ConversationControlResultRequest) {
      const run = selectLatestTerminalRun(
        request.conversation_id,
        await ports.runs.findByConversation(request.conversation_id),
        request.run_id,
      );
      const common = {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true as const,
        command: 'result' as const,
        conversation_id: request.conversation_id,
        run_id: run.runId,
        outcome: run.status,
        completed_at: run.updatedAt,
      };
      if (run.status !== 'completed') {
        return { ...common, result_status: 'unavailable', reason: 'run_not_completed' };
      }
      const finalAnswer = await ports.history.readRunFinalAnswer(request.conversation_id, run.runId);
      if (finalAnswer.status === 'preparing') {
        return { ...common, result_status: 'unavailable', reason: 'projection_preparing' };
      }
      if (!finalAnswer.message) {
        return { ...common, result_status: 'unavailable', reason: 'final_answer_missing' };
      }
      return { ...common, result_status: 'available', message: finalAnswer.message };
    },

    async audit(request) {
      if (ports.auditAvailable === false) {
        throw new ConversationControlError(
          'capability_unavailable',
          'Agent Run Audit is disabled in this runtime environment',
        );
      }
      const audit = await ports.audit.export({
        conversationId: request.conversation_id,
        runId: request.run_id,
      });
      if (!audit) {
        throw new ConversationControlError(
          'run_not_found',
          `Run ${request.run_id} does not belong to conversation ${request.conversation_id}`,
        );
      }
      return projectExecutionAuditResponse({
        conversationId: request.conversation_id,
        requestedRunId: request.run_id,
        audit,
      });
    },

    async workspaceTools(request) {
      if (request.action === 'list') {
        const tools = ports.workspaceTools.describe(CONVERSATION_CONTROL_WORKSPACE_TOOL_NAMES);
        return {
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          ok: true,
          command: 'workspace_tools',
          action: 'list',
          tools: tools.map(({ name, description }) => ({ name, description })),
        };
      }
      if (request.action === 'describe') {
        const tool = ports.workspaceTools.describe([request.tool_name])[0];
        if (!tool) {
          throw new ConversationControlError(
            'internal_error',
            `Workspace tool ${request.tool_name} is not registered`,
          );
        }
        return {
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          ok: true,
          command: 'workspace_tools',
          action: 'describe',
          tool,
        };
      }

      const projectId = await resolveConversationProjectId(ports, request);
      if (!projectId) {
        throw new ConversationControlError(
          'invalid_request',
          'Workspace tool call requires a project or a conversation bound to a Workspace project',
        );
      }
      const conversationId = request.conversation_id ?? ports.createConversationId();
      const existingRuns = await ports.runs.findByConversation(conversationId);
      if (existingRuns.some(run => isForegroundRootRun(run) && isActiveRun(run))) {
        throw new ConversationControlError(
          'conversation_busy',
          `Conversation ${conversationId} already has an active foreground run`,
          true,
        );
      }
      const acceptance = await ports.flow.start(buildWorkspaceToolRequest({
        request,
        conversationId,
        projectId,
        timestamp: ports.now(),
      }));
      return {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        ok: true,
        command: 'workspace_tools',
        action: 'call',
        tool_name: request.tool_name,
        receipt: {
          conversation_id: acceptance.conversationId,
          user_message_id: firstIncomingEventId(acceptance),
          turn_id: acceptance.turnId,
          run_id: acceptance.runId,
          execution_id: acceptance.executionId,
          agent_id: acceptance.agentId,
          accepted_at: acceptance.acceptedAt,
        },
      };
    },
  };
  return useCase;
}
