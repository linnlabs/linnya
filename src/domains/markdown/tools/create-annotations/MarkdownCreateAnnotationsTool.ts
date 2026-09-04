/**
 * @file MarkdownCreateAnnotationsTool.ts
 * @description AI 批量创建批注工具 - 用于 Review 审阅功能
 *
 * 功能：
 * - 接收多条批注创建请求，批量写入文档 rootBlock attrs
 * - 后端读取文档并解析 ref -> blockId
 * - 支持 Review 元信息（reviewRunId、agentId、chunkIndex 等）
 *
 * 设计约束：
 * - 模型只输出 ref（如 #aZ3kP9），不输出 blockId
 * - 模型不传 document_id / author：由后端根据当前审阅上下文自动注入
 * - 工具负责 ref → blockId 的映射
 * - 映射失败的 item 会被丢弃（禁止"瞎写块"）
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../../../tools/types';
import type { StructuredToolResult } from '../../../../tools/types';
import {
  appendMarkdownAnnotations,
  resolveMarkdownAnnotationTarget,
  type MarkdownAnnotationInsertion,
} from '../../features/annotations';
import {
  assertExpectedMarkdownDocumentVersion,
  MarkdownDocumentService,
} from '../../features/document-storage';
import {
  flattenMarkdownDocumentBlocks,
  type FlattenedMarkdownBlock,
} from '../../shared';
import { generateEditorAnnotationId } from '../../../../shared/utils/idUtils';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 单条批注创建项（模型输出格式）
 */
interface AnnotationItem {
  /** 目标块的 ref ID（如 #aZ3kP9） */
  target_ref: string;
  /** 批注内容 */
  content: string;
}

/**
 * 单条批注创建结果
 */
interface AnnotationResult {
  /** 批注 ID（成功时） */
  annotationId?: string;
  /** 目标 ref */
  targetRef: string;
  /** 状态 */
  status: 'created' | 'skipped' | 'error';
  /** 状态说明 */
  message?: string;
}

/**
 * 工具返回数据结构
 */
interface MarkdownCreateAnnotationsResultData {
  /** 文档 ID */
  documentId: string;
  /** 创建结果列表 */
  results: AnnotationResult[];
  /** 成功创建的批注数 */
  createdCount: number;
  /** 跳过的批注数（ref 无效） */
  skippedCount: number;
}

/**
 * ToolContext 中 Review 相关的扩展字段
 */
interface ReviewToolContextFields {
  /** 当前文档 ID（由 ReviewRequestEnricher 注入，模型无需传参） */
  document_id?: string;
  /** Review fragment 对应的正式文档版本，用于阻止覆盖并发修改 */
  expected_document_version?: number;
  /** 本次审阅的唯一标识 */
  review_run_id?: string;
  /** 当前角色 ID */
  agent_id?: string;
  /** 当前角色名（由 ReviewRequestEnricher 注入，用作批注 author） */
  agent_name?: string;
  /** 当前 chunk 索引（从 0 开始） */
  chunk_index?: number;
  /** 总 chunk 数 */
  total_chunks?: number;
}

function readReviewToolContextFields(context: ToolContext): ReviewToolContextFields {
  const fields: ReviewToolContextFields = {};
  const value: unknown = context;
  if (!value || typeof value !== 'object') return fields;
  if ('document_id' in value && typeof value.document_id === 'string') {
    fields.document_id = value.document_id;
  }
  if (
    'expected_document_version' in value
    && typeof value.expected_document_version === 'number'
  ) {
    fields.expected_document_version = value.expected_document_version;
  }
  if ('review_run_id' in value && typeof value.review_run_id === 'string') {
    fields.review_run_id = value.review_run_id;
  }
  if ('agent_id' in value && typeof value.agent_id === 'string') {
    fields.agent_id = value.agent_id;
  }
  if ('agent_name' in value && typeof value.agent_name === 'string') {
    fields.agent_name = value.agent_name;
  }
  if ('chunk_index' in value && typeof value.chunk_index === 'number') {
    fields.chunk_index = value.chunk_index;
  }
  if ('total_chunks' in value && typeof value.total_chunks === 'number') {
    fields.total_chunks = value.total_chunks;
  }
  return fields;
}

// ============================================================================
// 工具实现
// ============================================================================

export class MarkdownCreateAnnotationsTool extends BaseTool {
  readonly name = 'markdown_create_annotations';

