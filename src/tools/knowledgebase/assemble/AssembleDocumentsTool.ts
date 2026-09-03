/**
 * @file src/tools/knowledgebase/assemble/AssembleDocumentsTool.ts
 * @description 组装文档结果工具（确定性：不再二次调用 LLM；deep_search 收口专用）
 *
 * 定位（高内聚/低耦合）：
 * - deep_search 子 Agent 负责“搜索 + 阅读 + 智能筛选”并产生 selected_blocks（doc_id + block_id）；
 * - assemble_documents 工具只负责把这些 ID 映射到知识库 SoT 原文片段，并组装成结构化 tool_output。
 *
 * 重要：本工具不会把“组装后的长文本”返回给子 Agent（observation 只给出极短确认信息），
 * 以减少子 Agent 上下文噪音；上层依然可通过 data.kept 获取结构化片段用于 UI / citations 计算。
 *
 * 重要（保持原状）：
 * - 本工具用于 deep_search 子 Agent 的最后一步：成功后应立刻结束子 run，避免回到 LLM 生成无意义文本；
 * - 因此会输出 control.terminateRun=true（执行层收到后直接 yield）。
 */

import { BaseTool, ToolContext, ToolParameterSchema } from '../../types';
import type { StructuredToolResult } from '../../types';
import {
  AssembleDocumentsArgsSchema,
  AssembleDocumentsToolOutputSchema,
  type AssembleDocumentsDroppedItem,
  type AssembleDocumentsKeptItem,
  type AssembleDocumentsResultData,
} from '@app/schemas';
import type { DocumentSoT } from '../../../features/knowledge-base/domain/block';
import { sliceTextByUnitsZhEn } from '../../../shared/utils/textUnits';

export class AssembleDocumentsTool extends BaseTool {
  readonly name = 'assemble_documents';

