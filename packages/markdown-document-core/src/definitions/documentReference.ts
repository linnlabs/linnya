import { InlineDocumentReferenceAttrsSchema } from '@app/schemas';
import { Node } from '@tiptap/core';

/** 只存稳定身份。标题、项目边界与点击行为由使用方公开引用端口提供。 */
export const DocumentReferenceNode = Node.create({
  name: 'documentReference', group: 'inline', inline: true, atom: true, selectable: true, draggable: false, marks: '_',
  addAttributes: () => ({
    documentId: { default: null, validate: (value: unknown) => { InlineDocumentReferenceAttrsSchema.shape.documentId.parse(value); }, parseHTML: element => element.getAttribute('data-document-id') },
    referenceId: { default: null, validate: (value: unknown) => { InlineDocumentReferenceAttrsSchema.shape.referenceId.parse(value); }, parseHTML: element => element.getAttribute('data-reference-id') },
  }),
  parseHTML: () => [{ tag: 'span[data-document-id][data-reference-id]' }],
  renderHTML: ({ node }) => ['span', { 'data-document-id': node.attrs.documentId, 'data-reference-id': node.attrs.referenceId, class: 'markdown-document-reference' },
    ['span', { class: 'markdown-document-reference-icon', 'data-document-reference-icon': '', 'aria-hidden': 'true' }],
    ['span', { class: 'markdown-document-reference-label', 'data-document-reference-label': '' }, '文档'],
  ],
  renderMarkdown() { throw new Error('document_reference_projection_required'); },
});
