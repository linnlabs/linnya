/**
 * @file src/tools/knowledgebase/search/SearchInKnowledgeBaseTool.ts
 *
 * @brief 知识库浅搜索工具（给子 Agent 使用的“等价工具名”）
 *
 * @description
 * 这个工具的能力与 `knowledge_search` 的浅搜索模式完全一致，
 * 但刻意不提供 `deep_search` 参数。
 *
 * 背景原因（根本方案）：
 * - 工具 schema 下发给模型时，当前系统只能按“工具名白名单”过滤，无法按 Agent 裁剪单个工具的参数；
 * - 如果子 Agent 直接看到 `knowledge_search` 的参数 schema，就能看到 `deep_search`，从而可能尝试递归；
 * - 因此我们提供一个语义等价的浅搜索工具名，让子 Agent “根本看不到 deep_search 参数”。
 *
 * 注意：
 * - 该工具不用于对外（父 Agent）替代 `knowledge_search`；
 * - deep search 子 Agent 的工具白名单应使用该工具名。
 */

import { BaseTool, ToolParameterSchema, ToolContext, CommonParameterTypes } from '../../types';
import type { StructuredToolResult } from '../../types';
import { runShallowSearch } from './shallow/runShallowSearch';
import { resolveGraphPolicyFromContext } from './graphPolicy';
import { KnowledgeSearchResultSchema, KnowledgeShallowSearchArgsSchema } from '@app/schemas';
import { requireCitationSequenceOffset } from '../../../domains/citation';

/**
 * 知识库浅搜索工具（等价于 knowledge_search 的浅搜索分支）
 */
export class SearchInKnowledgeBaseTool extends BaseTool {
  readonly name = 'search_in_knowledgebase';

  get description() {
    return `Search tool for the knowledge base (shallow search only).

This tool is semantically equivalent to the shallow mode of \`knowledge_search\`,
but it intentionally does NOT expose the \`deep_search\` parameter.

# When to Use
- Use this tool when you need retrieval only (no internal deep-search sub-agent).
- This tool is typically provided to internal sub-agents to avoid recursive deep search.

# Usage Modes
1. **Global Search (without doc_id)**: \`search_in_knowledgebase(query="your search terms")\`
2. **Document Search (with doc_id)**: \`search_in_knowledgebase(query="your search terms", doc_id="document_id")\`

# Notes
- The \`query\` string does not support search operators/syntax such as AND/OR/NOT.
- Outputs include document ID and block ID for further exploration.
- Only canonical \`[@XXXXXX]\` references shown in the result may be cited; document IDs, block IDs, and result numbers are not citation identities.`;
  }

  /**
   * 参数 schema：与 `knowledge_search` 对齐，但去掉 `deep_search`
   *
   * 说明：只公开当前真实支持的参数；尚未实现的过滤能力不能进入工具合同。
   */
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Use specific terms for better results.',
      },
      doc_id: {
        ...CommonParameterTypes.docId,
        description:
          'Optional. The unique ID of a specific document to search within. If omitted, searches across all documents.',
      },
      top_k: {
        type: 'integer',
        description: 'The maximum number of results to return. Default is 5.',
        default: 5,
      },
    },
    required: ['query'],
  };

  getExecutionSummary(output: string): string {
    // 与 KnowledgeSearchTool 的摘要逻辑保持一致（方便历史压缩）
    try {
      const parsed = KnowledgeSearchResultSchema.parse(JSON.parse(output) as unknown);
      const observationStr = parsed.observation;
      const isDocumentSearch = parsed.data.search_mode === 'document';

      if (!observationStr || observationStr.includes('did not match any documents')) {
        return isDocumentSearch ? '在指定文档中没有找到匹配的内容。' : '搜索没有返回任何结果。';
      }

      const allBlocks = observationStr.split('---').filter(s => s.trim());
      const resultBlocks = allBlocks.filter(block => /Ref: doc_id=/.test(block));

      if (resultBlocks.length === 0) {
        if (observationStr.trim().length > 100) {
          const prefix = isDocumentSearch ? '在指定文档中搜索到了一些结果' : '搜索到了一些结果';
          return `${prefix}，摘要: ${observationStr.trim().slice(0, 100)}...`;
        }
        return observationStr.trim() || '搜索到了一些结果，但无法提取摘要。';
      }

      const summaryItems = resultBlocks.slice(0, 3).map(block => {
        const titleMatch = block.match(/Document '([^']*)'/);
        const hitMatch = block.match(/├─ Hit:\s*"([\s\S]*?)"(?=\n\s*(└─ Next:|Ref:|---))/);
        const docName = titleMatch ? titleMatch[1] : '未知文档';
        const snippet = hitMatch && hitMatch[1] ? hitMatch[1].trim() : '...';
        return `来自 '${docName}': "${snippet.slice(0, 50)}..."`;
      });

      const searchScope = isDocumentSearch ? '在指定文档中' : '';
      let summary = `${searchScope}搜索返回了 ${resultBlocks.length} 个结果。前 ${summaryItems.length} 个是: ${summaryItems.join('; ')}`;
      if (resultBlocks.length > 3) {
        summary += '...';
      }
      return summary;
    } catch {
      return '无法解析搜索结果。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = KnowledgeShallowSearchArgsSchema.parse(args);

    const citationOffset = requireCitationSequenceOffset(context);
    const query = input.query;
    const doc_id = input.doc_id;
    const top_k = input.top_k;

    // 图谱能力档位由业务决定（ToolContext 注入 / childRunDepth），模型无权选择。
    const graph = resolveGraphPolicyFromContext(context);

    try {
      const result = await runShallowSearch({
        query,
        docId: doc_id,
        topK: top_k,
        context,
        citationOffset,
        graph,
      });
      // 轻量化：不 pretty-print，降低 tool_output 体积
      return JSON.stringify(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to search knowledge base: ${errorMsg}`);
    }
  }
}
