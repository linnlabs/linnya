import { assertProseMirrorJsonMatchesSchema } from '@linnya/markdown-domain/editing';
import { Editor } from '@tiptap/vue-3';
import { JsonValueSchema, type JsonValue } from '@app/schemas';
import type {
  EmbeddedMarkdownEditor,
  EmbeddedMarkdownEditorOptions,
} from '@linnya/plugin-host-contract/renderer/embeddedMarkdownEditor';
import { createMarkdownContentExtensions } from '../../../shared/markdown-content';

/** 外部文档持有正文和保存生命周期；此入口只拥有一个可销毁的编辑表面。 */
export function createEmbeddedMarkdownEditor(
  options: EmbeddedMarkdownEditorOptions,
): EmbeddedMarkdownEditor {
  const editor = new Editor({
    element: options.element,
    extensions: createMarkdownContentExtensions(),
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
    setEditable: editable => editor.setEditable(editable),
    focus: () => { editor.commands.focus(); },
    destroy: () => editor.destroy(),
  };
}
