import type { execution } from 'linnkit/runtime-kernel';
import type { runSupervisor } from 'linnkit/runtime-kernel';
import type { graph } from 'linnkit/runtime-kernel';
import type {
  ConversationNextRequest,
  FlowExecutionResult,
  RuntimeEvent,
  SSESink,
} from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';

/**
 * Flow host application layer -> runner 的显式交接端口。
 *
 * 中文备注：
 * - 这里描述的是 host session 已准备好的 runtime ports，不是 runner 自己 new 出来的资源；
 * - `EventBus / Sequencer / realtimeSink` 继续由 host session 拥有，runner 只消费。
 */
export interface FlowRunnerHostPorts {
  eventBus: execution.EventBus;
  sequencer: execution.EventSequencer;
  realtimeSink: SSESink;
  runtimeEventSink: graph.RuntimeEventSink;
  /** 自动压缩摘要在 realtime fan-out 前的窄 durable commit 边界。 */
  runtimeEventCommitPort?: graph.RuntimeEventCommitPort;
  getGeneratedEvents: () => RuntimeEvent[];
  /** root run 写终态前，等待本轮全部 durable event 短事务完成。 */
  drainPersistence: () => Promise<void>;
}

/**
 * Flow orchestrator -> agent runner 的单次 run 交接契约。
 *
 * 中文备注：
 * - 用显式对象替代位置参数，避免 host handoff 和业务输入混在一起；
 * - `result` 仍然是既有 `FlowExecutionResult`，不改对外行为，只收边界。
 */
export interface FlowAgentRunRequest {
  conversationId: string;
  turnId: string;
  request: AgentInvokeRequest;
  history: RuntimeEvent[];
  newEvents: RuntimeEvent[];
  options: ConversationNextRequest['options'];
  hostPorts: FlowRunnerHostPorts;
  /**
   * N-3 RunHandle。runner 只读取 signal 和写生命周期状态，取消入口仍由 host 持有。
   */
  runHandle: runSupervisor.RunHandle<AgentInvokeRequest>;
  execution:
    | { readonly kind: 'start' }
    | { readonly kind: 'resume'; readonly expectedCheckpointRevision: number };
}

export interface FlowAgentRunExecution extends PromiseLike<FlowExecutionResult> {
  handle: runSupervisor.RunHandle<AgentInvokeRequest>;
  result: Promise<FlowExecutionResult>;
}

/** Flow orchestration 只依赖 runner 的单一执行能力，不认识具体 GraphExecutor 实现。 */
export interface FlowAgentRunnerPort {
  run(request: FlowAgentRunRequest): FlowAgentRunExecution;
  discardCheckpoint(runId: string): Promise<void>;
}
