/**
 * @file markdownNormalizationService.ts
 * @description 未首开 Markdown 占位文档的后端规范化服务。
 */

import Database from 'better-sqlite3';
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

export interface MarkdownNormalizationBatchResult {
  scanned: number;
  normalized: number;
  skipped: number;
  failed: number;
}

export type MarkdownImporter = (markdown: string) => Promise<MarkdownImportResult>;

/**
 * 后端唯一的 Markdown 规范化入口。
 *
 * 中文说明：
 * - 创建、读取、编辑前自愈、启动维护都应收敛到这里；
 * - 这样可以避免各处重复识别 `rawMarkdownSource`，也避免再次出现“前端首开才是真相来源”的双轨逻辑。
 */
export class MarkdownNormalizationService {
  private readonly logger = new Logger('MarkdownNormalizationService');

  constructor(
    private readonly db: Database.Database,
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

  /**
   * 启动维护使用：扫描并规范化所有仍停留在 placeholder 态的 Markdown 文档。
   */
  async normalizeAllPendingPlaceholders(): Promise<MarkdownNormalizationBatchResult> {
    const stmtDocs = this.db.prepare<unknown[], { id: string }>(`
      SELECT id
      FROM workspace_nodes
      WHERE type = 'document' AND deleted_at IS NULL
    `);
    const docs = stmtDocs.all();

    let normalized = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        const result = await this.normalizeDocumentIfNeeded(doc.id);
        if (result.status === 'normalized') {
          normalized += 1;
        } else if (result.status === 'already_normalized') {
          skipped += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `批量规范化失败: documentId=${doc.id}, reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      scanned: docs.length,
      normalized,
      skipped,
      failed
    };
  }
}
