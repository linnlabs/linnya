import { runtimeKernel } from '../..';
import type { RuntimeEvent } from '../../contracts';

type ToolExecutionContext = runtimeKernel.tools.ToolExecutionContext;
type ToolContextPatch = runtimeKernel.tools.ToolContextPatch;

export type ToolContextFixture = ToolExecutionContext &
  Record<string, unknown>;

export interface ToolContextFixtureOptions {
  conversationId?: string;
  turnId?: string;
  historyEvents?: RuntimeEvent[];
  workingHistoryEvents?: RuntimeEvent[];
  persistedHistoryEvents?: RuntimeEvent[];
  patch?: ToolContextPatch;
}

export function createToolContextFixture(options: ToolContextFixtureOptions = {}): ToolContextFixture {
  const persistedHistoryEvents = options.persistedHistoryEvents ?? options.historyEvents ?? [];
  const workingHistoryEvents = options.workingHistoryEvents ?? options.historyEvents ?? persistedHistoryEvents;
  const context: ToolContextFixture = {
    conversationId: options.conversationId ?? 'conv_testkit',
    turnId: options.turnId ?? 'turn_testkit',
    abortSignal: new AbortController().signal,
    ...(options.patch ?? {}),
  };

  runtimeKernel.tools.ensureToolContextRuntimeCapability({
    context,
    persistedHistory: persistedHistoryEvents,
    workingHistory: workingHistoryEvents,
    executionMeta: {
      conversationId: context.conversationId,
      turnId: context.turnId,
      runId: context.runId,
      parentRunId: context.parentRunId,
    },
  });

  return context;
}
