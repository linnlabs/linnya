import { JsonValueSchema, type DocumentReferenceMarkdownBinding } from '@app/schemas';
import { parseMarkdownDocument } from '@linnya/markdown-document-core';
import { normalizedReferencePath, transformWorkspaceReferenceLinks } from '@linnya/markdown-document-core/references';

/** 按实际投递的Markdown link配对，不把未读分页或代码中的相同字符串当作已读凭据。 */
export function selectDeliveredReferenceBindings(markdown: string, bindings: readonly DocumentReferenceMarkdownBinding[]) {
  const counts = new Map<string, number>();
  transformWorkspaceReferenceLinks(JsonValueSchema.parse(parseMarkdownDocument(markdown)), (nodes, href) => {
    try {
      const key = JSON.stringify([normalizedReferencePath(href), nodes.map(node => node.text ?? '').join('')]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    } catch (error) { if (!(error instanceof URIError)) throw error; }
    return { type: 'text', text: '' };
  });
  return bindings.filter(binding => {
    const key = JSON.stringify([binding.path, binding.label]); const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    counts.set(key, count - 1); return true;
  });
}
