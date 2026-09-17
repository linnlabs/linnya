import { Schema, type Node as ProseMirrorNode, type Mark } from '@tiptap/pm/model';
import type { TextStyle } from '@plugin/slides/shared/deckSpec';
import { isAuthorTextStyle, type SlidesEditableTextContent, type SlidesTextSelectionStyle, type SlidesTextStylePatch } from '@plugin/slides/shared/authoringEditing';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/** 单段 + 显式换行与 Text.content 一一对应；不引入标题、列表或 HTML 持久化模型。 */
export const slideTextSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph' },
    paragraph: { content: 'inline*', toDOM: () => ['div', 0], parseDOM: [{ tag: 'div' }] },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'], parseDOM: [{ tag: 'br' }], leafText: () => '\n' },
  },
  marks: {
    authorStyle: {
      attrs: { value: { default: {} } },
      toDOM(mark) {
        const value = readAuthorStyle(mark);
        // CSS 在 view 的 decoration 中投影；mark 只持有作者样式，不能写入屏幕缩放后的字号。
        return ['span', { 'data-slide-style': JSON.stringify(value) }, 0];
      },
      parseDOM: [{ tag: 'span[data-slide-style]', getAttrs(element) {
        const raw: unknown = JSON.parse(element.getAttribute('data-slide-style') ?? '{}');
        return isAuthorTextStyle(raw) ? { value: raw } : false;
      } }],
    },
  },
});

export function readAuthorStyle(mark: Mark | undefined): TextStyle {
  const value: unknown = mark?.attrs.value;
  return isAuthorTextStyle(value) ? value : {};
}
export function textContentToDocument(content: SlidesEditableTextContent): ProseMirrorNode {
  const runs = typeof content === 'string' ? [{ text: content }] : content;
  const children: ProseMirrorNode[] = [];
  for (const run of runs) {
    const marks = run.style ? [slideTextSchema.marks.authorStyle.create({ value: run.style })] : [];
    run.text.split('\n').forEach((part, index) => {
      if (index > 0) children.push(slideTextSchema.nodes.hard_break.create(null, null, marks));
      if (part) children.push(slideTextSchema.text(part, marks));
    });
  }
  return slideTextSchema.node('doc', null, [slideTextSchema.node('paragraph', null, children)]);
}
export function documentToTextContent(doc: ProseMirrorNode): SlidesEditableTextContent {
  const runs: { text: string; style?: TextStyle }[] = [];
  doc.descendants(node => {
    if (!node.isInline) return;
    const text = node.isText ? node.text ?? '' : '\n';
    const style = readAuthorStyle(node.marks.find(mark => mark.type.name === 'authorStyle'));
    const hasStyle = Object.keys(style).length > 0;
    const previous = runs[runs.length - 1];
    if (previous && JSON.stringify(previous.style ?? {}) === JSON.stringify(style)) previous.text += text;
    else runs.push({ text, ...(hasStyle ? { style } : {}) });
  });
  return runs.some(run => run.style) ? runs : runs.map(run => run.text).join('');
}
export function patchSelectedTextStyle(state: EditorState, patch: SlidesTextStylePatch): Transaction {
  const { from, to } = state.selection;
  const tr = state.tr;
  if (from === to) return tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return;
    const style = readAuthorStyle(node.marks.find(mark => mark.type.name === 'authorStyle'));
    const next = { ...style, ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.fontSizePt !== undefined ? { fontSize: patch.fontSizePt } : {}) };
    tr.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), slideTextSchema.marks.authorStyle.create({ value: next }));
  });
  return tr;
}
export function selectedTextStyle(state: EditorState, base: { fontSizePt: number; color: string }): SlidesTextSelectionStyle {
  const sizes = new Set<number>();
  const colors = new Set<string>();
  state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
    if (!node.isInline) return;
    const style = readAuthorStyle(node.marks.find(mark => mark.type.name === 'authorStyle'));
    sizes.add(style.fontSize ?? base.fontSizePt);
    colors.add((style.color ?? base.color).toUpperCase());
  });
  return { fontSizePt: sizes.size === 1 ? [...sizes][0] : null, color: colors.size === 1 ? [...colors][0] : null };
}
