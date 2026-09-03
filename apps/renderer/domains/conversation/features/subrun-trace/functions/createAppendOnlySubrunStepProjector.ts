import type { ToolLocalizedTextDescriptor } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { SSESubRunTraceEvent } from 'linnkit/contracts';

import {
  projectToolCompactStep,
  type ToolCompactStepProjectionRequest,
} from '../../../ports/toolCompactStepProjectionPort';
import { CONVERSATION_MESSAGE_FALLBACKS } from '../../../definitions/conversationMessageCatalog';
import type {
  SubrunTraceDisplayStatus,
  SubrunTraceDisplayStep,
} from '../definitions/subrunTracePresentation';

export interface IndexedSubrunTraceEvent {
  readonly event: SSESubRunTraceEvent;
  readonly index: number;
}

export interface AppendOnlySubrunStepProjection {
  readonly steps: readonly SubrunTraceDisplayStep[];
}

export interface AppendOnlySubrunStepProjector {
  readonly projection: AppendOnlySubrunStepProjection;
  reset(): void;
  /** 在 detached state 上接纳整批新增事件；全部成功后才替换已提交快照。 */
  admit(events: readonly IndexedSubrunTraceEvent[]): void;
}

type ProjectCompactStep = (
  request: ToolCompactStepProjectionRequest,
) => ReturnType<typeof projectToolCompactStep>;
type UnknownRecord = Record<string, unknown>;

interface ProjectionState {
  readonly steps: SubrunTraceDisplayStep[];
  readonly argsByToolCallId: Map<string, UnknownRecord>;
  readonly stepIndexByToolCallId: Map<string, number>;
}

/**
 * 将 subrun_trace 工具事实接纳为 append-only 紧凑步骤快照。
 *
 * 该 owner 不解释任何具体工具协议；工具标题只通过 Renderer registry 的窄 port 生成。
 * 每个 batch 都先克隆当前已接纳状态，projector 抛错时不会留下半条步骤或半更新状态。
 */
export function createAppendOnlySubrunStepProjector(
  projectCompactStep: ProjectCompactStep = projectToolCompactStep,
): AppendOnlySubrunStepProjector {
  let admittedState = createEmptyState();

  return {
    get projection(): AppendOnlySubrunStepProjection {
      return { steps: admittedState.steps };
    },
    reset(): void {
      admittedState = createEmptyState();
    },
    admit(events): void {
      const candidate = cloneState(admittedState);
      for (const item of events) {
        admitEvent(candidate, item.event, item.index, projectCompactStep);
      }
      admittedState = candidate;
    },
  };
}

function createEmptyState(): ProjectionState {
  return {
    steps: [],
    argsByToolCallId: new Map(),
    stepIndexByToolCallId: new Map(),
  };
}

function cloneState(state: ProjectionState): ProjectionState {
  return {
    steps: [...state.steps],
    argsByToolCallId: new Map(state.argsByToolCallId),
    stepIndexByToolCallId: new Map(state.stepIndexByToolCallId),
  };
}

function admitEvent(
  state: ProjectionState,
  event: SSESubRunTraceEvent,
  _index: number,
  projectCompactStep: ProjectCompactStep,
): void {
  if (event.kind === 'tool_call_decision') {
    if (!event.tool_calls) {
      throw new Error('[SubrunTrace] tool_call_decision 缺少正式 tool_calls');
    }
    for (const call of event.tool_calls) {
      state.argsByToolCallId.set(call.tool_call_id, call.args);
    }
    return;
  }
  if (event.kind !== 'tool_process' && event.kind !== 'tool_output') return;

  const toolName = readNonEmptyString(event.tool_name);
  const toolCallId = readNonEmptyString(event.tool_call_id);
  if (!toolName || !toolCallId) {
    throw new Error(`[SubrunTrace] ${event.kind} 缺少正式 tool_name 或 tool_call_id`);
  }

  const args = admitToolArguments(state, event, toolCallId);
  const status = resolveDisplayStatus(event.status);
  const durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : undefined;
  const request = createCompactStepRequest({
    sourceToolName: toolName,
    toolCallId,
    args,
    result: event.kind === 'tool_output' ? event.output : undefined,
    status,
    kind: event.kind,
  });
  const title = projectCompactStep(request)?.title ?? createUnknownToolTitle(toolName);
  const nextStep: SubrunTraceDisplayStep = {
    toolCallId,
    toolName,
    title,
    status,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
  const previousIndex = state.stepIndexByToolCallId.get(toolCallId);

  if (previousIndex === undefined) {
    state.stepIndexByToolCallId.set(toolCallId, state.steps.length);
    state.steps.push(nextStep);
    return;
  }

  const previous = state.steps[previousIndex];
  state.steps[previousIndex] = {
    ...nextStep,
    ...(durationMs === undefined && previous?.durationMs !== undefined
      ? { durationMs: previous.durationMs }
      : {}),
  };
}

function admitToolArguments(
  state: ProjectionState,
  event: SSESubRunTraceEvent,
  toolCallId: string,
): UnknownRecord {
  if (event.kind === 'tool_process' && isRecord(event.args)) {
    state.argsByToolCallId.set(toolCallId, event.args);
    return event.args;
  }

  const admitted = state.argsByToolCallId.get(toolCallId);
  if (!admitted) {
    throw new Error(
      `[SubrunTrace] ${event.kind} ${toolCallId} 缺少 decision/process 已接纳参数`,
    );
  }
  return admitted;
}

function resolveDisplayStatus(value: unknown): SubrunTraceDisplayStatus {
  if (value === 'loading' || value === 'success' || value === 'error') return value;
  throw new Error('[SubrunTrace] 工具事件缺少正式 status');
}

function createCompactStepRequest(input: {
  readonly sourceToolName: string;
  readonly toolCallId: string;
  readonly args: unknown;
  readonly result: unknown;
  status: SubrunTraceDisplayStatus,
  kind: 'tool_process' | 'tool_output';
}): ToolCompactStepProjectionRequest {
  const common = {
    sourceToolName: input.sourceToolName,
    toolCallId: input.toolCallId,
    args: input.args,
    result: input.result,
  };
  if (input.status === 'error') {
    return { ...common, status: 'error', phase: 'error' };
  }
  if (input.status === 'loading') {
    if (input.kind !== 'tool_process') {
      throw new Error('[SubrunTrace] loading lifecycle 必须来自 tool_process');
    }
    return { ...common, status: 'loading', phase: 'start' };
  }
  if (input.kind !== 'tool_output') {
    throw new Error('[SubrunTrace] success lifecycle 必须来自 tool_output');
  }
  return { ...common, status: 'success', phase: 'complete' };
}

function createUnknownToolTitle(toolName: string): ToolLocalizedTextDescriptor {
  const key = 'conversation.tool.subrunTrace.executeNamedTool' as const;
  return {
    key,
    fallback: CONVERSATION_MESSAGE_FALLBACKS[key],
    params: { toolName },
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
