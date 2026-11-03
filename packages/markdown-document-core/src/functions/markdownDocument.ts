import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { DOMSerializer } from '@tiptap/pm/model';
import { JsonValueSchema, type JsonValue } from '@app/schemas';
import { assertMarkdownDocument } from './assertMarkdownDocument';
import { renderMarkdownMathematics } from './renderMarkdownMathematics';
import { createMarkdownDocumentExtensions } from './createMarkdownDocumentExtensions';

const extensions = createMarkdownDocumentExtensions();
const schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });

export function assertPortableMarkdownDocument(content: JsonValue): void { assertMarkdownDocument(content, schema); }

export function parseMarkdownDocument(markdown: string): JsonValue {
  const parsed = manager.parse(markdown);
  // Markdown空输入不产生块；让唯一schema生成最小合法正文，避免各消费者另造空文档。
  if (!parsed.content?.length) {
    const empty = schema.topNodeType.createAndFill();
    if (!empty) throw new Error('Markdown schema cannot create an empty document');
    return JsonValueSchema.parse(empty.toJSON());
  }
  assertMarkdownDocument(parsed, schema);
  return JsonValueSchema.parse(schema.nodeFromJSON(parsed).toJSON());
}
export function serializeMarkdownDocument(content: JsonValue): string {
  assertMarkdownDocument(content, schema);
  const node = schema.nodeFromJSON(content);
  if (node.type !== schema.topNodeType) throw new Error('Markdown content must be a document');
  return manager.serialize(node.toJSON());
}
/** DOM 由调用方显式提供；模块导入、schema 和 Markdown 转换在无 DOM 的 Node 中也可运行。 */
export function createMarkdownDocumentFragment(content: JsonValue, document: Document): DocumentFragment {
  assertMarkdownDocument(content, schema);
  const node = schema.nodeFromJSON(content);
  if (node.type !== schema.topNodeType) throw new Error('Markdown content must be a document');
  const fragment = document.createDocumentFragment();
  DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document }, fragment);
  renderMarkdownMathematics(fragment);
  return fragment;
}
