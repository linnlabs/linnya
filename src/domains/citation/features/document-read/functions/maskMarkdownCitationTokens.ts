import { projectMarkdownCitationTokens } from './projectMarkdownCitationTokens';

/**
 * Secondary views（例如 pending diff）只表达“这里有引用”，不暴露可直接引用的 ref。
 * 可引用 token 必须来自同一正文窗口及其结构化 metadata，不能从旁路详情进入模型上下文。
 */
export function maskMarkdownCitationTokens(markdown: string): string {
  return projectMarkdownCitationTokens({
    markdown,
    resolveRef: () => '【citation】',
  });
}
