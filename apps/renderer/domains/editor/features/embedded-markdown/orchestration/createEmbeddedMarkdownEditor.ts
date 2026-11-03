import { assertProseMirrorJsonMatchesSchema } from '@linnya/markdown-domain/editing';
import { Editor } from '@tiptap/vue-3';
import { JsonValueSchema, type JsonValue } from '@app/schemas';
import type {
  EmbeddedMarkdownEditor,
  EmbeddedMarkdownEditorOptions,
  EmbeddedMarkdownInsertion,
} from '@linnya/plugin-host-contract/renderer/embeddedMarkdownEditor';
import { createEmbeddedMarkdownImage } from './createEmbeddedMarkdownImage';
import { createEmbeddedMarkdownInsertion } from './createEmbeddedMarkdownInsertion';
import { createMarkdownDocumentExtensions } from '@linnya/markdown-document-core';
import { createDocumentReferenceExtension } from '@/domains/editor/features/document-references';

/** 外部文档持有正文和保存生命周期；此入口只拥有一个可销毁的编辑表面。 */
export function createEmbeddedMarkdownEditor(
  options: EmbeddedMarkdownEditorOptions,
): EmbeddedMarkdownEditor {
  const insertions = new Set<EmbeddedMarkdownInsertion>();
  const cancelInsertions = () => { for (const insertion of [...insertions]) insertion.cancel(); };
  const editor = new Editor({
    element: options.element,
    extensions: createMarkdownDocumentExtensions([createEmbeddedMarkdownImage(options), createDocumentReferenceExtension()]),
    editable: !options.readonly,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': options.label },
    },
    onUpdate: () => options.onUpdate(JsonValueSchema.parse(editor.getJSON())),
    onBlur: () => options.onBlur?.(),
  });
  const replaceContent = (content: JsonValue): void => {
    // Tiptap 的宽松 HTML/JSON 接纳会丢未知节点；先用同一生产 schema 完整校验。
    assertProseMirrorJsonMatchesSchema(content, editor.schema);
    const document = editor.schema.nodeFromJSON(content);
    if (document.type !== editor.schema.topNodeType) {
      throw new Error('Embedded Markdown content must be a document');
    }
    cancelInsertions();
    editor.commands.setContent(document.toJSON(), { emitUpdate: false, errorOnInvalidContent: true });
  };
  try {
    replaceContent(options.content);
  } catch (error) {
    editor.destroy();
    throw error;
  }
  return {
    readContent: () => JsonValueSchema.parse(editor.getJSON()),
    readMarkdown: () => editor.getMarkdown(),
    replaceContent,
    insertContent(content) {
      assertProseMirrorJsonMatchesSchema(content, editor.schema);
      const node = editor.schema.nodeFromJSON(content);
      editor.commands.insertContent(node.type === editor.schema.topNodeType ? node.content.toJSON() : node.toJSON());
    },
    captureInsertion() {
      const insertion = createEmbeddedMarkdownInsertion(editor, () => insertions.delete(insertion));
      insertions.add(insertion); return insertion;
    },
    setEditable: editable => editor.setEditable(editable),
    focus: () => { editor.commands.focus(); },
    destroy: () => { cancelInsertions(); editor.destroy(); },
  };
}
