import type { Editor } from '@tiptap/core';
import type { JsonValue } from '@app/schemas';
import { assertMarkdownDocument } from '@linnya/markdown-document-core/validation';
import type { EmbeddedMarkdownInsertion } from '@linnya/plugin-host-contract/renderer/embeddedMarkdownEditor';

/** 异步图片准备期间锚点随正文事务映射；外层切卡会主动取消全部锚点。 */
export function createEmbeddedMarkdownInsertion(editor: Editor, release: () => void): EmbeddedMarkdownInsertion {
  let bookmark = editor.state.selection.getBookmark();
  let active = true;
  const map = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => { bookmark = bookmark.map(transaction.mapping); };
  const cancel = () => { if (!active) return; active = false; editor.off('transaction', map); release(); };
  editor.on('transaction', map);
  return {
    insert(content: JsonValue) {
      if (!active) return false;
      assertMarkdownDocument(content, editor.schema);
      const selection = bookmark.resolve(editor.state.doc);
      const node = editor.schema.nodeFromJSON(content);
      cancel();
      return editor.commands.insertContentAt({ from: selection.from, to: selection.to }, node.type === editor.schema.topNodeType ? node.content.toJSON() : node.toJSON(), { updateSelection: false, errorOnInvalidContent: true });
    },
    cancel,
  };
}
