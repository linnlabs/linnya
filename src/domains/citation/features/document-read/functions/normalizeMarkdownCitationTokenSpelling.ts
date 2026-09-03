import { projectMarkdownCitationTokens } from './projectMarkdownCitationTokens';

/**
 * 把 parser 已接纳的 Markdown Citation token 统一为 Agent 正文使用的 `[@ref]`。
 *
 * 这只是语法规范化，不接纳来源事实，也不生成 citation metadata。写入规划用它比较
 * Agent 可见目标与当前 citation-aware 视图，正式来源仍必须经过 DocumentCitationProjection。
 */
export function normalizeMarkdownCitationTokenSpelling(markdown: string): string {
  return projectMarkdownCitationTokens({
    markdown,
    resolveRef: ref => `[@${ref}]`,
  });
}
