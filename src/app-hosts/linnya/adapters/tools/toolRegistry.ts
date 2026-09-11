import { runtimeKernel } from '@linnlabs/linnkit';
import {
  getRegisteredToolClasses,
  getRegisteredToolContextDecorators,
} from 'src/app-hosts/linnya/plugin-registry/builtin';
import { pluginDiagnostics } from 'src/app-hosts/linnya/plugin-registry/diagnostics';
import type { BackendPluginToolContextDecorator } from 'src/app-hosts/linnya/plugin-registry/types';
import type { LinnyaToolSchemaContext, ToolContext } from 'src/tools/types';
import { deriveLinnyaToolSchemaContext } from './functions/deriveLinnyaToolSchemaContext';
import { readToolExecutionErrorCode } from './functions/readToolExecutionErrorCode';

type BaseTool = runtimeKernel.tools.BaseTool;
type FunctionToolSchema = runtimeKernel.tools.FunctionToolSchema;
type ToolArgs = runtimeKernel.tools.ToolArgs;
type ToolParameterSchema = runtimeKernel.tools.ToolParameterSchema;
type ToolSchemaBuildRequest = runtimeKernel.tools.ToolSchemaBuildRequest;
type ToolExecutionContext = runtimeKernel.tools.ToolExecutionContext;
type ToolCatalogPort = runtimeKernel.tools.ToolCatalogPort;
type ToolExecutionPort = runtimeKernel.tools.ToolExecutionPort;
type ToolExecutionResult = runtimeKernel.tools.ToolExecutionResult;
type ToolRuntimeDefinition = runtimeKernel.tools.ToolRuntimeDefinition;

interface DynamicToolMetadataProvider {
  getParametersForContext?(context: LinnyaToolSchemaContext): ToolParameterSchema;
  getDescriptionForContext?(context: LinnyaToolSchemaContext): string;
}

export class ToolSchemaGenerationError extends Error {
  readonly toolName: string;
  readonly cause: unknown;

  constructor(toolName: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`[ToolRegistry] 生成工具 ${toolName} 的 schema 失败: ${message}`);
    this.name = 'ToolSchemaGenerationError';
    this.toolName = toolName;
    this.cause = cause;
  }
}

export class ToolRegistryInitializationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`[ToolRegistry] strict 初始化失败: ${errors.join('; ')}`);
    this.name = 'ToolRegistryInitializationError';
    this.errors = errors;
  }
}

export interface ToolRegistryOptions {
  /**
   * strict 模式用于 eval / harness：工具装配失败必须直接失败，避免评测在缺工具状态下继续跑。
   * 产品默认仍保持 best-effort，单个工具坏了不阻断其他工具。
   */
  strictInitialization?: boolean;
}

function isDynamicToolMetadataProvider(
  tool: BaseTool
): tool is BaseTool & DynamicToolMetadataProvider {
  return (
    ('getParametersForContext' in tool && typeof tool.getParametersForContext === 'function') ||
    ('getDescriptionForContext' in tool && typeof tool.getDescriptionForContext === 'function')
  );
}

function readToolArgumentValidationErrorCode(tool: BaseTool): string | undefined {
  if (!('argumentValidationErrorCode' in tool)) return undefined;
  const code = Reflect.get(tool, 'argumentValidationErrorCode');
  return typeof code === 'string' && code.trim().length > 0 ? code.trim() : undefined;
}

/**
 * Linnya 默认 ToolRegistry。
 *
 * 中文备注：
 * - 这不是 runtime-kernel 协议，而是宿主默认工具装配；
 * - 真正稳定给 core 使用的是 `ToolRuntimePort` 等最小端口；
 * - `src/tools/registry.ts` 当前只保留 compatibility bridge。
 */
export class ToolRegistry implements ToolCatalogPort, ToolExecutionPort {
  private tools: Map<string, BaseTool> = new Map();
  private toolContextDecorators: Map<string, BackendPluginToolContextDecorator[]> = new Map();
  private initialized = false;
  private readonly strictInitialization: boolean;

