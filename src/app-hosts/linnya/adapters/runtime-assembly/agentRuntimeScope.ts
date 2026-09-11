import type { AuditPort, LlmInputMaterializerPort } from '@linnlabs/linnkit/ports';
import type {
  graph,
  runSupervisor,
  ToolModelInputResolverPort,
} from '@linnlabs/linnkit/runtime-kernel';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { RunDescriptorStore, RunAdmissionCommitPort } from '../../application/run-resumption';
import type { ExecutionCheckpointBindings } from '../../application/run-resumption';
import type { CheckpointWriter } from '../persistence/execution-commit';
import type { SqliteToolResultReceipts } from '../persistence/execution-commit';

/**
 * 一次 Linnya 应用运行期共享的 Agent 基础设施作用域。
 *
 * 这里表达“这些端口必须来自同一次装配”，而不是提供新的全局访问入口。
 * root、child、审计和持久化必须显式持有同一个 scope，禁止在执行中分别读取全局状态。
 */
export interface LinnyaAgentRuntimeScope {
  readonly supervisor: runSupervisor.RunSupervisor<AgentInvokeRequest>;
  readonly costCollector: LinnyaRunCostCollector;
  readonly tokenCalibrationCollector: LinnyaTokenCalibrationCollector;
  readonly eventStore: graph.EventStore;
  readonly nextEventStoreId: () => string;
  readonly auditPort: AuditPort;
  /** 开发 Agent Run Audit 是否在当前 Host 进程启用。 */
  readonly auditEnabled: boolean;
  readonly llmInputMaterializer?: LlmInputMaterializerPort;
  readonly toolModelInputResolver?: ToolModelInputResolverPort;
  readonly runDescriptors?: RunDescriptorStore;
  readonly toolResults?: SqliteToolResultReceipts;
  readonly recoveryCheckpointer?: graph.Checkpointer;
  readonly runAdmissionCommit?: RunAdmissionCommitPort;
  readonly executionCheckpoints?: ExecutionCheckpointBindings;
  readonly createCheckpointWriter?: (runId: string, executionId: string) => CheckpointWriter;
}
