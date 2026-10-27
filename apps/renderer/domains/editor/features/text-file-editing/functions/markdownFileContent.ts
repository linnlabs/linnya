/** YAML 属于文件元数据，不交给富文本解析器，避免正文编辑改写 Skill 的声明。 */
export function splitMarkdownFile(content: string): { prefix: string; body: string } {
  const prefix = content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/)?.[0]
    ?? (content.startsWith('\uFEFF') ? '\uFEFF' : '');
  return { prefix, body: content.slice(prefix.length) };
}

export function joinMarkdownFile(prefix: string, body: string, originalBody: string): string {
  const newline = originalBody.includes('\r\n') ? '\r\n' : '\n';
  const ending = originalBody.endsWith('\n') && !body.endsWith('\n') ? '\n' : '';
  return prefix + (body + ending).replace(/\r?\n/g, newline);
}
