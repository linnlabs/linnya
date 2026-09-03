import type Database from 'better-sqlite3';
import { audit, graph, runSupervisor, type ToolModelInputResolverPort } from 'linnkit/runtime-kernel';
import type { AuditPort, LlmInputMaterializerPort } from 'linnkit/ports';
import {
  LinnyaEventStoreAdapter,
  type IEventStore,
} from 'src/app-hosts/linnya/adapters/persistence/event-store';
import { SQLiteRunRegistryStore } from 'src/app-hosts/linnya/adapters/persistence/run-registry';
import { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { LinnyaAgentRuntimeScope } from 'src/app-hosts/linnya/adapters/runtime-assembly/agentRuntimeScope';

type DefaultRunSupervisor = runSupervisor.DefaultRunSupervisor<AgentInvokeRequest>;

export interface ConfigureAgentRuntimeSingletonsOptions {
  db: Database.Database;
  eventStore: IEventStore;
  llmInputMaterializer?: LlmInputMaterializerPort;
  toolModelInputResolver?: ToolModelInputResolverPort;
}

let singletons: LinnyaAgentRuntimeScope | null = null;
let fallbackEventStore: graph.MemoryEventStore | null = null;

function createFallbackAgentRuntimeSingletons(): LinnyaAgentRuntimeScope {
  const eventStore = getFallbackEventStore();
  const auditPort = audit.createEventStoreAudit({ eventStore });
  return {
    supervisor: createSupervisor({
      auditPort,
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    }),
    costCollector: new LinnyaRunCostCollector(),
    tokenCalibrationCollector: new LinnyaTokenCalibrationCollector(),
    eventStore,
    nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
    auditPort,
  };
}

function requireAgentRuntimeSingletons(): LinnyaAgentRuntimeScope {
  singletons ??= createFallbackAgentRuntimeSingletons();
  return singletons;
}

function createSupervisor(options: {
  auditPort: AuditPort;
  registryStore: runSupervisor.RunRegistryStore;
}): DefaultRunSupervisor {
  return new runSupervisor.DefaultRunSupervisor<AgentInvokeRequest>({
    registryStore: options.registryStore,
    auditPort: options.auditPort,
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
  options: ConfigureAgentRuntimeSingletonsOptions,
): LinnyaAgentRuntimeScope {
  const costCollector = singletons?.costCollector ?? new LinnyaRunCostCollector();
  const tokenCalibrationCollector = singletons?.tokenCalibrationCollector ?? new LinnyaTokenCalibrationCollector();
  const runtimeEventStore = new LinnyaEventStoreAdapter(options.db, options.eventStore);
  const auditPort = audit.createEventStoreAudit({ eventStore: runtimeEventStore });
  singletons = {
    supervisor: createSupervisor({
      auditPort,
      registryStore: new SQLiteRunRegistryStore(options.db),
    }),
    costCollector,
    tokenCalibrationCollector,
    eventStore: runtimeEventStore,
    nextEventStoreId: singletons?.nextEventStoreId ?? graph.createMonotonicEventStoreIdFactory(),
    auditPort,
    llmInputMaterializer: options.llmInputMaterializer,
    toolModelInputResolver: options.toolModelInputResolver,
  };
  return singletons;
}

/**
 * 应用启动时配置 SQLite runtime，并在开放新会话请求前收口上次进程遗留的活跃 run。
 *
 * 中文备注：恢复属于会话服务的启动门槛，不能放进延迟执行的通用维护任务。
 */
export async function bootstrapAgentRuntimeSingletons(
  options: ConfigureAgentRuntimeSingletonsOptions,
): Promise<{
  runtime: LinnyaAgentRuntimeScope;
  recoveredRuns: runSupervisor.RunOutcome[];
}> {
  const runtime = configureAgentRuntimeSingletons(options);
  const recoveredRuns = await runtime.supervisor.recoverOnBoot(
    'application restarted before run reached terminal status',
  );
  return { runtime, recoveredRuns };
}

export function getRunSupervisor(): LinnyaAgentRuntimeScope['supervisor'] {
  return requireAgentRuntimeSingletons().supervisor;
}

export function resetAgentRuntimeSingletonsForTest(): void {
  singletons = null;
  fallbackEventStore = null;
}

function getFallbackEventStore(): graph.MemoryEventStore {
  if (!fallbackEventStore) {
    fallbackEventStore = new graph.MemoryEventStore();
  }
  return fallbackEventStore;
}
