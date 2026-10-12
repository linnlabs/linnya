import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  ShallowWebSearchArgsSchema,
  WEB_SEARCH_DEFAULT_TOP_K,
  WEB_SEARCH_MIN_TOP_K,
  WEB_SEARCH_MAX_TOP_K,
} from '@app/schemas';
import { createWebCacheRuntime } from '../shared/cache/webCacheFactory';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import {
  runShallowWebSearch,
  type ShallowWebSearchDependencies,
} from './orchestration/runShallowWebSearch';

/** 深搜 child 的浅检索入口，不暴露递归参数。 */
export class SearchWebTool extends BaseTool {
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

  readonly name = 'search_web';
  readonly argumentValidationErrorCode = 'SEARCH_WEB_ARGUMENTS_INVALID';
  readonly description =
    'Search for candidate web sources. Snippets are not article reads. Vary queries to investigate mechanisms, primary sources, opposing evidence and gaps; use web_read to inspect candidates. No recursive deep search.';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, description: 'Focused search query.' },
      top_k: {
        type: 'integer',
        description: 'Maximum candidates.',
        minimum: WEB_SEARCH_MIN_TOP_K,
        maximum: WEB_SEARCH_MAX_TOP_K,
        default: WEB_SEARCH_DEFAULT_TOP_K,
      },
      recency_days: {
        type: 'integer',
        description: 'Publication recency preference in days.',
        minimum: 1,
      },
    },
    required: ['query'],
  };
  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = ShallowWebSearchArgsSchema.safeParse(args);
    if (parsed.success) return { success: true };
    const details = parsed.error.issues
      .map(issue => `${issue.path.length > 0 ? issue.path.join('.') : 'arguments'}: ${issue.message}`)
      .join('; ');
    return {
      success: false,
      error: `[${this.argumentValidationErrorCode}] search_web 参数不符合合同: ${details}\n最小结构示例：{"query":"focused question"}`,
    };
  }
  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    return runShallowWebSearch(ShallowWebSearchArgsSchema.parse(args), context, this.dependencies);
  }
}
