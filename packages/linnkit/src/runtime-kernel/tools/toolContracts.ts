import type { ToolIdempotencyPolicy } from './idempotency/toolIdempotency';
import type { ToolExecutionContext } from './toolExecutionContext';
import type { ModelInputRequirement } from '../llm/input-capabilities';
import type { ToolModelInputDelivery } from './model-input';
import type {
  JsonSchemaValue,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolParameterType,
} from '../../ports';

export type {
  JsonSchemaValue,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolParameterType,
} from '../../ports';

export type ToolArgs = Record<string, unknown>;

/**
 * 工具对 LLM 流式 tool_call 生命周期的显式声明。
 *
 * 这里仅表达 runtime 何时发布通用事件，不包含组件、卡片或产品工具名等展示语义。
 * 未声明时，工具只在正式 tool_call decision 与执行阶段进入事件流。
 */
export interface ToolCallStreamingPolicy {
  readonly emitPlaceholder?: true;
  readonly emitArgumentSnapshots?: true;
}

export interface ToolResult {
  success: boolean;
  data: string;
  metadata?: Record<string, unknown>;
}

export type UnifiedToolResult =
  | { kind: 'ok'; output: unknown }
  | { kind: 'need_user'; spec: unknown }
  | { kind: 'async'; run_id: string };

export abstract class BaseTool<TArgs extends ToolArgs = ToolArgs, TResult extends string = string> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: ToolParameterSchema;

  readonly idempotency?: ToolIdempotencyPolicy;
  readonly modelInputRequirement?: ModelInputRequirement;
  /** 模型输入是工具成功的必要结果，还是仅在当前模型支持时提供的增强反馈。 */
  readonly modelInputDelivery?: ToolModelInputDelivery;
  readonly resolveModelInputRequirement?: (args: ToolArgs) => ModelInputRequirement | undefined;
  readonly streaming?: ToolCallStreamingPolicy;

  getExecutionSummary?(output: string): string {
    const FULL_CONTENT_THRESHOLD = 200;
    if (!output) {
      return 'Tool returned no output.';
    }
    if (output.length <= FULL_CONTENT_THRESHOLD) {
      return output;
    }
    return `Tool returned ${output.length} characters of output.`;
  }

  abstract run(args: TArgs, context: ToolExecutionContext): Promise<TResult>;

  protected validateArguments(args: TArgs): { success: boolean; error?: string } {
    try {
      const required = this.parameters.required || [];
      for (const field of required) {
        if (!(field in args) || args[field] === undefined || args[field] === null) {
          return {
            success: false,
            error: `Missing required parameter: ${field}`,
          };
        }
      }

      if (this.parameters.additionalProperties === false) {
        const allowed = new Set(Object.keys(this.parameters.properties));
        const unknownFields = Object.keys(args).filter(field => !allowed.has(field));
        if (unknownFields.length > 0) {
          return {
            success: false,
            error: `Additional properties not allowed: ${unknownFields.join(', ')}`,
          };
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Parameter validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }
}

export interface ToolRegistryEntry {
  name: string;
  toolClass: new () => BaseTool<ToolArgs, string>;
  metadata: ReturnType<BaseTool['getMetadata']>;
}

export const CommonParameterTypes = {
  docId: {
    type: 'string',
    description: 'The unique ID of the document',
  },
  query: {
    type: 'string',
    description: 'The search query text',
  },
  topK: {
    type: 'integer',
    description: 'The maximum number of results to return',
    default: 5,
  },
  blockId: {
    type: 'string',
    description: 'The unique ID of a content block',
  },
  pageNumber: {
    type: 'integer',
    description: 'Page number (1-indexed)',
    default: 1,
  },
} as const;

export interface AgentTool<TArgs extends ToolArgs = ToolArgs, TResult = unknown> {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute(args: TArgs): Promise<TResult>;
}

export interface FunctionToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

export interface ToolCallResult<TResult = unknown> {
  toolName: string;
  args: ToolArgs;
  result: TResult;
  success: boolean;
  error?: string;
  durationMs: number;
}
