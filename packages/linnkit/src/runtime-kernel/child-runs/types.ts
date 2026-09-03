import type { ToolExecutionContext } from '../tools/toolExecutionContext';
import type { RunId, RuntimeEvent, ToolCallId } from '../../contracts';

export const DEFAULT_MAX_CHILD_RUN_DEPTH = 4;

/**
 * child-run 父上下文的 runtime-owned 最小合同
 *
 * 中文备注：
 * - 这里只声明 child-run 协议真正需要的 runtime capability；
 * - 不显式依赖完整 ToolContext，避免 child-run 主链编译期吃进整套 host/product 服务类型；
 * - 产品语义字段（如 deep_search / research）不得在这里显式声明。
 */
export type ChildRunParentContext = ToolExecutionContext & object;

/**
 * child-run 内部真正注入到 GraphExecutor.local.toolContext 的最小合同。
 *
 * 中文备注：
 * - 这里表达的是“子 run 执行期间需要携带的 runtime capability + inherited patch”；
 * - 它不是完整 ToolContext，不应在 runtime-kernel 主链继续引入 host/product 服务类型；
 * - 具体产品工具在运行时仍可读到宿主透传下来的服务字段，但这些字段不在 child-run 协议层显式声明。
 */
export type ChildRunToolContext = ToolExecutionContext & {
  childRunDepth?: number;
};

export interface ChildRunHistoryPolicy {
  inheritTurns: number;
  /**
   * 是否把被选中父事件的附件显式传给 child run。
   *
   * 默认关闭：继承对话文本不等于授权 child 读取父附件；只有调用方明确开启时，
   * child final context 才会独立派生图片能力要求并走自己的物化链。
   */
  includeAttachments?: boolean;
  eventFilter?: (event: RuntimeEvent) => boolean;
}

export interface ChildRunTracePolicy {
  parentToolCallId?: ToolCallId;
  subrunId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface ChildRunExecutionPolicy {
  /**
   * 显式 child-run runId。默认由 host adapter 取 subrunId。
   */
  runId?: RunId;
  /**
   * child-run 的宿主会话归属。
   *
   * 中文备注：
   * - 同步 child-run 通常复用父 conversationId，方便 EventStore / Audit / Telemetry
   *   在同一条会话链路下写入 child run；
   * - 框架内部仍可使用独立 checkpoint key 隔离 GraphExecutor 状态。
   */
  conversationId?: string;
  /**
   * 父 runId。默认从 parentToolContext.runId 继承。
   */
  parentRunId?: RunId;
  maxSteps?: number;
  modelId?: string;
  abortSignal?: AbortSignal;
}

export interface ChildRunRequest<TParentToolContext = ChildRunParentContext> {
  userMessage: string;
  parentToolContext: TParentToolContext;
  historyPolicy?: ChildRunHistoryPolicy;
  tracePolicy?: ChildRunTracePolicy;
  executionPolicy?: ChildRunExecutionPolicy;
}

export interface ChildRunResult {
  runId?: RunId;
  parentRunId?: RunId;
  subrunId: string;
  success: boolean;
  cancelled?: boolean;
  finalAnswer?: string;
  /** 最近一段非终态可见进度，不能作为 child 的业务交付结果。 */
  lastProgress?: string;
  events: RuntimeEvent[];
  transcriptMessages?: unknown[];
  toolset?: {
    availableTools?: string[];
  };
  stepCount: number;
  error?: string;
  judgeToolOutput?: string;
}

export interface ChildRunInvokerPort<
  TRequest extends ChildRunRequest = ChildRunRequest,
  TResult extends ChildRunResult = ChildRunResult,
> {
  invoke(params: TRequest): Promise<TResult>;
}
