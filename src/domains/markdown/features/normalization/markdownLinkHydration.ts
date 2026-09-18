import type { MarkdownDocJson, ProseMirrorJsonNode } from './types';

function readLinkHref(node: ProseMirrorJsonNode): string | null {
  if (node.type !== 'text' || !Array.isArray(node.marks)) return null;
  if (node.marks.some(mark => mark.type === 'code')) return null;
  const link = node.marks.find(mark => mark.type === 'link');
  const href = link?.attrs?.href;
  return typeof href === 'string' && href.trim().length > 0 ? href : null;
}

function collectFromNode(node: ProseMirrorJsonNode, result: string[]): void {
  if (node.type === 'codeBlock') return;
  const href = readLinkHref(node);
  if (href) result.push(href);
  for (const child of node.content ?? []) collectFromNode(child, result);
}

/** 收集结构化 Markdown 中作者明确写出的标准链接，不读取代码块/行内代码示例。 */
export function collectMarkdownLinkHrefs(docJson: MarkdownDocJson): readonly string[] {
  const result: string[] = [];
  for (const rootBlock of docJson.content) collectFromNode(rootBlock, result);
  return result;
}

/** 按 root block 收集链接，供 pending revision 按块保存来源 hydration。 */
export function collectMarkdownLinkHrefsByRootBlock(
  docJson: MarkdownDocJson
): readonly (readonly string[])[] {
  return docJson.content.map(rootBlock => {
    const result: string[] = [];
    collectFromNode(rootBlock, result);
    return result;
  });
}
