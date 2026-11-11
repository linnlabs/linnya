import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { assertMarkdownDocument } from '@linnya/markdown-document-core/validation';

/** 校验发生在 Editor state 改变前；共享严格规则，同时保留 Editor 诊断上下文。 */
export function parseEditorDocumentJson(content: unknown, schema: Schema): ProseMirrorNode {
  return assertMarkdownDocument(content, schema, 'EditorDocumentSchema');
}
