import { parseMarkdownCitationTokens } from './parseMarkdownCitationTokens';

/**
 * 保留 Markdown 的所有非 Citation 语法，只替换 parser 已接纳的 token span。
 * 生成可引用正文时，resolver 必须使用同一份 DocumentCitationProjection；语法规范化和旁路遮罩
 * 可以复用本机械转换，但它们不产生来源事实，不能借此把 token 接纳成 citation。
 */
export function projectMarkdownCitationTokens(params: {
  readonly markdown: string;
  readonly resolveRef: (ref: string) => string;
}): string {
  const tokens = parseMarkdownCitationTokens(params.markdown);
  if (tokens.length === 0) return params.markdown;

  const parts: string[] = [];
  let cursor = 0;
  for (const token of tokens) {
    parts.push(params.markdown.slice(cursor, token.start));
    parts.push(token.refs.map(params.resolveRef).join(''));
    cursor = token.end;
  }
  parts.push(params.markdown.slice(cursor));
  return parts.join('');
}
