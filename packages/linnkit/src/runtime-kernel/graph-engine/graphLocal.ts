import type { AgentInvocationRequest } from '../../ports';
import type { ToolExecutionContext } from '../tools/toolExecutionContext';
import type {
  EngineLocalState,
  ExecutorLocalState,
  RuntimeEventCommitPort,
  RuntimeEventSink,
  RuntimeFailureFactSink,
} from './types';
import type { RuntimeEvent } from '../../contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAgentInvocationRequest(value: unknown): value is AgentInvocationRequest {
  if (!isRecord(value)) return false;
  if (typeof value.query !== 'string') return false;
  if (typeof value.promptKey !== 'string') return false;
  if (value.maxSteps !== undefined && typeof value.maxSteps !== 'number') return false;
  if (value.enableTools !== undefined && typeof value.enableTools !== 'boolean') return false;
  if (value.availableTools !== undefined) {
    if (!Array.isArray(value.availableTools)) return false;
    if (!value.availableTools.every((item) => typeof item === 'string')) return false;
  }
  return true;
}

function isToolExecutionContext(value: unknown): value is ToolExecutionContext {
  return isRecord(value);
}

function isRuntimeEventArray(value: unknown): value is RuntimeEvent[] {
  return Array.isArray(value);
}

function isExecutorLocalState(value: unknown): value is ExecutorLocalState {
  return isRecord(value) && typeof value.stepCount === 'number';
}

type SummarizationCallbacks = NonNullable<EngineLocalState['summarizationCallbacks']>;

function isSummarizationCallbacks(value: unknown): value is SummarizationCallbacks {
  return isRecord(value);
}

function isRuntimeEventSink(value: unknown): value is RuntimeEventSink {
  return typeof value === 'function';
}

function isRuntimeEventCommitPort(value: unknown): value is RuntimeEventCommitPort {
  return typeof value === 'function';
}

function isRuntimeFailureFactSink(value: unknown): value is RuntimeFailureFactSink {
  return typeof value === 'function';
}

export interface GraphAgentLocalView {
  conversationId: string;
  turnId?: string;
  request?: AgentInvocationRequest;
  toolContext?: ToolExecutionContext;
  history: RuntimeEvent[];
  runtimeEventSink: RuntimeEventSink;
  runtimeEventCommitPort?: RuntimeEventCommitPort;
  runtimeFailureFactSink?: RuntimeFailureFactSink;
  executorLocal?: ExecutorLocalState;
  answerId?: string;
  chunkSeq: number;
  signal?: AbortSignal;
  summarizationCallbacks?: SummarizationCallbacks;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readGraphAgentLocal(local: EngineLocalState | undefined): GraphAgentLocalView {
  const source = local ?? {};
  const answerId = readNonEmptyString(source.answerId);
  const chunkSeq = Number.isInteger(source.chunkSeq) ? Number(source.chunkSeq) : 0;

  return {
    conversationId: readNonEmptyString(source.conversationId) ?? '',
    turnId: readNonEmptyString(source.turnId),
    request: isAgentInvocationRequest(source.request) ? source.request : undefined,
    toolContext: isToolExecutionContext(source.toolContext) ? source.toolContext : undefined,
    history: isRuntimeEventArray(source.history) ? source.history : [],
    runtimeEventSink: requireRuntimeEventSink(source),
    runtimeEventCommitPort: isRuntimeEventCommitPort(source.runtimeEventCommitPort)
      ? source.runtimeEventCommitPort
      : undefined,
    runtimeFailureFactSink: isRuntimeFailureFactSink(source.runtimeFailureFactSink)
      ? source.runtimeFailureFactSink
      : undefined,
    executorLocal: isExecutorLocalState(source.executorLocal) ? source.executorLocal : undefined,
    answerId,
    chunkSeq,
    signal: source.signal instanceof AbortSignal ? source.signal : undefined,
    summarizationCallbacks: isSummarizationCallbacks(source.summarizationCallbacks)
      ? source.summarizationCallbacks
      : undefined,
  };
}

/** 可执行 Graph 必须由装配层显式提供 admission sink，节点不得返回未路由草稿。 */
export function requireRuntimeEventSink(
  local: EngineLocalState | Record<string, unknown> | undefined,
): RuntimeEventSink {
  const source = local ?? {};
  if (!isRuntimeEventSink(source.runtimeEventSink)) {
    throw new Error('Graph execution requires an explicit runtimeEventSink.');
  }
  return source.runtimeEventSink;
}
