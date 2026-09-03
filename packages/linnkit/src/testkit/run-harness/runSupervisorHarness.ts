import {
  RunIdSchema,
  type AgentSpec,
  type EventEnvelope,
  type RoutedRuntimeEvent,
} from '../../contracts';
import {
  execution,
  graph,
  runSupervisor,
  type runSupervisor as runSupervisorTypes,
} from '../../runtime-kernel';
import { createCollectingAuditPort, type CollectingAuditPortHarness } from './collectingAuditPort';
import { createMockTelemetryPort, type MockTelemetryPortHarness } from './mockTelemetryPort';

type RunHandle<TRequest extends runSupervisorTypes.RunRequestSnapshot> =
  runSupervisorTypes.RunHandle<TRequest>;
type RunRecord = runSupervisorTypes.RunRecord;
type RunRequestSnapshot = runSupervisorTypes.RunRequestSnapshot;
type RunExecutorPort<TRequest extends RunRequestSnapshot> =
  runSupervisorTypes.RunExecutorPort<TRequest>;

export interface RunSupervisorHarness<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  supervisor: runSupervisor.DefaultRunSupervisor<TRequest>;
  registry: runSupervisor.MemoryRunRegistryStore;
  eventStore: graph.MemoryEventStore;
  eventBus: execution.EventBus;
  audit: CollectingAuditPortHarness;
  telemetry: MockTelemetryPortHarness;
  registerRun(
    params?: Partial<{
      runId: string;
      parentRunId: string;
      conversationId: string;
      agentSpec: AgentSpec;
      request: TRequest;
      metadata: Record<string, unknown>;
    }>
  ): Promise<RunHandle<TRequest>>;
  spawnDetached(
    params?: Partial<{
      runId: string;
      parentRunId: string;
      conversationId: string;
      agentSpec: AgentSpec;
      request: TRequest;
      metadata: Record<string, unknown>;
    }>
  ): Promise<RunHandle<TRequest>>;
  publish(event: RoutedRuntimeEvent, seq?: number): void;
  persist(event: RoutedRuntimeEvent, eventStoreId?: string): Promise<void>;
  getRegisteredRuns(): Promise<RunRecord[]>;
  restore(): void;
}

const DEFAULT_AGENT_SPEC: AgentSpec = {
  id: 'test-agent',
  version: '0.0.0',
  capabilities: ['agent'],
  tools: [],
  contextPolicy: { profileId: 'agent' },
};

function defaultRequest(): RunRequestSnapshot {
  return { query: 'test run' };
}

function cloneEvent(event: RoutedRuntimeEvent): RoutedRuntimeEvent {
  return structuredClone(event);
}

/**
 * RunSupervisor 一站式测试夹具。
 *
 * 中文备注：
 * - 只使用 linnkit package 内部 port，不依赖具体 host；
 * - 适合协议测试、外部接入方测试、Quickstart/CLI 的最小 run 验证。
 */
export function createRunSupervisorHarness<
  TRequest extends RunRequestSnapshot = RunRequestSnapshot,
>(
  options: Partial<{
    executionId: string;
    now: () => number;
    runIdFactory: () => string;
    executor: RunExecutorPort<TRequest>;
  }> = {}
): RunSupervisorHarness<TRequest> {
  const registry = new runSupervisor.MemoryRunRegistryStore();
  const eventStore = new graph.MemoryEventStore();
  const eventBus = new execution.EventBus(options.executionId ?? 'exec_testkit');
  const audit = createCollectingAuditPort();
  const telemetry = createMockTelemetryPort();
  const rawRunIdFactory = options.runIdFactory;
  const runIdFactory = rawRunIdFactory ? () => RunIdSchema.parse(rawRunIdFactory()) : undefined;
  const supervisor = new runSupervisor.DefaultRunSupervisor<TRequest>({
    registryStore: registry,
    auditPort: audit.port,
    executor: options.executor,
    runIdFactory,
    now: options.now,
  });

  const harness: RunSupervisorHarness<TRequest> = {
    supervisor,
    registry,
    eventStore,
    eventBus,
    audit,
    telemetry,

    async registerRun(params = {}): Promise<RunHandle<TRequest>> {
      const conversationId = params.conversationId ?? 'conv_testkit';
      const request = params.request ?? (defaultRequest() as TRequest);
      return supervisor.registerRun({
        runId: params.runId === undefined ? undefined : RunIdSchema.parse(params.runId),
        parentRunId:
          params.parentRunId === undefined ? undefined : RunIdSchema.parse(params.parentRunId),
        conversationId,
        agentSpec: params.agentSpec ?? DEFAULT_AGENT_SPEC,
        request,
        eventBus,
        eventStore,
        costCollector: telemetry.costCollector,
        metadata: params.metadata,
      });
    },

    async spawnDetached(params = {}): Promise<RunHandle<TRequest>> {
      const conversationId = params.conversationId ?? 'conv_testkit';
      const request = params.request ?? (defaultRequest() as TRequest);
      return supervisor.spawnDetached({
        runId: params.runId === undefined ? undefined : RunIdSchema.parse(params.runId),
        parentRunId:
          params.parentRunId === undefined ? undefined : RunIdSchema.parse(params.parentRunId),
        conversationId,
        agentSpec: params.agentSpec ?? DEFAULT_AGENT_SPEC,
        request,
        eventBus,
        eventStore,
        costCollector: telemetry.costCollector,
        metadata: params.metadata,
      });
    },

    publish(event: RoutedRuntimeEvent, seq = 1): void {
      const envelope: EventEnvelope<RoutedRuntimeEvent> = {
        seq,
        timestamp: event.timestamp,
        trace: { execution_id: eventBus.executionId },
        source: 'testkit',
        payload: cloneEvent(event),
      };
      eventBus.publish(envelope);
    },

    async persist(
      event: RoutedRuntimeEvent,
      eventStoreId = String(event.timestamp).padStart(13, '0')
    ): Promise<void> {
      await eventStore.append({
        eventStoreId,
        event: cloneEvent(event),
      });
    },

    async getRegisteredRuns(): Promise<RunRecord[]> {
      return (await registry.list()).runs;
    },

    restore(): void {
      eventBus.close();
      audit.reset();
      telemetry.reset();
    },
  };

  return harness;
}
