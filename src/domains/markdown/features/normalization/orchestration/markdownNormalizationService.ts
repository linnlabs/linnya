/**
 * @file markdownNormalizationService.ts
 * @description 未首开 Markdown 占位文档的后端规范化服务。
 */

import { Logger } from 'src/shared/logger';
import { extractRawMarkdownSource, isRawMarkdownPlaceholder } from '../placeholderDetection';
import { importMarkdownToDocJson, type MarkdownImportResult } from '../importMarkdownToDocJson';
import type { MarkdownDocJson } from '../types';
import { MarkdownDocumentService } from '../../document-storage';

export interface MarkdownNormalizationResult {
  changed: boolean;
  status: 'normalized' | 'already_normalized' | 'failed';
  documentId?: string;
  content: unknown;
  rawMarkdown?: string | null;
  reason?: string;
}

export type MarkdownImporter = (markdown: string) => Promise<MarkdownImportResult>;

/**
 * 后端唯一的 Markdown 规范化入口。
 *
 * 中文说明：
 * - 创建、读取、编辑前自愈都应收敛到这里；
 * - 这样可以避免各处重复识别 `rawMarkdownSource`，也避免再次出现“前端首开才是真相来源”的双轨逻辑；
 * - 不提供启动期全库扫描：已存正文读取时先经过严格 schema 校验，`rawMarkdownSource`
 *   不是合法属性，逐篇扫描只会重复完整校验，规范化不了任何文档。
 */
export class MarkdownNormalizationService {
  private readonly logger = new Logger('MarkdownNormalizationService');

  constructor(
    private readonly markdownService: MarkdownDocumentService,
    private readonly importer: MarkdownImporter = importMarkdownToDocJson
  ) {}

  /**
   * 判断内容是否仍为 rawMarkdownSource 占位文档。
   */
  isRawMarkdownPlaceholder(content: unknown): boolean {
    return isRawMarkdownPlaceholder(content);
  }

  /**
   * 直接把一段 Markdown 导入成结构化 doc JSON。
   *
   * 用途：
   * - 创建文档时优先直接落结构化 JSON；
   * - 测试中也可以独立验证导入结果。
   */
  async buildStructuredDocFromMarkdown(markdown: string): Promise<MarkdownDocJson | null> {
    const imported = await this.importer(markdown);
    return imported.docJson;
  }

  /**
   * 对一份 content_json 做按需规范化。
   */
  async normalizeContentIfNeeded(content: unknown): Promise<MarkdownNormalizationResult> {
    const rawMarkdown = extractRawMarkdownSource(content);
    if (!rawMarkdown) {
      return {
        changed: false,
        status: 'already_normalized',
        content,
        rawMarkdown: null
      };
    }

    try {
      const imported = await this.importer(rawMarkdown);
      if (!imported.docJson) {
        return {
          changed: false,
          status: 'failed',
          content,
          rawMarkdown,
          reason: 'Markdown 解析结果为空，未生成结构化 doc JSON。'
        };
      }

      return {
        changed: true,
        status: 'normalized',
        content: imported.docJson,
        rawMarkdown
      };
    } catch (error) {
      return {
        changed: false,
        status: 'failed',
        content,
        rawMarkdown,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 对指定文档执行“按需规范化”。
   */
  async normalizeDocumentIfNeeded(documentId: string): Promise<MarkdownNormalizationResult> {
    const currentContent = this.markdownService.getDocument(documentId);
    const result = await this.normalizeContentIfNeeded(currentContent);

    if (result.status === 'normalized') {
      this.markdownService.updateDocument(documentId, result.content);
      this.logger.info(`文档已规范化: documentId=${documentId}`);
      return {
        ...result,
        documentId
      };
    }

    if (result.status === 'failed') {
      this.logger.warn(
        `文档规范化失败: documentId=${documentId}, reason=${result.reason ?? 'unknown'}`
      );
    }

    return {
      ...result,
      documentId
    };
  }
}
