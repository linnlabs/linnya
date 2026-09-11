import type { LinnyaAgentRuntimeScope } from 'src/app-hosts/linnya/adapters/runtime-assembly/agentRuntimeScope';

/**
 * Flow 执行期间唯一允许读取的 Agent runtime 端口。
 *
 * 这些依赖必须来自同一个 `LinnyaAgentRuntimeScope`。Flow 不在运行中查询进程全局状态，
 * 从而保证 root 注册、事件持久化、取消和资源释放始终作用于同一个 runtime。
 */
export type FlowRuntimePort = Pick<
  LinnyaAgentRuntimeScope,
  | 'supervisor'
  | 'costCollector'
  | 'eventStore'
  | 'nextEventStoreId'
  | 'runDescriptors'
  | 'createCheckpointWriter'
  | 'runAdmissionCommit'
>;
