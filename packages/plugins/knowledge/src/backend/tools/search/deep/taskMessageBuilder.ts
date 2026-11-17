/**
 * @file src/tools/knowledgebase/search/deep/taskMessageBuilder.ts
 * @description deep_search 子 Agent 任务消息构建器（从 Tool 薄壳中拆出）
 */

export function buildDeepSearchTaskMessage(params: {
  /**
   * 上层 Agent 传入的“检索查询”（来自 knowledge_search 的 query 参数）
   *
   * 注意：这不一定等于最终用户的原始请求，可能是上层 Agent 的改写/拆解/聚焦版本。
   */
  query: string;
  /**
   * 最终用户的原始请求（由编排层注入到 toolContext.userQuery）
   *
   * 设计目的：避免子 Agent 只围绕上层 query 工作，导致“偏离用户真正想要的答案维度”。
   */
  originalUserRequest?: string;
  docId?: string;
  /**
   * 每轮搜索建议的召回数量（用于 search_in_knowledgebase 的 top_k）
   *
   * 注意：
   * - deep_search 是多轮搜索，candidateTopK 不是“单轮就结束”的意思；
   * - 它是一个“每轮召回建议值”，避免子 Agent 默认只取很小的 top_k 导致覆盖面不足。
   */
  candidateTopK: number;
  topK: number;
}): string {
  const { query, originalUserRequest, docId, topK, candidateTopK } = params;
  const original = (originalUserRequest ?? '').trim();
  /**
   * 最终命中块（selected_blocks）数量上限：
   * - 需求：按 topK 的 1.5 倍，向下取整
   * - 说明：该值用于“最终提交给 assemble_documents 的命中块数量”约束
   */
  const selectedBlocksLimit = Math.floor(topK * 1.5);

  return `You are the Deep Search Sub-Agent (Search & Reading Specialist). Please strictly follow the workflow and requirements in the system prompt.

<Original User Request>
${original ? original : '(Not provided)'}
</Original User Request>

<Parent Query>
${query}

<Run Parameters>
- Search Scope: ${docId ? `Only search within doc_id="${docId}"` : 'Search across all documents (Knowledge Base)'}
- Recall Suggestion per Round: search_in_knowledgebase(top_k≈${candidateTopK}) (This is a suggestion; you can adjust it based on noise/hit quality)
- Maximum Selected Blocks: selected_blocks must be less than or equal to ${selectedBlocksLimit} (Must ensure relevance)
</Run Parameters>

<Final Action>
Call assemble_documents:
- query: "${query}"
- selected_blocks: [{ doc_id, block_id }]
  - IMPORTANT: block_id must be the real SoT block_id shown in observations (e.g. (block_id="...")). Do NOT use [@ref] as block_id.
- summary: "Provide a concise process summary (search direction/reading scope/main findings). Note: summary is not an answer, do not paste any original fragments."
</Final Action>
`;
}
