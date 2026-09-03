import type { ToolContextConversationView } from './conversationView';
import type { SubRunTracePublisher } from '../child-run-trace/subrunTrace.types';
import type { ChildRunInvokerPort } from '../child-runs/types';
import type { RunId, ToolCallId } from '../../contracts';
import type { AgentContextInjection } from '../../ports';
import type { ToolModelInputAdmission } from './model-input/definitions/toolModelInputPolicy';

/**
 * runtime-owned 工具执行上下文最小合同
 *
 * 中文备注：
 * - 这里只保留 graph-engine / tool runtime / child-run 真正需要解释执行的字段；
 * - 不包含任何 host 存储、检索或数据库服务类型；
 * - 不包含具体产品 workflow 的语义字段。
 */
export interface ToolExecutionContext {
  /**
   * 当前工具调用的模型输入准入事实，由 ToolNode 按真实 active model 写入。
   *
   * 工具只能用它决定是否生产声明为 `when_supported` 的增强附件；不得据此猜模型、Provider 或 route。
   */
  modelInputAdmission?: ToolModelInputAdmission;

  /** 当前用户请求的原始文本；由 run admission 注入，工具只读。 */
  userQuery?: string;

  /** 当前 run 已选定的模型 ID；需要继承模型的 child-run 从这里读取。 */
  modelId?: string;

  /**
   * 当前对话 run 的唯一标识（由 host admission 注入）。
   * 说明：工具不得把 runId 当作业务数据身份；它只服务运行链路追踪和关联。
   */
  runId?: RunId;

  /**
   * 父级 run 标识。
   *
   * 中文备注：
   * - 顶层 run 通常为空；
   * - 同步 child-run 会把自己的 `runId` 设为子 run / subrun ID，同时把父 run 写到这里；
   * - Telemetry / Audit / Cost 聚合依赖这个字段建立父子关系，但 graph-engine 不解释产品语义。
   */
  parentRunId?: RunId;

  /**
   * 当前工具执行所处的 child-run 嵌套深度。
   *
   * 中文说明：
   * - 顶层 run 缺省为 0；
   * - runtime-kernel 在创建 child-run ToolContext 时递增；
   * - 这是通用执行期信号，不表达具体产品 workflow。
   */
  childRunDepth?: number;

  /**
   * root admission 冻结的 child-run 环境上下文。
   *
   * 中文备注：runtime 只透传通用注入，不解释项目、文档或插件视图等 Host 语义。
   * 它与父会话历史继承相互独立。
   */
  childRunContextInjections?: ReadonlyArray<AgentContextInjection>;

  /**
   * 🔥 取消信号（贯穿一次对话请求）
   *
   * 约定：
   * - 工具实现必须在合适的边界检查 `abortSignal.aborted` 并尽快退出；
   * - 该字段属于“执行期上下文”，不应被写入持久化事件。
   */
  abortSignal?: AbortSignal;

  /**
   * 🔥 当前这次工具调用的 tool_call_id（由 ToolNode 在执行前注入）
   *
   * 说明：
   * - tool_call_id 属于“事件层/执行层”的稳定关联键；
   * - 工具内部如果需要发布 subrun_trace（子 run 过程），必须使用该字段作为 parent_tool_call_id。
   * - 该字段仅在工具执行期间有效，不应被工具写入持久化历史。
   */
  parentToolCallId?: ToolCallId;

  /**
   * 🔥 当前对话 ID（由 GraphExecutor/ToolNode 注入，用于工具内部做链路追踪）
   */
  conversationId?: string;

  /**
   * 🔥 当前轮次 ID（由 GraphExecutor/ToolNode 注入，用于工具内部做链路追踪）
   */
  turnId?: string;

  /**
   * 🔥 显式会话视图 capability
   *
   * 中文备注：working 与 persisted history 含义不同，工具必须显式选择，禁止使用含糊的 history getter。
   */
  conversationView?: ToolContextConversationView;

  /**
   * 🔥 SubRun Trace Channel：为工具提供 publisher 工厂（低耦合）
   */
  createSubRunTracePublisher?: (opts: {
    parentToolCallId: ToolCallId;
    subrunId: string;
    subrunParentId?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }) => SubRunTracePublisher;

  /**
   * 显式 child-run invoker 注入。
   */
  registeredChildRunInvoker?: ChildRunInvokerPort;
}
