import {
  BaseTool,
  type FunctionToolSchema,
  type ToolArgs,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolRuntimeDefinition,
  type ToolRuntimePort,
  type ToolSchemaBuildRequest,
} from 'src/tools/types';
import { defaultToolRuntimePort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import {
  clearPluginRuntimeStateForTests,
  isPluginRuntimeDatabaseReady,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

export interface ToolExecutionRecord {
  toolName: string;
  args: Record<string, unknown>;
  context: ToolExecutionContext;
}

export interface ToolRuntimeHarness {
  toolRuntime: ToolRuntimePort;
  getExecutions(): ToolExecutionRecord[];
  restore(): void;
}

interface ToolRuntimeHarnessFallback {
  getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined;
  getToolSchemas(input: ToolSchemaBuildRequest): FunctionToolSchema[];
  executeTool(
    toolName: string,
    args: ToolArgs,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return { ...args };
}

function buildSchema(tool: BaseTool): FunctionToolSchema {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function buildDefinition(tool: BaseTool): ToolRuntimeDefinition {
  return {
    parameters: tool.parameters,
    validateArguments: args => tool['validateArguments'](args),
    idempotency: tool.idempotency,
    streaming: tool.streaming,
  };
}

async function executeCustomTool(params: {
  tool: BaseTool;
  toolName: string;
  args: Record<string, unknown>;
  context: ToolExecutionContext;
  executions: ToolExecutionRecord[];
}): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  params.executions.push({
    toolName: params.toolName,
    args: cloneArgs(params.args),
    context: params.context,
  });

  try {
    const result = await params.tool.run(params.args, params.context);
    return {
      success: true,
      result,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'RUN_RECOVERY_BLOCKED' || error.code === 'RUN_PAUSE_REQUESTED')
    )
      throw error;
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

export function createToolRuntimeHarness(
  tools: BaseTool[],
  fallback: ToolRuntimeHarnessFallback = {
    getToolDefinition: toolName => defaultToolRuntimePort.getToolDefinition(toolName),
    getToolSchemas: input => defaultToolRuntimePort.getToolSchemas(input),
    executeTool: (toolName, args, context) =>
      defaultToolRuntimePort.executeTool(toolName, args, context),
  }
): ToolRuntimeHarness {
  const ownsPluginRuntimeState = !isPluginRuntimeDatabaseReady();
  if (ownsPluginRuntimeState) {
    // 测试夹具默认只启用 platform，避免 child-run 测试在没有真实 SQLite 时
    // 误读成“插件运行态不可用”。生产路径仍由 pluginRuntimeState fail-fast。
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });
  }
  const toolMap = new Map<string, BaseTool>(tools.map(tool => [tool.name, tool]));
  const executions: ToolExecutionRecord[] = [];

  const runtime: ToolRuntimePort = {
    getToolSchemas(input: ToolSchemaBuildRequest): FunctionToolSchema[] {
      const names = Array.isArray(input.toolNames) ? input.toolNames : tools.map(tool => tool.name);
      const customSchemas = names
        .map(name => toolMap.get(name))
        .filter((tool): tool is BaseTool => !!tool)
        .map(tool => buildSchema(tool));

      if (customSchemas.length === names.length) {
        return customSchemas;
      }

      const remainingNames = names.filter(name => !toolMap.has(name));
      return [
        ...customSchemas,
        ...fallback.getToolSchemas({ ...input, toolNames: remainingNames }),
      ];
    },

    getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined {
      const customTool = toolMap.get(toolName);
      if (customTool) {
        return buildDefinition(customTool);
      }
      return fallback.getToolDefinition(toolName);
    },

    async executeTool(
      toolName: string,
      args: ToolArgs,
      context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      const customTool = toolMap.get(toolName);
      if (!customTool) {
        return fallback.executeTool(toolName, args, context);
      }

      return executeCustomTool({
        tool: customTool,
        toolName,
        args,
        context,
        executions,
      });
    },
  };

  return {
    toolRuntime: runtime,
    getExecutions(): ToolExecutionRecord[] {
      return [...executions];
    },
    restore(): void {
      if (ownsPluginRuntimeState) {
        clearPluginRuntimeStateForTests();
      }
    },
  };
}
