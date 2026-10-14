import { agentTools } from '@linnlabs/linnkit/context-manager';
import type { tools } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentToolEnvironment } from '../../../backend-runtime/definitions/agentToolEnvironment';
import { ToolRegistry } from '../../../adapters/tools/toolRegistry';
import { WebSearchTool } from 'src/tools/web/websearch/WebSearchTool';
import { SearchWebTool } from 'src/tools/web/websearch/SearchWebTool';
import { WebReadTool } from 'src/tools/web/webread/WebReadTool';
import { createWebCacheRuntime } from 'src/tools/web/shared/cache/webCacheFactory';
import { MemoryWebCache } from 'src/tools/web/shared/cache/adapters/memoryWebCache';
import type { ToolContext } from 'src/tools/types';
import type { FrozenCorpus } from '../definitions/historicalCorpus';
import { createHistoricalWebProviders } from '../functions/createHistoricalWebProviders';
import { HistoricalCalculateTool } from '../functions/calculate';

const allowed = new Set([
  'web_search',
  'search_web',
  'web_read',
  'assemble_web_sources',
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'grep',
  'tool_output_read',
  'task_write',
  'task_read',
  'subagent',
  'skill',
]);

/** 该限制是实验条件，不是生产权限：所有出口先判定再进入正式工具 owner。 */
export function historicalToolRejection(
  name: string,
  args: Record<string, unknown>
): string | undefined {
  if (!allowed.has(name) && name !== 'calculate')
    return `Tool ${name} is unavailable in this historical experiment.`;
  if (
    name === 'read_file' &&
    typeof args.locator === 'string' &&
    !args.locator.startsWith('workspace:/')
  )
    return 'Only Workspace documents are readable; host and conversation file reads are unavailable.';
  if (name === 'skill' && args.skill_name !== 'deep-research')
    return 'Only the frozen deep-research skill is available.';
  return undefined;
}

function calculationAdmitted(context: ToolContext): boolean {
  // calculate 在实验中代替任意 Shell；仍尊重各 child 的能力范围，深搜 child 不获得计算工具。
  const scope = context.registeredChildAllowedTools ?? context.registeredRootAllowedTools;
  return scope !== undefined && (scope.includes('shell') || scope.includes('calculate'));
}

export function createHistoricalToolEnvironment(corpus: FrozenCorpus): AgentToolEnvironment {
  const providers = createHistoricalWebProviders(corpus);
  const cacheRuntime = createWebCacheRuntime(new MemoryWebCache());
  const search = { provider: providers.search, cacheRuntime };
  const registry = new ToolRegistry({
    strictInitialization: true,
    createTool(ToolClass, defaultTool) {
      if (ToolClass === WebSearchTool) return new WebSearchTool(search);
      if (ToolClass === SearchWebTool) return new SearchWebTool(search);
      if (ToolClass === WebReadTool)
        return new WebReadTool({
          provider: providers.read,
          renderProvider: null,
          managedProvider: null,
          cacheRuntime,
          config: { renderEnabled: false, managedReader: 'none' },
        });
      return defaultTool;
    },
  });
  const calculator = new HistoricalCalculateTool();
  const select = (names?: readonly string[]): string[] => {
    const requested = registry.getAvailableToolNames(names ? [...names] : undefined);
    return [
      ...requested.filter(name => allowed.has(name)),
      ...(requested.includes('shell') || names?.includes('calculate') ? ['calculate'] : []),
    ];
  };
  const toolRuntime: tools.ToolRuntimePort = {
    getToolSchemas(input) {
      const names = select(input.toolNames);
      const schemas = registry.getToolSchemas({
        ...input,
        toolNames: names.filter(name => name !== 'calculate'),
      });
      // 公开 web_read 的 PDF 限制不变；本实验提供的是事前审核的文字投影，明确其来源与限制。
      for (const schema of schemas) {
        if (schema.function.name === 'web_read') {
          schema.function.description =
            'Read an admitted historical source projection using its exact search URL, including PDF text projections. No live network. Unknown URLs fail. Citations refer to frozen text, not a historical capture timestamp. Inspect returned truncation; do not assume completeness.';
          schema.function.parameters.properties.url.description =
            'Exact admitted HTTP(S) source URL from search, including frozen PDF text projections.';
        }
        if (schema.function.name === 'web_search' || schema.function.name === 'search_web')
          schema.function.description +=
            '\nThis experiment searches a finite frozen corpus only. Use source names and English terms; zero matches do not prove real-world absence. No live fallback.';
      }
      if (names.includes('calculate'))
        schemas.push({
          type: 'function',
          function: {
            name: calculator.name,
            description: calculator.description,
            parameters: calculator.parameters,
          },
        });
      return schemas;
    },
    getToolDefinition(name) {
      if (name === 'calculate')
        return {
          parameters: calculator.parameters,
          validateArguments: args => calculator.validateArguments(args),
        };
      return allowed.has(name) ? registry.getToolDefinition(name) : undefined;
    },
    async executeTool(name, args, context) {
      const rejection = historicalToolRejection(name, args);
      if (rejection)
        return {
          success: false,
          error: `HISTORICAL_TOOL_DENIED: ${rejection}`,
          errorKind: 'execution',
          durationMs: 0,
        };
      if (name !== 'calculate') return registry.executeTool(name, args, context);
      if (!calculationAdmitted(context))
        return {
          success: false,
          error: 'HISTORICAL_TOOL_DENIED: calculation outside Agent scope',
          errorKind: 'execution',
          durationMs: 0,
        };
      try {
        return { success: true, result: await calculator.run(args), durationMs: 0 };
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorKind: 'execution',
          durationMs: 0,
        };
      }
    },
  };
  return {
    toolRuntime,
    toolManager: new agentTools.ToolManager({
      getAvailableToolNames: select,
      getTool: name =>
        name === 'calculate' ? calculator : allowed.has(name) ? registry.getTool(name) : undefined,
      validateToolCall: (name, args) => {
        const rejection = historicalToolRejection(name, args);
        if (rejection) return { success: false, error: `HISTORICAL_TOOL_DENIED: ${rejection}` };
        return name === 'calculate'
          ? calculator.validateArguments(args)
          : registry.validateToolCall(name, args);
      },
    }),
    physicalFileReader: {
      async readFile() {
        throw new Error('HISTORICAL_TOOL_DENIED: physical file reads unavailable');
      },
    },
  };
}
