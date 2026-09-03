import type { ToolObservationPreviewMeta } from './ui-types';
import type { ToolExecutionContext } from './toolExecutionContext';
import type { AgentInvocationRequest } from '../../ports';
import type {
  FunctionToolSchema,
  ToolCallStreamingPolicy,
  ToolArgs,
  ToolParameterSchema,
} from './toolContracts';
import type { ToolIdempotencyPolicy } from './idempotency/toolIdempotency';
import type { ModelInputRequirement } from '../llm/input-capabilities';
import type { ModelInputCompatibility } from '../llm/input-capabilities';
import type { ToolModelInputDelivery } from './model-input';
import type { RuntimeResourceRef } from '../../contracts';

export interface ToolRuntimeDefinition {
  parameters: ToolParameterSchema;
  /**
   * 工具 owner 的深层参数 admission。
   *
   * ToolNode 在发布 tool_process(start) 之前调用它；失败会直接结算为
   * tool_output(error)，避免把尚未真正启动的调用展示成 running。
   */
  validateArguments?: (args: ToolArgs) => { success: boolean; error?: string };
  idempotency?: ToolIdempotencyPolicy;
  /** 静态声明该工具成功结果可能要求的模型输入能力。 */
  modelInputRequirement?: ModelInputRequirement;
  /** 未声明时保持既有 required 语义。 */
  modelInputDelivery?: ToolModelInputDelivery;
  /**
   * 按本次规范化参数解析执行前的模型输入要求。
   *
   * 中文说明：
   * - 只用于同一工具既可能返回纯文本、也可能返回模型附件的真实场景；
   * - 动态 resolver 存在时取代静态声明，返回 undefined 表示本次调用无额外要求；
   * - prepare 阶段仍只消费静态声明，不能在模型产生工具参数前猜测动态结果。
   * - resolver 抛错时 ToolNode 会拒绝本次调用、生成配对 error output，并继续同批其他调用；
   *   宿主异常原文不会进入模型上下文或审计 reason。
   */
  resolveModelInputRequirement?: (args: ToolArgs) => ModelInputRequirement | undefined;
  /** LLM 流式 tool_call 的通用事件发布策略；未声明即不发布早期生命周期事件。 */
  streaming?: ToolCallStreamingPolicy;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
  /** 工具 owner 声明的稳定业务错误码；不得从自然语言错误文本反推。 */
  errorCode?: string;
  errorKind?: 'protocol' | 'execution' | 'capability';
  durationMs: number;
  idempotency?: { key: string; cacheHit: boolean };
  /** 幂等历史命中时复用已经完成授权与完整性校验的正式资源引用。 */
  cachedAttachments?: readonly RuntimeResourceRef[];
}

export interface ToolModelInputCapabilityValidatorPort {
  evaluate(input: {
    readonly activeModelId: string;
    readonly requirement: ModelInputRequirement;
  }): ModelInputCompatibility;

  assertCompatible(input: {
    readonly activeModelId: string;
    readonly requirement: ModelInputRequirement;
  }): void;
}

export type ObservationPreviewMeta = ToolObservationPreviewMeta;

export type ObservationPreviewContext = ToolExecutionContext;

/**
 * Host 按本次 Agent 调用构建工具 Schema 的最小输入。
 *
 * Linnkit 只规定调用时机并转交通用 invocation；Host 如何验证扩展字段并
 * 派生 concrete tools 的窄动态 Schema 上下文，属于 Host 工具注册表职责。
 */
export interface ToolSchemaBuildRequest {
  readonly toolNames?: readonly string[];
  readonly invocation: AgentInvocationRequest;
}

export type ObservationPreviewResult =
  | { truncated: false; preview: string }
  | {
      truncated: true;
      preview: string;
      blob_id: string;
      originalChars?: number;
      previewChars?: number;
      originalLines?: number;
      previewLines?: number;
    };

export interface ToolCatalogPort {
  getToolSchemas(input: ToolSchemaBuildRequest): FunctionToolSchema[];
  getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined;
}

export interface ToolExecutionPort {
  executeTool(
    toolName: string,
    args: ToolArgs,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}

export interface ObservationPreviewPort {
  /**
   * 执行期 observation 预览/落盘治理。
   *
   * 中文说明：
   * - framework 只把 `maxChars/maxLines` 和工具上下文传给 host；
   * - 完整内容写到本地目录、对象存储还是数据库，由 host 的这个 port 决定；
   * - 如果返回 `blob_id`，host 需要保证对应读取工具使用同一个 store。
   */
  truncateObservation(params: {
    context: ObservationPreviewContext;
    toolName: string;
    text: string;
    maxChars: number;
    maxLines: number;
    meta?: ObservationPreviewMeta;
  }): Promise<ObservationPreviewResult>;
}

export interface ToolRuntimePort extends ToolCatalogPort, ToolExecutionPort {}
