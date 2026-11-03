import { assertProseMirrorJsonMatchesSchema } from '@linnya/markdown-domain/editing';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { JsonValueSchema, type JsonValue } from '@app/schemas';
import { createMarkdownContentExtensions } from '../../../shared/markdown-content';

function createRuntime() {
  const extensions = createMarkdownContentExtensions();
  return { schema: getSchema(extensions), manager: new MarkdownManager({ extensions }) };
}

/** 不创建编辑器、文档会话或 DOM 表面；与嵌入编辑器共用内容扩展。 */
export function parseEmbeddedMarkdown(markdown: string): JsonValue {
  const { schema, manager } = createRuntime();
  const document = schema.nodeFromJSON(manager.parse(markdown));
  document.check();
  return JsonValueSchema.parse(document.toJSON());
}

export function serializeEmbeddedMarkdown(content: JsonValue): string {
  const { schema, manager } = createRuntime();
  assertProseMirrorJsonMatchesSchema(content, schema);
  const document = schema.nodeFromJSON(content);
  if (document.type !== schema.topNodeType) throw new Error('Embedded Markdown content must be a document');
  return manager.serialize(document.toJSON());
}
