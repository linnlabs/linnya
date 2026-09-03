import type { ToolSummaryProvider } from '../../../shared/preprocessors/base';
import { Logger } from '../../../../shared/logger';

type UnknownRecord = Record<string, unknown>;
const logger = new Logger('ToolOutputSummarizer');

export interface SummarizerConfig {
  fullContentThreshold: number;
  textPreviewLength: number;
  arrayPreviewCount: number;
  objectPreviewFieldCount: number;
}

export const DEFAULT_SUMMARIZER_CONFIG: SummarizerConfig = {
  fullContentThreshold: 400,
  textPreviewLength: 200,
  arrayPreviewCount: 3,
  objectPreviewFieldCount: 5,
};

export class ToolOutputSummarizer {
  private config: SummarizerConfig;

  constructor(config: Partial<SummarizerConfig> = {}) {
    this.config = { ...DEFAULT_SUMMARIZER_CONFIG, ...config };
  }

  getSummary(
    toolName: string,
    output: string,
    toolSummaryProvider?: ToolSummaryProvider,
  ): string {
    if (!output) {
      return '无输出';
    }
    if (output.length <= this.config.fullContentThreshold) {
      return output;
    }
    if (toolSummaryProvider) {
      const toolSummary = this.tryToolSpecificSummary(toolName, output, toolSummaryProvider);
      if (toolSummary) {
        return toolSummary;
      }
    }
    return this.createGenericSummary(output);
  }

  formatToolArgs(args: UnknownRecord): string {
    if (!args || Object.keys(args).length === 0) {
      return '';
    }

    return Object.entries(args)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ');
  }

  private tryToolSpecificSummary(
    toolName: string,
    output: string,
    toolSummaryProvider: ToolSummaryProvider,
  ): string | null {
    try {
      const tool = toolSummaryProvider.getTool(toolName);
      if (tool && typeof tool.getExecutionSummary === 'function') {
        return tool.getExecutionSummary(output);
      }
    } catch (error) {
      logger.error('tool getExecutionSummary failed', { toolName, error });
    }

    return null;
  }

  private createGenericSummary(output: string): string {
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        return this.summarizeArray(parsed);
      }
      if (typeof parsed === 'object' && parsed !== null) {
        return this.summarizeObject(parsed as UnknownRecord);
      }
    } catch {
      // fall through to text summary
    }

    return this.summarizeText(output);
  }

  private summarizeArray(parsed: unknown[]): string {
    if (parsed.length === 0) {
      return '返回了空数组';
    }

    const preview = parsed
      .slice(0, this.config.arrayPreviewCount)
      .map((item) => {
        const itemStr = JSON.stringify(item);
        return itemStr.length > 30 ? `${itemStr.slice(0, 30)}...` : itemStr;
      })
      .join(', ');

    return `返回了${parsed.length}个结果, 前几个是: [${preview}${parsed.length > this.config.arrayPreviewCount ? '...' : ''}]`;
  }

  private summarizeObject(parsed: UnknownRecord): string {
    const keys = Object.keys(parsed);
    if (keys.length === 0) {
      return '返回了空对象';
    }
    if (parsed.observation && typeof parsed.observation === 'string') {
      return this.createGenericSummary(parsed.observation);
    }
    const previewKeys = keys.slice(0, this.config.objectPreviewFieldCount).join(', ');
    return `返回了包含[${previewKeys}${keys.length > this.config.objectPreviewFieldCount ? '...' : ''}]等${keys.length}个字段的对象`;
  }

  private summarizeText(output: string): string {
    const previewStart = output.slice(0, this.config.textPreviewLength);
    const previewEnd = output.slice(-this.config.textPreviewLength);
    return `返回了${output.length}字符的文本, 开头是: "${previewStart}...", 结尾是: "...${previewEnd}"`;
  }
}

export const createDefaultToolOutputSummarizer = (
  config?: Partial<SummarizerConfig>,
): ToolOutputSummarizer => new ToolOutputSummarizer(config);

export const summarizeToolOutput = (
  toolName: string,
  output: string,
  toolSummaryProvider?: ToolSummaryProvider,
  config?: Partial<SummarizerConfig>,
): string => {
  const summarizer = createDefaultToolOutputSummarizer(config);
  return summarizer.getSummary(toolName, output, toolSummaryProvider);
};