  constructor(options: ToolRegistryOptions = {}) {
    this.strictInitialization = options.strictInitialization === true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initializeTools();
    }
  }

  private initializeTools(): void {
    if (this.initialized) {
      return;
    }

    let loadedCount = 0;
    const errors: string[] = [];

    const toolClasses = getRegisteredToolClasses();

    for (const ToolClass of toolClasses) {
      try {
        const tool = new ToolClass();
        if (!tool.name || !tool.description || !tool.parameters) {
          throw new Error(`工具 ${ToolClass.name} 缺少必要的属性`);
        }
        runtimeKernel.tools.assertToolParameterSchema(tool.parameters);

        if (this.tools.has(tool.name)) {
          pluginDiagnostics.record({
            level: 'error',
            pluginId: null,
            capability: 'tool',
            message: `工具名冲突: ${tool.name}`,
          });
          throw new Error(`[ToolRegistry] 工具名冲突且不允许覆盖: ${tool.name}`);
        }

        this.tools.set(tool.name, tool);
        loadedCount++;
      } catch (error) {
        const errorMsg = `加载工具 ${ToolClass.name} 失败: ${error instanceof Error ? error.message : '未知错误'}`;
        errors.push(errorMsg);
        console.error(`[ToolRegistry] ❌ ${errorMsg}`);
      }
    }

    if (errors.length > 0) {
      if (this.strictInitialization) {
        this.tools.clear();
        this.toolContextDecorators.clear();
        throw new ToolRegistryInitializationError(errors);
      }
    }

    this.indexToolContextDecorators();

    this.initialized = true;

    console.info(`[ToolRegistry] 工具初始化完成: 成功加载 ${loadedCount} 个工具`);
    if (errors.length > 0) {
      console.warn(`[ToolRegistry] 初始化过程中遇到 ${errors.length} 个错误:`, errors);
    }
  }

  getTool(name: string): BaseTool | undefined {
    this.ensureInitialized();
    return this.tools.get(name);
  }

  getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined {
    const tool = this.getTool(toolName);
    if (!tool) {
      return undefined;
    }
    return {
      parameters: tool.parameters,
      validateArguments: args => tool['validateArguments'](args),
      idempotency: tool.idempotency,
      modelInputRequirement: tool.modelInputRequirement,
      modelInputDelivery: tool.modelInputDelivery,
      streaming: tool.streaming,
      ...(tool.resolveModelInputRequirement
        ? {
            resolveModelInputRequirement: (args: ToolArgs) =>
              tool.resolveModelInputRequirement?.(args),
          }
        : {}),
    };
  }

  getAllTools(): BaseTool[] {
    this.ensureInitialized();
    return Array.from(this.tools.values());
  }

  getAvailableToolNames(toolNames?: string[]): string[] {
    this.ensureInitialized();
    if (!toolNames || toolNames.length === 0) {
      return Array.from(this.tools.keys());
    }

    return toolNames.filter(name => this.tools.has(name));
  }

  getToolSchemas(input: ToolSchemaBuildRequest): FunctionToolSchema[] {
    this.ensureInitialized();

    const schemas: FunctionToolSchema[] = [];
    const toolsToProcess = input.toolNames
      ? input.toolNames.map(name => this.tools.get(name)).filter((tool): tool is BaseTool => !!tool)
      : this.getAllTools();
    const schemaContext = deriveLinnyaToolSchemaContext(input.invocation);

    for (const tool of toolsToProcess) {
      const parameters = this.resolveToolParametersForSchema(tool, schemaContext);
      const description = this.resolveToolDescriptionForSchema(tool, schemaContext);
      schemas.push({
        type: 'function',
        function: {
          name: tool.name,
          description,
          parameters,
        },
      });
    }

    return schemas;
  }

  private resolveToolParametersForSchema(
    tool: BaseTool,
    schemaContext: LinnyaToolSchemaContext
  ): ToolParameterSchema {
    try {
      return isDynamicToolMetadataProvider(tool) && tool.getParametersForContext
        ? this.assertToolSchema(tool.getParametersForContext(schemaContext))
        : this.assertToolSchema(tool.parameters);
    } catch (error) {
      throw new ToolSchemaGenerationError(tool.name, error);
    }
  }

  private assertToolSchema(schema: ToolParameterSchema): ToolParameterSchema {
    runtimeKernel.tools.assertToolParameterSchema(schema);
    return schema;
  }

  private resolveToolDescriptionForSchema(
    tool: BaseTool,
    schemaContext: LinnyaToolSchemaContext
  ): string {
    try {
      return isDynamicToolMetadataProvider(tool) && tool.getDescriptionForContext
        ? tool.getDescriptionForContext(schemaContext)
        : tool.description;
    } catch (error) {
      throw new ToolSchemaGenerationError(tool.name, error);
    }
  }

  async executeTool(
    toolName: string,
    args: ToolArgs,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    this.ensureInitialized();
    const startTime = Date.now();

    try {
      const tool = this.getTool(toolName);
      if (!tool) {
        return {
          success: false,
          error: `工具 '${toolName}' 不存在`,
          errorKind: 'protocol',
          durationMs: Date.now() - startTime,
        };
      }

      const normalizedArgs = runtimeKernel.tools.normalizeToolArgs(tool.parameters, args, {
        toolName,
      });

      const validation = this.validateToolCall(toolName, normalizedArgs);
      if (!validation.success) {
        const errorCode = readToolArgumentValidationErrorCode(tool);
        return {
          success: false,
          error: validation.error ?? `工具 '${toolName}' 参数校验失败`,
          errorKind: 'protocol',
          ...(errorCode === undefined ? {} : { errorCode }),
          durationMs: Date.now() - startTime,
        };
      }

      console.log(`[ToolRegistry] 🔧 执行工具: ${toolName}`, normalizedArgs);
      await this.decorateToolContext(toolName, normalizedArgs, context);

      const policy = tool.idempotency;
      const key = policy
        ? runtimeKernel.tools.computeToolIdempotencyKey({
            policy,
            toolName,
            args: normalizedArgs,
            context,
          })
        : undefined;
      if (policy && key) {
        const history = runtimeKernel.tools.readToolContextWorkingHistory(context);
        const cached = runtimeKernel.tools.findCachedToolOutputByIdempotencyKey({
          history,
          toolName,
          idempotencyKey: key,
        });
        if (cached) {
          const durationMs = Date.now() - startTime;
          console.log(`[ToolRegistry] ♻️ 命中幂等缓存，跳过真实执行: ${toolName} (key=${key})`);
          return {
            success: true,
            result: cached.result,
            durationMs,
            idempotency: { key, cacheHit: true },
          };
        }
      }

      const result = await tool.run(normalizedArgs, context);
      const hostContext: ToolContext = context;
      if (typeof result === 'string' && context.parentToolCallId) {
        hostContext.toolResultReceipts?.returned(context.parentToolCallId, toolName, result);
      }
      const durationMs = Date.now() - startTime;
      console.log(`[ToolRegistry] ✅ 工具 ${toolName} 执行成功 (${durationMs}ms)`);

      return {
        success: true,
        result,
        durationMs,
        ...(policy && key ? { idempotency: { key, cacheHit: false } } : {}),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'RUN_RECOVERY_BLOCKED' || error.code === 'RUN_PAUSE_REQUESTED')
      )
        throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`[ToolRegistry] 🛑 工具 ${toolName} 收到 AbortError，向上抛出中断语义`);
        throw error;
      }
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      const errorCode = readToolExecutionErrorCode(error);
      console.error(`[ToolRegistry] ❌ 工具 ${toolName} 执行失败 (${durationMs}ms):`, errorMsg);
      return {
        success: false,
        error: errorMsg,
        ...(errorCode === undefined ? {} : { errorCode }),
        errorKind: 'execution',
        durationMs,
      };
    }
  }

  hasTool(toolName: string): boolean {
    this.ensureInitialized();
    return this.tools.has(toolName);
  }

  getToolCount(): number {
    this.ensureInitialized();
    return this.tools.size;
  }

  getStats(): {
    totalTools: number;
    toolNames: string[];
    byCategory: Record<string, string[]>;
  } {
    this.ensureInitialized();
    const toolNames = Array.from(this.tools.keys());
    const byCategory: Record<string, string[]> = {};

    for (const name of toolNames) {
      const category = name.split('_')[0] || 'other';
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(name);
    }

    return {
      totalTools: this.tools.size,
      toolNames,
      byCategory,
    };
  }

  validateToolCall(toolName: string, args: ToolArgs): { success: boolean; error?: string } {
    this.ensureInitialized();
    const tool = this.getTool(toolName);
    if (!tool) {
      return {
        success: false,
        error: `工具 '${toolName}' 不存在`,
      };
    }

    return tool['validateArguments'](args);
  }

  getToolInfo(toolName: string): {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
    requiredParams: string[];
    optionalParams: string[];
  } | null {
    this.ensureInitialized();
    const tool = this.getTool(toolName);
    if (!tool) {
      return null;
    }

    const required = tool.parameters.required || [];
    const allParams = Object.keys(tool.parameters.properties || {});
    const optional = allParams.filter(param => !required.includes(param));

    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      requiredParams: required,
      optionalParams: optional,
    };
  }

  private indexToolContextDecorators(): void {
    this.toolContextDecorators.clear();
    for (const decorator of getRegisteredToolContextDecorators()) {
      for (const toolName of decorator.toolNames) {
        const existing = this.toolContextDecorators.get(toolName) ?? [];
        existing.push(decorator);
        this.toolContextDecorators.set(toolName, existing);
      }
    }
  }

  private async decorateToolContext(
    toolName: string,
    args: ToolArgs,
    context: ToolExecutionContext
  ): Promise<void> {
    const decorators = this.toolContextDecorators.get(toolName);
    if (!decorators || decorators.length === 0) {
      return;
    }
    for (const decorator of decorators) {
      await decorator.decorate(context, { toolName, args });
    }
  }

  reinitialize(): void {
    this.tools.clear();
    this.toolContextDecorators.clear();
    this.initialized = false;
    this.initializeTools();
  }
}

export const toolRegistry = new ToolRegistry();
