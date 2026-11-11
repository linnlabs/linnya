/**
 * `image_search`：在免 key 的开放图片来源（Wikimedia Commons、Openverse）找图，带回尺寸、许可与署名。
 * 下载走 web_read，同一套 URL 策略、类型检查与会话文件保存；本工具只搜索、不下载。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  IMAGE_SEARCH_DEFAULT_RESULTS,
  IMAGE_SEARCH_MAX_RESULTS,
  IMAGE_SEARCH_QUERY_MAX_CHARS,
  ImageSearchArgsSchema,
  ImageSearchResultSchema,
} from '@app/schemas';
import { runImageSearch, type ImageSearchDependencies } from './orchestration/runImageSearch';

export class ImageSearchTool extends BaseTool {
  constructor(private readonly dependencies: ImageSearchDependencies = {}) {
    super();
  }

  readonly name = 'image_search';
  readonly argumentValidationErrorCode = 'IMAGE_SEARCH_ARGUMENTS_INVALID';

  readonly description = `Search openly licensed images on Wikimedia Commons and Openverse (which aggregates Flickr, Europeana, museums such as the Met, Smithsonian, Cleveland and Rijksmuseum, NASA and others). No API key.

Returns candidates with size, license (commercial use, modifications, attribution), creator, source page, a ready attribution line and a download URL. Download a chosen image with web_read using its download URL; the receipt carries the same source and license record.

Search tips: name the specific object or scene; try the subject's names in other languages, the holding museum, or the English name. These sources rarely have current products, people or stock-style photos; for a specific object or product, the original is usually on the website of whoever holds or makes it, so find that page with web_search and read it with web_read, which lists the page's main images with captions and credits.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: IMAGE_SEARCH_QUERY_MAX_CHARS,
        description: 'What the image should show, e.g. "Houmuwu ding" or "lithium battery energy storage container".',
      },
      source: {
        type: 'string',
        enum: ['wikimedia_commons', 'openverse'],
        description: 'Optional. Search only this source. Default: both.',
      },
      commercial_only: {
        type: 'boolean',
        description: 'Optional. Only return images whose license allows commercial use. Default false.',
      },
      max_results: {
        type: 'integer',
        minimum: 1,
        maximum: IMAGE_SEARCH_MAX_RESULTS,
        description: `Optional. Maximum candidates. Default ${IMAGE_SEARCH_DEFAULT_RESULTS}.`,
      },
    },
    required: ['query'],
  };

  protected override validateArguments(args: Record<string, unknown>): { success: boolean; error?: string } {
    const parsed = ImageSearchArgsSchema.safeParse(args);
    if (parsed.success) return { success: true };
    const details = parsed.error.issues
      .map(issue => `${issue.path.length > 0 ? issue.path.join('.') : 'arguments'}: ${issue.message}`)
      .join('; ');
    return {
      success: false,
      error: `[${this.argumentValidationErrorCode}] image_search 参数不符合合同: ${details}\n最小结构示例：{"query":"Houmuwu ding"}`,
    };
  }

  async run(rawArgs: Record<string, unknown>, context: ToolContext): Promise<string> {
    return runImageSearch(ImageSearchArgsSchema.parse(rawArgs), context, this.dependencies);
  }

  getExecutionSummary(output: string): string {
    try {
      const result = ImageSearchResultSchema.parse(JSON.parse(output));
      return `图片搜索「${result.data.query}」：${result.data.candidates.length} 张候选`;
    } catch {
      return '图片搜索结果格式异常';
    }
  }
}
