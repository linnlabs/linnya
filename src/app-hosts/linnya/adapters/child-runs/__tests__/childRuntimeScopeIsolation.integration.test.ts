import { PromptKeys } from '@app/schemas';
import { describe, expect, it } from 'vitest';
import type { AgentInvocationRequest } from 'linnkit/ports';
import { audit, graph, runSupervisor, telemetry } from 'linnkit/runtime-kernel';
import {
  createHistorySummaryEvent,
  type RoutedRuntimeEvent,
} from 'linnkit/contracts';
import { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import {
  createRegisteredChildRunInvoker,
  type RegisteredChildRunInvokerPort,
} from '../registeredSubagentInvoker';
import { RunIdSchema } from 'linnkit/contracts';

function createIsolatedRuntime(label: string): {
  invoker: RegisteredChildRunInvokerPort;
  eventStore: graph.MemoryEventStore;
  supervisor: runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>;
} {
  const eventStore = new graph.MemoryEventStore();
  const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
    registryStore: new runSupervisor.MemoryRunRegistryStore(),
    auditPort: audit.createEventStoreAudit({ eventStore }),
  });
  const costCollector = new LinnyaRunCostCollector();
  const agentDefinition = {
    id: `agent-${label}`,
    promptKey: PromptKeys.DEFAULT,
    defaultMode: 'agent' as const,
    description: `isolated ${label}`,
  };

  return {
    eventStore,
    supervisor,
    invoker: createRegisteredChildRunInvoker({
      runtime: {
        supervisor,
        eventStore,
        nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
        costCollector,
        auditPort: audit.createEventStoreAudit({ eventStore }),
      },
      telemetryPort: telemetry.noopTelemetry,
      agentResolver: {
        resolveByPromptKey: () => ({
          agentDefinition,
          agentConfig: {
            id: agentDefinition.id,
            promptKey: agentDefinition.promptKey,
          },
        }),
      },
      childRunInvoker: {
        invoke: async params => {
          const runId = params.runId ?? `child-${label}`;
          const summary = createHistorySummaryEvent(
            `summary-${runId}`,
            params.conversationId ?? '',
            `turn-${runId}`,
            `checkpoint-${runId}`,
            [`old-${runId}`],
            1,
            1,
          );
          if (!params.runtimeEventCommitPort) {
            throw new Error('child compaction requires a durable commit port');
          }
          await params.runtimeEventCommitPort(summary, `scope-${label}.compaction`);
          const summaryEvent = params.runtimeEventSink(
            summary,
            `scope-${label}.compaction`,
          );
          const event = params.runtimeEventSink(
            {
              type: 'final_answer',
              id: `answer-${runId}`,
              conversation_id: params.conversationId ?? '',
              turn_id: `turn-${runId}`,
              timestamp: Date.now(),
              version: 1,
              content: `result-${label}`,
              answer_id: `answer-${runId}`,
              is_complete: true,
              completion_reason: 'terminal',
            },
            `scope-${label}`
          );
          return {
            success: true,
            runId: params.runId,
            parentRunId: params.parentRunId,
            subrunId: params.runId ?? `child-${label}`,
            finalAnswer: `result-${label}`,
            events: [summaryEvent, event],
            stepCount: 1,
          };
        },
      },
      commandRuntime: { kind: 'disabled' },
    }),
  };
}

function createParentContext(label: string) {
  return {
    conversationId: `conversation-${label}`,
    runId: RunIdSchema.parse(`parent-${label}`),
    modelId: 'model-test',
    conversationView: {
      getWorkingHistoryEvents: () => [],
      getPersistedHistoryEvents: () => [],
    },
  };
}

describe('child runtime scope isolation', () => {
  it('两套 runtime 并发执行时，child 事实和生命周期只进入各自作用域', async () => {
    const runtimeA = createIsolatedRuntime('a');
    const runtimeB = createIsolatedRuntime('b');

    await Promise.all([
      runtimeA.invoker.invoke({
        promptKey: PromptKeys.DEFAULT,
        userMessage: 'run a',
        parentToolContext: createParentContext('a'),
        tracePolicy: { subrunId: 'child-a' },
      }),
      runtimeB.invoker.invoke({
        promptKey: PromptKeys.DEFAULT,
        userMessage: 'run b',
        parentToolContext: createParentContext('b'),
        tracePolicy: { subrunId: 'child-b' },
      }),
    ]);

    const eventsA = await runtimeA.eventStore.range('conversation-a');
    const eventsB = await runtimeB.eventStore.range('conversation-b');
    const runtimeFactsA = eventsA
      .map(record => record.event)
      .filter(
        (event): event is Extract<RoutedRuntimeEvent, { type: 'final_answer' }> =>
          event.type === 'final_answer'
      );
    const runtimeFactsB = eventsB
      .map(record => record.event)
      .filter(
        (event): event is Extract<RoutedRuntimeEvent, { type: 'final_answer' }> =>
          event.type === 'final_answer'
      );

    expect(runtimeFactsA.map(event => event.content)).toEqual(['result-a']);
    expect(runtimeFactsB.map(event => event.content)).toEqual(['result-b']);
    await expect(runtimeA.eventStore.range('conversation-b')).resolves.toEqual([]);
    await expect(runtimeB.eventStore.range('conversation-a')).resolves.toEqual([]);
    await expect(runtimeA.supervisor.peek(RunIdSchema.parse('child-a'))).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(runtimeB.supervisor.peek(RunIdSchema.parse('child-b'))).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(runtimeA.supervisor.peek(RunIdSchema.parse('child-b'))).resolves.toBeNull();
    await expect(runtimeB.supervisor.peek(RunIdSchema.parse('child-a'))).resolves.toBeNull();
  });

  it('同一父 run 的两个 child 并发压缩时，各自摘要只写一次且保留路由身份', async () => {
    const runtime = createIsolatedRuntime('siblings');
    const parentContext = createParentContext('siblings');

    await Promise.all([
      runtime.invoker.invoke({
        promptKey: PromptKeys.DEFAULT,
        userMessage: 'run first child',
        parentToolContext: parentContext,
        tracePolicy: { subrunId: 'child-sibling-a' },
      }),
      runtime.invoker.invoke({
        promptKey: PromptKeys.DEFAULT,
        userMessage: 'run second child',
        parentToolContext: parentContext,
        tracePolicy: { subrunId: 'child-sibling-b' },
      }),
    ]);

    const records = await runtime.eventStore.range('conversation-siblings');
    const summaries = records
      .map(record => record.event)
      .filter(
        (event): event is Extract<RoutedRuntimeEvent, { type: 'history_summary' }> =>
          event.type === 'history_summary',
      );

    expect(summaries).toHaveLength(2);
    expect(summaries.map(event => ({
      id: event.id,
      runId: event.run_id,
      parentRunId: event.parent_run_id,
      lane: event.lane,
      visibility: event.visibility,
    })).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      {
        id: 'summary-child-sibling-a',
        runId: 'child-sibling-a',
        parentRunId: 'parent-siblings',
        lane: 'child',
        visibility: 'parent-trace',
      },
      {
        id: 'summary-child-sibling-b',
        runId: 'child-sibling-b',
        parentRunId: 'parent-siblings',
        lane: 'child',
        visibility: 'parent-trace',
      },
    ]);
  });
});
