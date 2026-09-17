import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { EditorView, Decoration, DecorationSet } from '@tiptap/pm/view';
import { keymap } from '@tiptap/pm/keymap';
import { baseKeymap } from '@tiptap/pm/commands';
import { history, undo, redo, closeHistory } from '@tiptap/pm/history';
import { Slice } from '@tiptap/pm/model';
import type { SlidesEditableTextContent, SlidesTextStylePatch } from '@plugin/slides/shared/authoringEditing';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import type { InlineTextSelection } from '../definitions/richTextEditor';
import { slideTextSchema, textContentToDocument, documentToTextContent, patchSelectedTextStyle, readAuthorStyle, selectedTextStyle } from '../functions/richTextDocument';
import { authorTextCss } from '../functions/authorTextCss';

export function createRichTextEditor(options: {
  readonly element: HTMLElement;
  readonly content: SlidesEditableTextContent;
  readonly target: () => TextEditingTarget;
  readonly label: string;
  readonly update: (content: SlidesEditableTextContent) => void;
  readonly selection: (selection: InlineTextSelection | null) => void;
  readonly compositionStart: () => void;
  readonly compositionEnd: () => void;
  readonly escape: (event: KeyboardEvent) => void;
  readonly commit: (event: KeyboardEvent) => void;
}) {
  const doc = textContentToDocument(options.content);
  const breakLine = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    dispatch?.(state.tr.replaceSelectionWith(slideTextSchema.nodes.hard_break.create()).scrollIntoView());
    return true;
  };
  const view = new EditorView(options.element, {
    state: EditorState.create({ doc, selection: TextSelection.atEnd(doc), plugins: [history(), keymap({
      Enter: breakLine, 'Shift-Enter': breakLine, 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
    }), keymap(baseKeymap)] }),
    attributes: { class: 'slides-rich-text-surface', role: 'textbox', 'aria-multiline': 'true', 'aria-label': options.label },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) options.update(documentToTextContent(view.state.doc));
      reportSelection();
    },
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (!node.isInline) return;
        const style = readAuthorStyle(node.marks.find(mark => mark.type.name === 'authorStyle'));
        const span = document.createElement('span');
        Object.assign(span.style, authorTextCss(style, options.target()));
        if (span.style.cssText) decorations.push(Decoration.inline(pos, pos + node.nodeSize, { style: span.style.cssText }));
      });
      // 工具条获得焦点后仍显示原文字选区，避免用户不知道本次样式会作用到哪里。
      if (!state.selection.empty) decorations.push(Decoration.inline(state.selection.from, state.selection.to, { class: 'slides-rich-text-selection' }));
      return DecorationSet.create(state.doc, decorations);
    },
    // 外部粘贴只接纳正文，不让任意 HTML/嵌套块进入幻灯片作者合同。
    handlePaste(current, event) {
      const text = event.clipboardData?.getData('text/plain');
      if (text === undefined) return false;
      current.dispatch(current.state.tr.replaceSelection(new Slice(textContentToDocument(text).child(0).content, 0, 0)).scrollIntoView());
      return true;
    },
    handleKeyDown(_view, event) {
      if (event.isComposing || view.composing) return false;
      if (event.key === 'Escape') { options.escape(event); return true; }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { options.commit(event); return true; }
      return false;
    },
    handleDOMEvents: {
      compositionstart() { options.compositionStart(); return false; },

    },
  });
  // 注册在 PM 的事件处理器之后，使最终 DOM mutation 先被其正式 observer 接纳。
  view.dom.addEventListener('compositionend', () => {
    queueMicrotask(() => { if (!view.isDestroyed) { options.update(documentToTextContent(view.state.doc)); options.compositionEnd(); reportSelection(); } });
  });
  function reportSelection(): void {
    const { from, to, empty } = view.state.selection;
    if (empty || view.composing || view.state.doc.textBetween(from, to, '', '\n') === '') { options.selection(null); return; }
    // DOM Range 覆盖中间的折行，不能只用首尾光标的矩形估算多行选区。
    const start = view.domAtPos(from), end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    const rect = range.getBoundingClientRect();
    options.selection({ style: selectedTextStyle(view.state, options.target()), rect: {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    } });
  }
  view.focus();
  return {
    view,
    refresh() { view.updateState(view.state); reportSelection(); },
    applyStyle(patch: SlidesTextStylePatch) {
      if (!view.composing && !view.state.selection.empty) view.dispatch(closeHistory(patchSelectedTextStyle(view.state, patch)));
    },
    destroy() { options.selection(null); view.destroy(); },
  };
}
