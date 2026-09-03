import type { ToolContextConversationView } from './conversationView';
import type { ToolExecutionContext } from './toolExecutionContext';
import type { RunId, RuntimeEvent, ToolCallId } from '../../contracts';

type RuntimeEventSource = () => ReadonlyArray<RuntimeEvent>;

export interface ToolContextExecutionMeta {
  conversationId?: string;
  turnId?: string;
  runId?: RunId;
  parentRunId?: RunId;
  parentToolCallId?: ToolCallId;
}

export interface ToolContextRuntimeBinding {
  readonly conversationView: ToolContextConversationView;
  getWorkingHistoryEvents(): ReadonlyArray<RuntimeEvent>;
  getPersistedHistoryEvents(): ReadonlyArray<RuntimeEvent>;
  setWorkingHistorySource(source: ReadonlyArray<RuntimeEvent> | RuntimeEventSource): void;
  setPersistedHistorySource(source: ReadonlyArray<RuntimeEvent> | RuntimeEventSource): void;
  bindExecutionMeta(meta: ToolContextExecutionMeta): void;
  readExecutionMeta(): Readonly<ToolContextExecutionMeta>;
}

export const TOOL_CONTEXT_RUNTIME_RESERVED_KEYS = [
  'conversationView',
  'userQuery',
  'modelId',
  'conversationId',
  'turnId',
  'runId',
  'parentRunId',
  'childRunDepth',
  'childRunContextInjections',
  'parentToolCallId',
  'modelInputAdmission',
] as const;

const runtimeBindings = new WeakMap<ToolExecutionContext, ToolContextRuntimeBinding>();

function toEventSource(
  source: ReadonlyArray<RuntimeEvent> | RuntimeEventSource
): RuntimeEventSource {
  if (typeof source === 'function') {
    return source;
  }
  return () => source;
}

function syncExecutionMetaToContext(
  context: ToolExecutionContext,
  meta: ToolContextExecutionMeta
): void {
  if (typeof meta.conversationId === 'string') {
    context.conversationId = meta.conversationId;
  }
  if (typeof meta.turnId === 'string') {
    context.turnId = meta.turnId;
  }
  if (meta.runId !== undefined) {
    context.runId = meta.runId;
  }
  if (meta.parentRunId !== undefined) {
    context.parentRunId = meta.parentRunId;
  }
  if (meta.parentToolCallId !== undefined) {
    context.parentToolCallId = meta.parentToolCallId;
  }
}

function createRuntimeBinding(params: {
  context: ToolExecutionContext;
  persistedHistory: ReadonlyArray<RuntimeEvent> | RuntimeEventSource;
  workingHistory: ReadonlyArray<RuntimeEvent> | RuntimeEventSource;
  executionMeta?: ToolContextExecutionMeta;
}): ToolContextRuntimeBinding {
  let persistedHistorySource = toEventSource(params.persistedHistory);
  let workingHistorySource = toEventSource(params.workingHistory);
  let executionMeta: ToolContextExecutionMeta = {};

  const conversationView: ToolContextConversationView = {
    getWorkingHistoryEvents: () => workingHistorySource(),
    getPersistedHistoryEvents: () => persistedHistorySource(),
  };

  const binding: ToolContextRuntimeBinding = {
    conversationView,
    getWorkingHistoryEvents: () => conversationView.getWorkingHistoryEvents(),
    getPersistedHistoryEvents: () => conversationView.getPersistedHistoryEvents(),
    setWorkingHistorySource: source => {
      workingHistorySource = toEventSource(source);
    },
    setPersistedHistorySource: source => {
      persistedHistorySource = toEventSource(source);
    },
    bindExecutionMeta: meta => {
      executionMeta = {
        ...executionMeta,
        ...meta,
      };
      syncExecutionMetaToContext(params.context, executionMeta);
    },
    readExecutionMeta: () => ({ ...executionMeta }),
  };

  if (params.executionMeta) {
    binding.bindExecutionMeta(params.executionMeta);
  }

  return binding;
}

function readBinding(context: ToolExecutionContext): ToolContextRuntimeBinding | undefined {
  return runtimeBindings.get(context);
}

