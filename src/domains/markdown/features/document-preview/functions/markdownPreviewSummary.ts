import { MarkdownChartSpecSchema, type WorkspaceMarkdownPreview } from '@app/schemas';
import type { ProseMirrorJsonNode } from '../../normalization/runtime';

/** 摘要只是无样式文字说明；图片、图表和样式仍由同一份正式正文交给只读 renderer。 */
export function markdownPreviewSummary(
  document: ProseMirrorJsonNode,
  references: WorkspaceMarkdownPreview['references']
): string {
  const text: string[] = [];
  function visit(node: ProseMirrorJsonNode): void {
    if (node.text) text.push(node.text);
    if (node.type === 'documentReference' && typeof node.attrs?.documentId === 'string') {
      text.push(references[node.attrs.documentId]?.title ?? '');
    }
    if (node.type === 'chartBlock')
      text.push(MarkdownChartSpecSchema.parse(node.attrs?.spec).title ?? '');
    if (node.type === 'imageBlock') {
      const caption = node.attrs?.caption || node.attrs?.alt;
      if (typeof caption === 'string') text.push(caption);
    }
    node.content?.forEach(visit);
    if (node.type === 'rootBlock') text.push('\n');
  }
  visit(document);
  return text.join('').trim().slice(0, 4000);
}
