import type { CanonicalInferencePort } from '../ports';
import type {
  AgentSpec,
  AgentSpecContextPolicyInput,
  RoutedRuntimeEvent,
  RuntimeEvent,
  SerializableJsonRecord,
} from '../contracts';
import type {
  BaseTool,
  FunctionToolSchema,
  ToolArgs,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolRuntimeDefinition,
  ToolSchemaBuildRequest,
  runSupervisor,
} from '../runtime-kernel';

export interface DefinedAgent {
  readonly spec: AgentSpec;
  readonly systemPrompt: string;
  readonly modelId?: string;
  readonly tools: readonly BaseTool<ToolArgs, string>[];
}

export interface DefineAgentInput {
  id: string;
  version?: string;
  description?: string;
  role?: string;
  systemPrompt: string;
  modelId?: string;
  capabilities?: string[];
  tools?: readonly BaseTool<ToolArgs, string>[];
  contextPolicy?: AgentSpecContextPolicyInput;
  metadata?: Record<string, unknown>;
}

export interface LinnkitQuickstartConfig {
  agents: readonly DefinedAgent[];
  inference: CanonicalInferencePort | (() => CanonicalInferencePort | Promise<CanonicalInferencePort>);
  defaultModelId?: string;
}

export interface RunAgentOptions {
  input: string;
  inference: CanonicalInferencePort;
  modelId?: string;
  /**
   * Quickstart graph loop 最大节点步数。默认 8。
   *
   * 中文备注：这里只控制 demo runtime 的 graph loop；生产 host 应按自身 run 装配决定。
   */
  maxSteps?: number;
  conversationId?: string;
  runId?: string;
  signal?: AbortSignal;
  /**
   * Quickstart 事件回调。
   *
   * 中文备注：CLI 用它打印实时输出；生产 host 应直接接入 EventBus / EventStore。
   */
  onEvent?: (event: RoutedRuntimeEvent) => void | Promise<void>;
}

export interface RunAgentResult {
  runId: string;
  finalAnswer: string;
  events: RoutedRuntimeEvent[];
  cost: RunCost;
  contextTrace?: SerializableJsonRecord;
}

type RunCost = runSupervisor.RunCost;

export interface QuickstartToolRuntime {
  getToolSchemas(input: ToolSchemaBuildRequest): FunctionToolSchema[];
  getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined;
  executeTool(
    toolName: string,
    args: ToolArgs,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}
