import type { AuditPort, LlmInputMaterializerPort } from 'linnkit/ports';
import type { graph, runSupervisor, ToolModelInputResolverPort } from 'linnkit/runtime-kernel';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';

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
  readonly llmInputMaterializer?: LlmInputMaterializerPort;
  readonly toolModelInputResolver?: ToolModelInputResolverPort;
}