  readonly description = `Materialize the final deep-search selection by assembling snippets from knowledge-base blocks.

# When to Use
- After you have selected the most relevant blocks (doc_id + block_id)
- When you need a structured tool_output payload for UI/citations

# Input
- query: The original query
- selected_blocks: Array of selected blocks (doc_id + block_id). Must use the real SoT block_id shown by reading/search observations. Do NOT use [@ref] as block_id.
- summary: Optional. A brief process summary for history compression (NOT an answer, NOT shown to the parent agent)

# Output
- kept: Array of selected snippets
- stats: Summary statistics of the selection`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The query or question the selection is about',
      },
      selected_blocks: {
        type: 'array',
        description: 'Selected blocks (doc_id + block_id) produced by the agent',
        items: {
          type: 'object',
          description: 'A selected block reference',
          properties: {
            doc_id: { type: 'string', description: 'Document ID (full doc_id)' },
            block_id: {
              type: 'string',
              description: 'Block ID within the document (SoT block_id)',
            },
          },
          required: ['doc_id', 'block_id'],
        },
      },
      summary: {
        type: 'string',
        description:
          'Optional. A brief process summary (not an answer). Used by history compressor as getExecutionSummary source. Do NOT include raw document excerpts here.',
      },
    },
    required: ['query', 'selected_blocks'],
  };

  private async getSoT(docId: string, context: ToolContext): Promise<DocumentSoT> {
    const service = context.knowledgeBaseService;
    if (!service) {
      throw new Error(
        '[AssembleDocumentsTool] 缺少 context.knowledgeBaseService，无法按 block_id 回填片段'
      );
    }
    const sot = await service.getRawSoTDocument(docId);
    if (!sot) {
      throw new Error(`[AssembleDocumentsTool] SoT 不存在：doc_id="${docId}"`);
    }
    return sot;
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = AssembleDocumentsArgsSchema.parse(args);
    const { query, selected_blocks: selectedBlocks, summary } = input;

    if (selectedBlocks.length === 0) {
      const emptyResult: StructuredToolResult<AssembleDocumentsResultData> = {
        data: {
          query,
          summary,
          kept: [],
          dropped: [],
          stats: { total_input: 0, kept_count: 0, dropped_count: 0 },
        },
        observation: '组装完成：无输入块。\n可以结束当前对话了。',
        control: { terminateRun: true, reason: 'assemble_documents: empty input but completed' },
      };
      return JSON.stringify(AssembleDocumentsToolOutputSchema.parse(emptyResult));
    }

    console.log(
      `[AssembleDocumentsTool] Materializing ${selectedBlocks.length} selected blocks for query: "${query}"`
    );

    const sotCache = new Map<string, DocumentSoT>();
    const docNameCache = new Map<string, string>();
    const kept: AssembleDocumentsKeptItem[] = [];
    for (let i = 0; i < selectedBlocks.length; i += 1) {
      const { doc_id: docId, block_id: blockId } = selectedBlocks[i];

      let sot = sotCache.get(docId);
      if (!sot) {
        sot = await this.getSoT(docId, context);
        sotCache.set(docId, sot);
      }

      if (!docNameCache.has(docId)) {
        const service = context.knowledgeBaseService;
        if (!service) {
          throw new Error(
            '[AssembleDocumentsTool] 缺少 context.knowledgeBaseService，无法解析文档名称'
          );
        }
        const meta = await service.getDocumentById(docId);
        if (!meta?.filename) {
          throw new Error(`[AssembleDocumentsTool] 文档元数据不存在：doc_id="${docId}"`);
        }
        docNameCache.set(docId, meta.filename);
      }

      const block = sot.content_blocks?.[blockId];
      if (!block) {
        throw new Error(
          `[AssembleDocumentsTool] block 不存在：doc_id="${docId}" block_id="${blockId}"`
        );
      }

      // snippet 仅用于 UI 卡片的简短预览；deep_search 的阅读视图会从 SoT 展示全文
      // ✅ 统一口径：中文按汉字/英文按单词计数，最多 500 字/词
      const snippet = typeof block.text === 'string' ? sliceTextByUnitsZhEn(block.text, 500) : '';
      const docName = docNameCache.get(docId);
      if (!docName) {
        throw new Error(`[AssembleDocumentsTool] 文档名称未完成接纳：doc_id="${docId}"`);
      }
      kept.push({
        doc_id: docId,
        block_id: blockId,
        snippet,
        doc_name: docName,
      });
    }

    const dropped: AssembleDocumentsDroppedItem[] = [];

    const resultData: AssembleDocumentsResultData = {
      query,
      summary,
      kept,
      dropped,
      stats: {
        total_input: selectedBlocks.length,
        kept_count: kept.length,
        dropped_count: 0,
      },
    };

    // 🔥 给子 Agent 的 observation：不要返回“组装后的长文本”，只返回确认与收尾提示。
    const observation = this.buildObservation(resultData);

    const result: StructuredToolResult<AssembleDocumentsResultData> = {
      data: resultData,
      observation,
      // 🔥 deep_search 收口：避免回到 LLM 生成无意义文本
      control: { terminateRun: true, reason: 'assemble_documents: completed' },
    };

    console.log(
      `[AssembleDocumentsTool] Materialized ${kept.length}/${selectedBlocks.length} blocks`
    );
    // 轻量化：不 pretty-print，降低 tool_output 体积
    return JSON.stringify(AssembleDocumentsToolOutputSchema.parse(result));
  }

  /**
   * 构建 observation（给子 Agent / 调试阅读）
   * - 必须极短：不输出每条 snippet，避免把“组装内容”塞回子 Agent 上下文
   */
  private buildObservation(data: AssembleDocumentsResultData): string {
    const lines: string[] = [
      `组装成功。Stats: ${data.stats.kept_count} kept / ${data.stats.dropped_count} dropped (total: ${data.stats.total_input})`,
      '可以结束当前对话了。',
    ];
    return lines.join('\n');
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output);
      const summary = parsed?.data?.summary;
      if (typeof summary === 'string' && summary.trim()) {
        return summary.trim();
      }
      const stats = parsed.data?.stats;
      if (stats) {
        return `组装完成: ${stats.kept_count} 个片段 / ${stats.total_input} 个输入`;
      }
      return '组装已完成';
    } catch {
      return '组装结果无法解析';
    }
  }
}
