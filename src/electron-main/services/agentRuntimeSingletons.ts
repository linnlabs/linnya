import type Database from 'better-sqlite3';
import {
  audit,
  execution,
  graph,
  runSupervisor,
  type ToolModelInputResolverPort,
} from '@linnlabs/linnkit/runtime-kernel';
import type { AuditPort, LlmInputMaterializerPort } from '@linnlabs/linnkit/ports';
import {
  LinnyaEventStoreAdapter,
  readRunCheckpointInteractions,
  type IEventStore,
} from 'src/app-hosts/linnya/adapters/persistence/event-store';
import { SQLiteRunRegistryStore } from 'src/app-hosts/linnya/adapters/persistence/run-registry';
import { SqliteRunDescriptorStore } from 'src/app-hosts/linnya/adapters/persistence/run-descriptors';
import {
  SqliteExecutionCommit,
  SqliteRunAdmissionCommit,
  SqliteToolResultReceipts,
} from 'src/app-hosts/linnya/adapters/persistence/execution-commit';
import {
  ExecutionCheckpointBindings,
  releaseTerminalRunRecovery,
  restoreCheckpointInteraction,
} from 'src/app-hosts/linnya/application/run-resumption';
import { SqliteCheckpointer } from 'src/app-hosts/linnya/adapters/persistence/checkpointer';
import { getLogger } from 'src/shared/logger';
import {
  LinnyaRunCostCollector,
  SqliteRunCostStateStore,
} from 'src/app-hosts/linnya/adapters/token-accounting';
import { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { LinnyaAgentRuntimeScope } from 'src/app-hosts/linnya/adapters/runtime-assembly/agentRuntimeScope';
import {
  createLinnyaAuditRuntime,
  resetLlmAuditForTest,
  resolveAuditLevel,
} from 'src/domains/audit';

type DefaultRunSupervisor = runSupervisor.DefaultRunSupervisor<AgentInvokeRequest>;

export interface ConfigureAgentRuntimeSingletonsOptions {
  db: Database.Database;
  eventStore: IEventStore;
  /** 来自已验证的 Backend bootstrap；生产包不能靠环境变量打开开发审计。 */
  packaged?: boolean;
  llmInputMaterializer?: LlmInputMaterializerPort;
  toolModelInputResolver?: ToolModelInputResolverPort;
  /** 组合根显式装配；无持久图执行的测试 Host 不注入恢复能力。 */
  recovery?: {
    runDescriptors: SqliteRunDescriptorStore;
    toolResults: SqliteToolResultReceipts;
    recoveryCheckpointer?: graph.Checkpointer;
    runAdmissionCommit: SqliteRunAdmissionCommit;
    executionCheckpoints: ExecutionCheckpointBindings;
    createCheckpointWriter: NonNullable<LinnyaAgentRuntimeScope['createCheckpointWriter']>;
  };
}

let singletons: LinnyaAgentRuntimeScope | null = null;
let fallbackEventStore: graph.MemoryEventStore | null = null;

function createFallbackAgentRuntimeSingletons(): LinnyaAgentRuntimeScope {
  const eventStore = getFallbackEventStore();
  const auditLevel = resolveAuditLevel();
  const auditRuntime = createLinnyaAuditRuntime({
    sink: audit.createEventStoreAudit({ eventStore }),
    level: auditLevel,
  });
  return {
    supervisor: createSupervisor({
      auditPort: auditRuntime.auditPort,
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    }),
    costCollector: new LinnyaRunCostCollector(),
    tokenCalibrationCollector: new LinnyaTokenCalibrationCollector(),
    eventStore,
    nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
    auditPort: auditRuntime.auditPort,
    auditEnabled: auditRuntime.level !== 'off',
  };
}

function requireAgentRuntimeSingletons(): LinnyaAgentRuntimeScope {
  singletons ??= createFallbackAgentRuntimeSingletons();
  return singletons;
}

function createSupervisor(options: {
  auditPort: AuditPort;
  registryStore: runSupervisor.RunRegistryStore;
  runDescriptors?: SqliteRunDescriptorStore;
}): DefaultRunSupervisor {
  const descriptors = options.runDescriptors;
  return new runSupervisor.DefaultRunSupervisor<AgentInvokeRequest>({
    registryStore: options.registryStore,
    auditPort: options.auditPort,
    ...(descriptors
      ? {
          awaitingUserStateOwner: 'host',
          canRestoreRun: record => descriptors.exists(record.runId),
        }
      : {}),
  });
}

/**
 * 主进程启动时配置 N-3 run runtime 单例。
 *
 * 中文备注：
 * - supervisor/costCollector 是进程级单例；
 * - eventStore 使用 LinnyaEventStoreAdapter 桥接 host SQLite EventStore 与 linnkit EventStore；
 * - 测试若没有走主进程 bootstrap，会退回 MemoryEventStore，避免把全局初始化泄漏到单元测试。
 */
export function configureAgentRuntimeSingletons(
  options: ConfigureAgentRuntimeSingletonsOptions
): LinnyaAgentRuntimeScope {
  const costCollector = options.recovery
    ? new LinnyaRunCostCollector(undefined, new SqliteRunCostStateStore(options.db))
    : (singletons?.costCollector ?? new LinnyaRunCostCollector());
  const tokenCalibrationCollector =
    singletons?.tokenCalibrationCollector ?? new LinnyaTokenCalibrationCollector();
  const runtimeEventStore = new LinnyaEventStoreAdapter(options.db, options.eventStore);
  const auditLevel = resolveAuditLevel(process.env, { packaged: options.packaged });
  const auditRuntime = createLinnyaAuditRuntime({
    sink: audit.createEventStoreAudit({ eventStore: runtimeEventStore }),
    level: auditLevel,
    trust: { packaged: options.packaged },
  });
  singletons = {
    supervisor: createSupervisor({
      auditPort: auditRuntime.auditPort,
      registryStore: new SQLiteRunRegistryStore(options.db),
      runDescriptors: options.recovery?.runDescriptors,
    }),
    costCollector,
    tokenCalibrationCollector,
    eventStore: runtimeEventStore,
    nextEventStoreId: singletons?.nextEventStoreId ?? graph.createMonotonicEventStoreIdFactory(),
    auditPort: auditRuntime.auditPort,
    auditEnabled: auditRuntime.level !== 'off',
    llmInputMaterializer: options.llmInputMaterializer,
    toolModelInputResolver: options.toolModelInputResolver,
    ...options.recovery,
  };
  return singletons;
}

/**
 * 应用启动时配置 SQLite runtime，并在开放新会话请求前收口上次进程遗留的活跃 run。
 *
 * 中文备注：恢复属于会话服务的启动门槛，不能放进延迟执行的通用维护任务。
 */
export async function bootstrapAgentRuntimeSingletons(
  options: ConfigureAgentRuntimeSingletonsOptions
): Promise<{
  runtime: LinnyaAgentRuntimeScope;
  recoveredRuns: runSupervisor.RunOutcome[];
}> {
  const executionCommit = new SqliteExecutionCommit(options.db);
  const runtime = configureAgentRuntimeSingletons({
    ...options,
    recovery: {
      runDescriptors: new SqliteRunDescriptorStore(options.db),
      toolResults: new SqliteToolResultReceipts(options.db),
      recoveryCheckpointer: new SqliteCheckpointer(options.db),
      runAdmissionCommit: new SqliteRunAdmissionCommit(options.db),
      executionCheckpoints: new ExecutionCheckpointBindings(),
      createCheckpointWriter: (runId, executionId) => async input => {
        runtime.costCollector.persist(runId);
        await executionCommit.forExecution(runId, executionId)(input);
      },
    },
  });
  const recoveredRuns = await runtime.supervisor.recoverOnBoot(
    'application restarted before run reached terminal status'
  );
  const paused = await runtime.supervisor.list({ status: ['paused', 'awaiting_user'] });
  for (const record of paused.runs) {
    try {
      const descriptor = await runtime.runDescriptors?.load(record.runId);
      if (!descriptor) continue;
      const checkpoint = await runtime.recoveryCheckpointer?.load(record.runId);
      const stored = await new SQLiteRunRegistryStore(options.db).load(record.runId);
      if (!stored) throw new Error('Restored run identity is missing');
      const committedInteractions =
        checkpoint?.executionStatus === 'awaiting_user' && checkpoint.revision !== undefined
          ? readRunCheckpointInteractions(
              options.db,
              record.conversationId,
              record.runId,
              checkpoint.revision
            )
          : [];
      const waiting = restoreCheckpointInteraction(
        stored,
        checkpoint ?? null,
        committedInteractions
      );
      if (checkpoint?.nodeId === 'llm' && checkpoint.executionStatus === 'executing') {
        const executionId = stored?.metadata?.executionId;
        if (typeof executionId === 'string')
          runtime.costCollector.markUncertainExecution(record.runId, executionId);
      }
      // 这里只重建控制 owner，不检查外部能力、不运行 Graph；能力缺失由继续 admission 单独报告。
      const sequencer = new execution.EventSequencer(record.conversationId);
      const handle = await runtime.supervisor.restoreRun({
        runId: record.runId,
        parentRunId: record.parentRunId,
        conversationId: record.conversationId,
        agentSpec: descriptor.agentSpec,
        request: descriptor.request,
        concurrencyKey:
          record.parentRunId || descriptor.options?.run_lane === 'auxiliary'
            ? undefined
            : `conversation:${record.conversationId}:foreground`,
        eventBus: new execution.EventBus(sequencer.getExecutionId()),
        eventStore: runtime.eventStore,
        costCollector: runtime.costCollector,
      });
      if (waiting) await handle.markAwaitingUser(waiting);
    } catch (error) {
      // 损坏的持久输入不能重造，也不能阻止其他对话启动；原记录保留用于诊断。
      const registry = new SQLiteRunRegistryStore(options.db);
      const original = await registry.load(record.runId);
      if (!original) throw error;
      await registry.save({
        ...original,
        status: 'failed',
        updatedAt: Date.now(),
        errorIfAny: {
          errorCode: 'RUN_RECOVERY_INPUT_INVALID',
          message: 'Original run inputs could not be restored',
          recoverable: false,
        },
      });
      getLogger('AgentRuntimeBootstrap').error(
        'Run restoration rejected; other runs remain available',
        { runId: record.runId, error }
      );
    }
  }
  const terminalRoots = (
    await runtime.supervisor.list({ status: ['completed', 'cancelled', 'failed'] })
  ).runs.filter(
    run => !run.parentRunId && run.errorIfAny?.errorCode !== 'RUN_RECOVERY_INPUT_INVALID'
  );
  for (const root of terminalRoots) {
    if (
      runtime.runDescriptors &&
      runtime.recoveryCheckpointer &&
      (await runtime.runDescriptors.exists(root.runId))
    ) {
      await releaseTerminalRunRecovery({
        runId: root.runId,
        supervisor: runtime.supervisor,
        checkpointer: runtime.recoveryCheckpointer,
        descriptors: runtime.runDescriptors,
      });
    }
  }
  return { runtime, recoveredRuns };
}

export function getRunSupervisor(): LinnyaAgentRuntimeScope['supervisor'] {
  return requireAgentRuntimeSingletons().supervisor;
}

export function resetAgentRuntimeSingletonsForTest(): void {
  singletons = null;
  fallbackEventStore = null;
  resetLlmAuditForTest();
}

function getFallbackEventStore(): graph.MemoryEventStore {
  if (!fallbackEventStore) {
    fallbackEventStore = new graph.MemoryEventStore();
  }
  return fallbackEventStore;
}