function pickDefaultHistorySource(params: {
  preferred?: ReadonlyArray<RuntimeEvent> | RuntimeEventSource;
  fallback?: () => ReadonlyArray<RuntimeEvent>;
}): ReadonlyArray<RuntimeEvent> | RuntimeEventSource {
  if (params.preferred !== undefined) {
    return params.preferred;
  }
  if (params.fallback) {
    return params.fallback;
  }
  return [];
}

function exposeRuntimeSurface(
  context: ToolExecutionContext,
  binding: ToolContextRuntimeBinding
): void {
  context.conversationView = binding.conversationView;
}

export function ensureToolContextRuntimeCapability(params: {
  context: ToolExecutionContext;
  persistedHistory?: ReadonlyArray<RuntimeEvent> | RuntimeEventSource;
  workingHistory?: ReadonlyArray<RuntimeEvent> | RuntimeEventSource;
  executionMeta?: ToolContextExecutionMeta;
}): ToolContextRuntimeBinding {
  let binding = readBinding(params.context);

  if (!binding) {
    const existingConversationView = params.context.conversationView;
    binding = createRuntimeBinding({
      context: params.context,
      persistedHistory: pickDefaultHistorySource({
        preferred: params.persistedHistory,
        fallback: existingConversationView
          ? () => existingConversationView.getPersistedHistoryEvents()
          : undefined,
      }),
      workingHistory: pickDefaultHistorySource({
        preferred: params.workingHistory,
        fallback: existingConversationView
          ? () => existingConversationView.getWorkingHistoryEvents()
          : undefined,
      }),
      executionMeta: params.executionMeta,
    });

    runtimeBindings.set(params.context, binding);
  } else {
    if (params.persistedHistory !== undefined) {
      binding.setPersistedHistorySource(params.persistedHistory);
    }
    if (params.workingHistory !== undefined) {
      binding.setWorkingHistorySource(params.workingHistory);
    }
    if (params.executionMeta) {
      binding.bindExecutionMeta(params.executionMeta);
    }
  }

  exposeRuntimeSurface(params.context, binding);
  return binding;
}

export function getToolContextRuntimeBinding(
  context: ToolExecutionContext
): ToolContextRuntimeBinding | undefined {
  return readBinding(context);
}

export function copyToolContextRuntimeCapability(
  source: ToolExecutionContext,
  target: ToolExecutionContext
): ToolContextRuntimeBinding {
  const sourceBinding = readBinding(source);
  if (!sourceBinding) {
    throw new Error('Cannot derive ToolContext before runtime capability admission.');
  }

  const existingTargetBinding = readBinding(target);
  if (existingTargetBinding) {
    exposeRuntimeSurface(target, existingTargetBinding);
    return existingTargetBinding;
  }

  // 中文说明：派生 ToolContext 时不能复用同一个 binding 对象；
  // 原 binding 的 execution meta 同步闭包绑定在 source 上，复用会把后续 meta 写回旧 context。
  const targetBinding = createRuntimeBinding({
    context: target,
    persistedHistory: () => sourceBinding.getPersistedHistoryEvents(),
    workingHistory: () => sourceBinding.getWorkingHistoryEvents(),
    executionMeta: sourceBinding.readExecutionMeta(),
  });

  runtimeBindings.set(target, targetBinding);

  exposeRuntimeSurface(target, targetBinding);
  return targetBinding;
}

export function readToolContextWorkingHistory(
  context: ToolExecutionContext
): ReadonlyArray<RuntimeEvent> {
  if (!context.conversationView) {
    throw new Error('ToolContext working history requires an admitted conversationView.');
  }
  return context.conversationView.getWorkingHistoryEvents();
}

export function readToolContextPersistedHistory(
  context: ToolExecutionContext
): ReadonlyArray<RuntimeEvent> {
  if (!context.conversationView) {
    throw new Error('ToolContext persisted history requires an admitted conversationView.');
  }
  return context.conversationView.getPersistedHistoryEvents();
}

export function stripRuntimeReservedToolContextPatch(
  patch: Partial<ToolExecutionContext> | Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!patch) {
    return {};
  }

  const nextPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((TOOL_CONTEXT_RUNTIME_RESERVED_KEYS as readonly string[]).includes(key)) {
      continue;
    }
    nextPatch[key] = value;
  }
  return nextPatch;
}
