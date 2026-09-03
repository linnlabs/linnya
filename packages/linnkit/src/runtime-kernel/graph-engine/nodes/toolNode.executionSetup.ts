import { normalizeToolArgs } from '../../tools/argNormalizer';
import type { ToolExecutionContext } from '../../tools/toolExecutionContext';
import { computeToolIdempotencyKey } from '../../tools/idempotency/toolIdempotency';
import type { ToolCatalogPort, ToolRuntimeDefinition } from '../../tools/ports';
import { ensureToolContextRuntimeCapability } from '../../tools/toolContextRuntime';
import type { EngineState, RuntimeEventSink, StandardToolCall } from '../types';
import type { ModelInputRequirement } from '../../llm/input-capabilities';
import type { ToolModelInputDelivery } from '../../tools/model-input';
import { ToolNodeEventBridge } from './toolNode.eventBridge';
import { isRecord, parseJsonSafe, type UnknownRecord } from './toolNode.helpers';
import {
  parseRuntimeEvents,
  toSerializableJsonRecord,
  type RuntimeEvent,
  type ToolCallId,
} from '../../../contracts';
import { Logger } from '../../../shared/logger';
import { requireRuntimeEventSink } from '../graphLocal';
import { requireRuntimeIdentity } from '../tick-pipeline/helpers';

const logger = new Logger('ToolNode');

export type PreparedToolNodeContext = {
  state: EngineState;
  local: UnknownRecord;
  toolContext: ToolExecutionContext;
  conversationId: string;
  turnId: string;
  runtimeEventSink: RuntimeEventSink;
};

export type PreparedToolExecution = {
  call: StandardToolCall;
  toolName: string;
  toolCallId: ToolCallId;
  rawArguments: string;
  toolArgs: Record<string, unknown>;
  protocolError?: string;
  idempotencyKey?: string;
  modelInputRequirement?: ModelInputRequirement;
  modelInputDelivery: ToolModelInputDelivery;
  modelInputRequirementError?: string;
  bridge: ToolNodeEventBridge;
};

const MODEL_INPUT_REQUIREMENT_RESOLUTION_ERROR =
  'tool.model_input.requirement_resolution_failed: Tool model input requirement could not be resolved';

type ParsedToolArgsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function parseToolArgs(call: StandardToolCall): ParsedToolArgsResult {
  const rawArguments = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
  if (!rawArguments.trim()) {
    return {
      ok: false,
      error: 'Tool arguments must be a non-empty JSON object string.',
    };
  }

  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!isRecord(parsed)) {
      return {
        ok: false,
        error: 'Tool arguments must decode to a JSON object.',
      };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown JSON parse error';
    logger.warn('failed to parse tool arguments', { error });
    return {
      ok: false,
      error: `Tool arguments are not valid JSON: ${reason}`,
    };
  }
}

export function prepareToolNodeContext(state: EngineState): PreparedToolNodeContext {
  const local: UnknownRecord = state.local || {};
  const toolContext: ToolExecutionContext = isRecord(local.toolContext)
    ? (local.toolContext as ToolExecutionContext)
    : {};
  if (!isRecord(local.toolContext)) {
    local.toolContext = toolContext as UnknownRecord;
  }

  const conversationId = requireRuntimeIdentity(local.conversationId, 'conversationId');
  const turnId = requireRuntimeIdentity(local.turnId, 'turnId');

  const historyEvents = parseRuntimeEvents(local.history ?? []);
  const existingConversationId =
    typeof toolContext.conversationId === 'string' ? toolContext.conversationId.trim() : '';
  ensureToolContextRuntimeCapability({
    context: toolContext,
    executionMeta: {
      conversationId: existingConversationId || conversationId,
      turnId,
    },
  });
  attachWorkingHistoryView({ state, toolContext });

  return {
    state,
    local,
    toolContext,
    conversationId,
    turnId,
    runtimeEventSink: requireRuntimeEventSink(state.local),
  };
}

