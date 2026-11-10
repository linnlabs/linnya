import { InlineDocumentReferenceAttrsSchema, type DocumentReferencePresentation } from '@app/schemas';

export function readDocumentReferenceAttrs(value: unknown) { return InlineDocumentReferenceAttrsSchema.parse(value); }
export function formatDocumentReferenceMarkdown(presentation: DocumentReferencePresentation): string {
  if (!['available', 'plugin_unavailable'].includes(presentation.status) || !presentation.path || !presentation.title) return '[文档当前不可访问]';
  const title = presentation.title.replace(/[\[\]\\]/g, value => '\\' + value);
  const path = presentation.path.split('/').map((segment, index) => index ? encodeURIComponent(segment).replace(/[()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase()) : segment).join('/');
  return `[${title}](${path})`;
}