  get description() {
    return [
      '在文档的指定块上批量创建批注。',
      '',
      '使用方式：',
      '- 仅支持批量文本参数：annotations_markdown',
      '- 每行格式为：[#ref] 批注内容',
      '',
      '示例（批量创建 2 条批注）：',
      '{',
      '  "annotations_markdown": "[#aZ3kP9] 这里论证跳跃，建议补充推导或引用依据。\\n[#m2L0Ab] 该段术语定义不清晰，建议给出边界与示例。"',
      '}',
      '- target_ref 必须来自当前 document_fragment 中出现的 ref（不要猜测）',
      '- 每条批注会自动关联到对应的块',
      '',
      '注意事项：',
      '- 只能使用系统提供的 [#ref] 引用，不要猜测',
      '- 如果 ref 无效，该条批注会被跳过',
      '- 批注与正文写入同一个文档版本，支持后续审阅和修改',
      '- 不要使用markdown格式写批注',
      '- 一个块只能创建一条批注，不要创建多条批注'
    ].join('\n');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      /**
       * 批量文本模式（唯一入参）：多行文本
       * 每行：[#ref] 批注内容
       */
      annotations_markdown: {
        type: 'string',
        description: '批量批注文本，每行格式为 "[#ref] 批注内容"（可多行）'
      }
    },
    required: ['annotations_markdown']
  };

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // 1. 参数校验（必填：annotations_markdown）
    const validation = this.validateArguments(args);
    if (!validation.success) {
      return this.buildErrorResult(validation.error ?? 'Invalid arguments');
    }

    const annotationsMarkdown = args.annotations_markdown;
    if (typeof annotationsMarkdown !== 'string' || annotationsMarkdown.trim().length === 0) {
      return this.buildErrorResult('annotations_markdown 必须是非空字符串');
    }

    const items = this.parseAnnotationsMarkdown(annotationsMarkdown);
    if (items.length === 0) {
      return this.buildErrorResult('annotations_markdown 解析失败：请使用多行 "[#ref] 批注内容" 格式');
    }

    // 2. 获取数据库服务
    const databaseService = context.databaseService;
    if (!databaseService) {
      return this.buildErrorResult('Workspace database not available in tool context.');
    }

    // 3. 获取 Review 相关的上下文
    const reviewContext = readReviewToolContextFields(context);
    const documentId = reviewContext.document_id;
    const expectedDocumentVersion = reviewContext.expected_document_version;
    const reviewRunId = reviewContext.review_run_id;
    const agentId = reviewContext.agent_id;
    const agentName = reviewContext.agent_name;
    const chunkIndex = reviewContext.chunk_index;

    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      return this.buildErrorResult('当前审阅上下文缺少 document_id（应由 ReviewRequestEnricher 自动注入）');
    }
    if (
      typeof expectedDocumentVersion !== 'number'
      || !Number.isSafeInteger(expectedDocumentVersion)
      || expectedDocumentVersion <= 0
    ) {
      return this.buildErrorResult('当前审阅上下文缺少有效的 expected_document_version');
    }
    if (typeof agentName !== 'string' || agentName.trim().length === 0) {
      return this.buildErrorResult('当前审阅上下文缺少 agent_name（应由 ReviewRequestEnricher 自动注入）');
    }

    try {
      const db = databaseService.getDb();
      const documentService = new MarkdownDocumentService(db);
      const latestVersion = documentService.getLatestVersion(documentId);
      if (!latestVersion) {
        return this.buildErrorResult(`文档不存在: ${documentId}`);
      }
      assertExpectedMarkdownDocumentVersion({
        expected: expectedDocumentVersion,
        actual: latestVersion.version_number,
      });

      // 3.1 读取文档并展平 blocks；批注工具只接受 ref，由后端解析到真实 blockId。
      const content = documentService.getDocument(documentId);
      const baseBlocks = flattenMarkdownDocumentBlocks(content);

      // 4. 批量处理批注创建
      const results: AnnotationResult[] = [];
      const insertions: MarkdownAnnotationInsertion[] = [];
      let createdCount = 0;
      let skippedCount = 0;

      for (const item of items) {
        const plan = this.planAnnotationItem({
          item,
          baseBlocks,
          reviewRunId,
          agentId,
          chunkIndex,
          author: agentName,
        });

        results.push(plan.result);
        if (plan.insertion) insertions.push(plan.insertion);

        if (plan.result.status === 'created') {
          createdCount++;
        } else {
          skippedCount++;
        }
      }

      if (insertions.length > 0) {
        documentService.updateDocument(
          documentId,
          appendMarkdownAnnotations(content, insertions),
        );
      }

      // 5. 返回结果
      const resultData: MarkdownCreateAnnotationsResultData = {
        documentId,
        results,
        createdCount,
        skippedCount
      };

      const toolResult: StructuredToolResult<MarkdownCreateAnnotationsResultData> = {
        data: resultData,
        observation: this.buildObservationText(createdCount, skippedCount)
      };

      return JSON.stringify(toolResult, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[MarkdownCreateAnnotationsTool] 执行失败:', error);
      return this.buildErrorResult(message);
    }
  }

  /**
   * 解析批量批注文本（多行 "[#ref] 内容"）
   */
  private parseAnnotationsMarkdown(input: string): AnnotationItem[] {
    const lines = input
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const items: AnnotationItem[] = [];
    for (const line of lines) {
      const m = line.match(/^\s*\[(#[^\]]+)\]\s*(.+)\s*$/);
      if (!m) continue;
      const targetRef = m[1]?.trim();
      const content = m[2]?.trim();
      if (!targetRef || !content) continue;
      items.push({ target_ref: targetRef, content });
    }
    return items;
  }

  /**
   * 处理单条批注创建
   */
  private planAnnotationItem(params: {
    item: AnnotationItem;
    baseBlocks: FlattenedMarkdownBlock[];
    reviewRunId?: string;
    agentId?: string;
    chunkIndex?: number;
    author: string;
  }): { result: AnnotationResult; insertion?: MarkdownAnnotationInsertion } {
    const { item, baseBlocks, reviewRunId, agentId, chunkIndex, author } = params;
    const { target_ref: targetRef, content } = item;

    // 1. 解析 ref -> blockId（后端自行读取文档并解析，避免依赖前端额外传映射）
    const resolved = resolveMarkdownAnnotationTarget({
      ref: targetRef,
      baseBlocks
    });

    if (resolved.status !== 'ok') {
      const message = resolved.message;
      console.warn(`[MarkdownCreateAnnotationsTool] ref 解析失败: ${targetRef} | ${message}`);
      return {
        result: {
          targetRef,
          status: 'skipped',
          message
        }
      };
    }

    const blockId = resolved.resolvedId;

    const annotationId = generateEditorAnnotationId();
    const now = new Date().toISOString();
    const annotation = {
      id: annotationId,
      content,
      author,
      state: 'confirmed',
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      replies: [],
      meta: {
        source: 'review',
        ...(reviewRunId ? { reviewRunId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(chunkIndex !== undefined ? { chunkIndex } : {}),
      }
    } as const;

    return {
      result: {
        annotationId,
        targetRef,
        status: 'created',
        message: `已为 ${targetRef} 创建批注`
      },
      insertion: { blockId, annotation },
    };
  }

  /**
   * 构建错误结果
   */
  private buildErrorResult(message: string): string {
    const data: MarkdownCreateAnnotationsResultData = {
      documentId: '',
      results: [],
      createdCount: 0,
      skippedCount: 0
    };
    const result: StructuredToolResult<MarkdownCreateAnnotationsResultData> = {
      data,
      observation: `创建批注失败: ${message}`
    };
    return JSON.stringify(result, null, 2);
  }

  /**
   * 构建给 AI 的 observation 文本
   */
  private buildObservationText(createdCount: number, skippedCount: number): string {
    const parts: string[] = [];

    if (createdCount > 0) {
      parts.push(`成功创建 ${createdCount} 条批注`);
    }
    if (skippedCount > 0) {
      parts.push(`跳过 ${skippedCount} 条（ref 无效或块不存在）`);
    }

    if (parts.length === 0) {
      return '未创建任何批注';
    }

    return parts.join('，') + '。';
  }

  /**
   * 生成执行摘要（用于历史压缩）
   */
  getExecutionSummary(output: string): string {
    try {
      const parsed: unknown = JSON.parse(output);
      if (parsed && typeof parsed === 'object' && 'data' in parsed) {
        const data = parsed.data;
        if (
          data
          && typeof data === 'object'
          && 'createdCount' in data
          && typeof data.createdCount === 'number'
        ) {
          return `已创建 ${data.createdCount} 条批注。`;
        }
      }

      return '执行了批注创建工具。';
    } catch {
      return '执行 markdown_create_annotations 工具。';
    }
  }
}