export function prepareToolExecution(params: {
  prepared: PreparedToolNodeContext;
  call: StandardToolCall;
  toolCatalog?: Pick<ToolCatalogPort, 'getToolDefinition'>;
}): PreparedToolExecution | null {
  const toolName = params.call.function?.name;
  if (!toolName) {
    return null;
  }

  const toolCallId = params.call.id;
  const rawArguments =
    typeof params.call.function?.arguments === 'string' ? params.call.function.arguments : '';
  let toolArgs: Record<string, unknown> = {};
  let protocolError: string | undefined;
  const parsedToolArgs = parseToolArgs(params.call);
  const toolCatalog = params.toolCatalog;
  const toolDefinition = toolCatalog?.getToolDefinition(toolName);
  if (parsedToolArgs.ok) {
    toolArgs = parsedToolArgs.value;
  } else {
    protocolError = parsedToolArgs.error;
  }

  if (!protocolError && toolDefinition) {
    toolArgs = normalizeToolArgs(toolDefinition.parameters, toolArgs, { toolName });
    if (toolDefinition.validateArguments) {
      try {
        const validation = toolDefinition.validateArguments(toolArgs);
        if (!validation.success) {
          protocolError =
            validation.error ?? `Tool '${toolName}' arguments failed owner validation.`;
        }
      } catch (error) {
        protocolError = `Tool '${toolName}' argument validation failed: ${
          error instanceof Error ? error.message : 'Unknown validation error'
        }`;
      }
    }
  }

  const idempotencyKey = protocolError
    ? undefined
    : computeIdempotencyKey({
        toolDefinition,
        toolName,
        toolArgs,
        toolContext: params.prepared.toolContext,
      });

  bindRuntimeToolContext({
    toolContext: params.prepared.toolContext,
    conversationId: params.prepared.conversationId,
    turnId: params.prepared.turnId,
    toolCallId,
  });

  const bridge = new ToolNodeEventBridge({
    runtimeEventSink: params.prepared.runtimeEventSink,
    conversationId: params.prepared.conversationId,
    turnId: params.prepared.turnId,
    toolName,
    toolCallId,
    toolArgs,
    idempotencyKey,
  });
  const modelInputRequirement = resolveModelInputRequirement({
    toolDefinition,
    toolArgs,
    hasProtocolError: protocolError !== undefined,
    toolName,
  });

  return {
    call: params.call,
    toolName,
    toolCallId,
    rawArguments,
    toolArgs,
    protocolError,
    idempotencyKey,
    ...(modelInputRequirement.requirement
      ? { modelInputRequirement: modelInputRequirement.requirement }
      : {}),
    modelInputDelivery: toolDefinition?.modelInputDelivery ?? 'required',
    ...(modelInputRequirement.error
      ? { modelInputRequirementError: modelInputRequirement.error }
      : {}),
    bridge,
  };
}

function resolveModelInputRequirement(params: {
  toolDefinition: ToolRuntimeDefinition | undefined;
  toolArgs: Record<string, unknown>;
  hasProtocolError: boolean;
  toolName: string;
}): { requirement?: ModelInputRequirement; error?: string } {
  if (params.hasProtocolError) {
    return {};
  }
  if (!params.toolDefinition?.resolveModelInputRequirement) {
    return params.toolDefinition?.modelInputRequirement
      ? { requirement: params.toolDefinition.modelInputRequirement }
      : {};
  }

  try {
    const requirement = params.toolDefinition.resolveModelInputRequirement(params.toolArgs);
    return requirement ? { requirement } : {};
  } catch (error) {
    logger.warn('dynamic model input requirement resolution failed', {
      toolName: params.toolName,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { error: MODEL_INPUT_REQUIREMENT_RESOLUTION_ERROR };
  }
}

function attachWorkingHistoryView(params: {
  state: EngineState;
  toolContext: ToolExecutionContext;
}): void {
  const historyEvents = parseRuntimeEvents(
    (params.state.local as UnknownRecord | undefined)?.history ?? []
  );
  const runtimeBinding = ensureToolContextRuntimeCapability({
    context: params.toolContext,
    workingHistory: historyEvents,
  });
  runtimeBinding.setWorkingHistorySource(() => {
    const currentLocal = params.state.local as UnknownRecord | undefined;
    const currentHistory = parseRuntimeEvents(currentLocal?.history ?? []);
    if (currentHistory.length > 0) {
      return currentHistory;
    }
    return runtimeBinding.getPersistedHistoryEvents();
  });
}

function computeIdempotencyKey(params: {
  toolDefinition: ToolRuntimeDefinition | undefined;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolContext: ToolExecutionContext;
}): string | undefined {
  if (!params.toolDefinition?.idempotency) {
    return undefined;
  }

  return computeToolIdempotencyKey({
    policy: params.toolDefinition.idempotency,
    toolName: params.toolName,
    args: params.toolArgs,
    context: params.toolContext,
  });
}

function bindRuntimeToolContext(params: {
  toolContext: ToolExecutionContext;
  conversationId: string;
  turnId: string;
  toolCallId: ToolCallId;
}): void {
  const existingConversationId =
    typeof params.toolContext.conversationId === 'string'
      ? params.toolContext.conversationId.trim()
      : '';
  ensureToolContextRuntimeCapability({
    context: params.toolContext,
    executionMeta: {
      conversationId: existingConversationId || params.conversationId,
      turnId: params.turnId,
      parentToolCallId: params.toolCallId,
    },
  });
}

export { parseJsonSafe };
