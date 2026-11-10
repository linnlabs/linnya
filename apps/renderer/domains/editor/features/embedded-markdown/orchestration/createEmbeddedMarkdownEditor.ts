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
import { createEmbeddedMarkdownSpaceInput } from './createEmbeddedMarkdownSpaceInput';
import { installEmbeddedMarkdownNavigation } from './installEmbeddedMarkdownNavigation';
import { createEditorFocusBoundary } from '@/domains/editor/shared/focus';

/** 外部文档持有正文和保存生命周期；此入口只拥有一个可销毁的编辑表面。 */
export function createEmbeddedMarkdownEditor(
  options: EmbeddedMarkdownEditorOptions,
): EmbeddedMarkdownEditor {
  const insertions = new Set<EmbeddedMarkdownInsertion>();
  const space = createEmbeddedMarkdownSpaceInput();
  let navigation: ReturnType<typeof installEmbeddedMarkdownNavigation> | null = null;
  const cancelInsertions = () => { for (const insertion of [...insertions]) insertion.cancel(); };
  const focus = createEditorFocusBoundary(options.element, () => options.onBlur?.());
  const editor = new Editor({
    element: options.element,
    extensions: createMarkdownDocumentExtensions([createEmbeddedMarkdownImage(options), createDocumentReferenceExtension(undefined, focus.registerPortal)]),
    editable: !options.readonly,
    editorProps: {
      // 根节点就是正文容器：与 createMarkdownDocumentFragment 的只读呈现共用 .markdown-document-content 规则（含首尾边距）。
      attributes: { class: 'markdown-document-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': options.label },
      handleTextInput: (view, _from, _to, text) => space.capture(view, text),
    },
    onUpdate: () => options.onUpdate(JsonValueSchema.parse(editor.getJSON())),
    onTransaction: ({ transaction }) => space.record(transaction),
  });
  const replaceContent = (content: JsonValue): void => {
    // Tiptap 的宽松 HTML/JSON 接纳会丢未知节点；先用同一生产 schema 完整校验。
    assertProseMirrorJsonMatchesSchema(content, editor.schema);
    const document = editor.schema.nodeFromJSON(content);
    if (document.type !== editor.schema.topNodeType) {
      throw new Error('Embedded Markdown content must be a document');
    }
    cancelInsertions();
    navigation?.cancel();
    editor.commands.setContent(document.toJSON(), { emitUpdate: false, errorOnInvalidContent: true });
  };
  try {
    replaceContent(options.content);
  } catch (error) {
    focus.destroy();
    editor.destroy();
    throw error;
  }
  if (options.onNavigate) navigation = installEmbeddedMarkdownNavigation({ element: options.element, editor, space, navigate: options.onNavigate });
  return {
    readContent: () => JsonValueSchema.parse(editor.getJSON()),
    readMarkdown: () => editor.getMarkdown(),
    replaceContent,
    insertContent(content) {
      if (!editor.isEditable) throw new Error('只读正文不能插入内容');
      assertProseMirrorJsonMatchesSchema(content, editor.schema);
      const node = editor.schema.nodeFromJSON(content);
      editor.commands.insertContent(node.type === editor.schema.topNodeType ? node.content.toJSON() : node.toJSON());
    },
    captureInsertion() {
      if (!editor.isEditable) throw new Error('只读正文不能插入内容');
      const insertion = createEmbeddedMarkdownInsertion(editor, () => insertions.delete(insertion));
      insertions.add(insertion); return insertion;
    },
    setEditable: editable => { if (!editable) { cancelInsertions(); navigation?.cancel(); } editor.setEditable(editable); },
    focus: () => { editor.commands.focus(); },
    destroy: () => { focus.destroy(); navigation?.dispose(); cancelInsertions(); editor.destroy(); },
  };
}
