/**
 * `web_read` canonical 工具入口。
 *
 * 默认 Agent 与插件共享本入口；具体读取行为统一下沉到 Web domain orchestration，
 * 工具 facade 不复制 URL 安全、Evidence 或缓存逻辑。
 */

import { BaseTool } from '../../types';
import type { ToolContext, ToolParameterSchema } from '../../types';
import { WebReadArgsSchema, WebReadResultSchema } from '@app/schemas';
import { MAX_WEB_PAGE_CONTENT_CHARS, runReadWebPage } from './orchestration/readWebPage';

export class WebReadTool extends BaseTool {
  readonly name = 'web_read';

  readonly description = `Read and extract the main content (as readable text or provider markdown) from a web page URL.

# Output
Returns the page content with a stable short reference [@XXXXXX] that can be cited in your answer.

# Important
- You MUST only cite references ([@ref]) that appear in the tool output. Do NOT invent references.
- PDF documents are not supported. Do not call web_read for PDF URLs; find an HTML page or another text source instead.
- For best results, pass the canonical URL and a title_hint from web_search when available.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL of the web page to read.' },
      max_chars: {
        type: 'number',
        description: `Optional. Maximum characters of content to return. Default: ${MAX_WEB_PAGE_CONTENT_CHARS}.`,
      },
      title_hint: {
        type: 'string',
        description: 'Optional. Title from a previous search result to use when the page reader cannot extract one.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  };

  async run(rawArgs: Record<string, unknown>, context: ToolContext): Promise<string> {
    const args = WebReadArgsSchema.parse(rawArgs);

    return runReadWebPage({
      url: args.url,
      maxChars: args.max_chars,
      titleHint: args.title_hint,
    }, context);
  }

  getExecutionSummary(output: string): string {
    try {
      const result = WebReadResultSchema.parse(JSON.parse(output));
      return `读取网页「${result.data.title || result.data.url}」，共 ${result.data.charCount} 字符。`;
    } catch {
      return '读取网页完成。';
    }
  }
}
