import { Node } from '@tiptap/core';

/** 只存稳定身份。标题、项目边界与点击行为由使用方公开引用端口提供。 */
export const DocumentReferenceNode = Node.create({
  name: 'documentReference', group: 'inline', inline: true, atom: true, selectable: true, draggable: false, marks: '_',
  addAttributes: () => ({ documentId: { default: null }, referenceId: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-document-id][data-reference-id]' }],
  renderHTML: ({ node }) => ['span', { 'data-document-id': node.attrs.documentId, 'data-reference-id': node.attrs.referenceId }, '文档'],
  renderMarkdown() { throw new Error('document_reference_projection_required'); },
});
