import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  WebSearchArgsSchema,
  WebSearchResultSchema,
  ShallowWebSearchResultSchema,
  WEB_SEARCH_DEFAULT_TOP_K,
  WEB_SEARCH_MIN_TOP_K,
  WEB_SEARCH_MAX_TOP_K,
} from '@app/schemas';
import { ChildRunLimitExceededError } from 'src/app-hosts/linnya/application/run-resumption';
import { createWebCacheRuntime } from '../shared/cache/webCacheFactory';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import {
  runShallowWebSearch,
  type ShallowWebSearchDependencies,
} from './orchestration/runShallowWebSearch';
import { runDeepWebSearch } from './deep/orchestration/runDeepWebSearch';

export class WebSearchTool extends BaseTool {
  private readonly dependencies: ShallowWebSearchDependencies;
  constructor(dependencies: ShallowWebSearchDependencies = {}) {
    super();
    this.dependencies = {
      ...dependencies,
      cacheRuntime:
        dependencies.cacheRuntime ??
        (dependencies.provider ? createWebCacheRuntime(new MemoryWebCache()) : undefined),
    };
  }
  readonly name = 'web_search';
  readonly argumentValidationErrorCode = 'WEB_SEARCH_ARGUMENTS_INVALID';
  readonly description = `Search the web. Default returns titles, URLs and search snippets.
Use deep_search=true for a focused question needing multi-query discovery, actual reading and selected source excerpts. An internal agent uses the current model; it returns materials and gaps, not a verified answer. At most 4 deep starts per run; further requests explicitly use ordinary search. Internally it can perform multiple searches and reads. Only cite returned [@ref]. Search snippets and metadata-only pages are not full article reads.`;
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      deep_search: {
        type: 'boolean',
        default: false,
        description:
          'Search and read using an internal agent; at most 4 starts per run. Default false.',
      },
      query: {
        type: 'string',
        minLength: 1,
        description: 'The search query to look up on the web.',
      },
      top_k: {
        type: 'integer',
        description: 'Maximum number of results to return. Default: 10 (min: 6).',
        default: WEB_SEARCH_DEFAULT_TOP_K,
        minimum: WEB_SEARCH_MIN_TOP_K,
        maximum: WEB_SEARCH_MAX_TOP_K,
      },
      recency_days: {
        type: 'integer',
        minimum: 1,
        description:
          'Optional. Prefer results within the last N days (e.g. 7/30/180/365). Availability depends on provider.',
      },
    },
    required: ['query'],
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = WebSearchArgsSchema.safeParse(args);
    if (parsed.success) return { success: true };
    const details = parsed.error.issues
      .map(issue => `${issue.path.length > 0 ? issue.path.join('.') : 'arguments'}: ${issue.message}`)
      .join('; ');
    return {
      success: false,
      error: `[${this.argumentValidationErrorCode}] web_search 参数不符合合同: ${details}\n最小结构示例：{"query":"focused question"}`,
    };
  }

  async run(rawArgs: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { deep_search, ...shallowArgs } = WebSearchArgsSchema.parse(rawArgs);
    if (!deep_search) return runShallowWebSearch(shallowArgs, context, this.dependencies);
    try {
      return await runDeepWebSearch({ ...shallowArgs, deep_search }, context);
    } catch (error) {
      // 只为已定义的限额拒绝降级；模型失败、取消和恢复信号不能变成浅搜索成功。
      if (!(error instanceof ChildRunLimitExceededError)) throw error;
      const result = ShallowWebSearchResultSchema.parse(
        JSON.parse(await runShallowWebSearch(shallowArgs, context, this.dependencies))
      );
      result.data.search_strategy = 'shallow';
      result.data.downgrade_reason = 'deep_search_limit';
      result.observation =
        'Deep search limit reached (4 per run); ordinary search executed.\n' + result.observation;
      return JSON.stringify(result);
    }
  }
  getExecutionSummary(output: string): string {
    let value: unknown;
    try {
      value = JSON.parse(output);
    } catch {
      return '网页搜索结果格式异常';
    }
    const parsed = WebSearchResultSchema.safeParse(value);
    return parsed.success
      ? `网页${parsed.data.data.search_strategy === 'deep' ? '深度' : ''}搜索：${parsed.data.data.resultCount} 个来源`
      : '网页搜索结果格式异常';
  }
}
