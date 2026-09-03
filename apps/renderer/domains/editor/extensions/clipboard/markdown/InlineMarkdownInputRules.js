// src/renderer/extensions/markdown/InlineMarkdownInputRules.js

import { Extension } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';

export const InlineMarkdownInputRules = Extension.create({
  name: 'inlineMarkdownInputRules',

  addInputRules() {
    return [
      // ULTRA-SIMPLE TEST RULE (放在最前面)
      {
        find: /^xx\s$/, // 匹配 "xx" 后面跟一个空格
        handler: ({ state, range, match }) => {
          const { tr, schema } = state;
          // 删除 "xx "
          tr.delete(range.from, range.to);
          // 插入 "TEST"
          tr.insertText('TEST', range.from);
          // 更新光标位置
          const pos = range.from + 'TEST'.length;
          tr.setSelection(TextSelection.create(tr.doc, pos));
          return tr;
        }
      },
      // 优先匹配加粗+斜体组合 (***文本***)
      {
        find: /(\*{3})([^\*]+)(\*{3})/,
        handler: ({ state, range, match, view }) => {
          const text = match[2];
          const { tr, schema } = state;
          const boldMarkType = schema.marks.bold;
          const italicMarkType = schema.marks.italic;
          if (!boldMarkType || !italicMarkType) {
            console.warn('Bold or Italic mark type not found in schema');
            return null;
          }
          const marks = [boldMarkType.create(), italicMarkType.create()];
          tr.replaceWith(range.from, range.to, schema.text(text, marks));
          const pos = range.from + text.length;
          tr.setSelection(TextSelection.create(tr.doc, pos));
          tr.setStoredMarks([]);
          return tr;
        }
      },
      
      // 加粗规则 (**文本**)
      {
        find: /(?<!\*)\*\*([^\*]+)\*\*(?!\*)/,
        handler: ({ state, range, match }) => {
          const text = match[1];
          const { tr, schema } = state;
          const markType = schema.marks.bold;
          if (!markType) return null;
          const mark = markType.create();
          tr.replaceWith(range.from, range.to, schema.text(text, [mark]));
          const pos = range.from + text.length;
          tr.setSelection(TextSelection.create(tr.doc, pos));
          tr.setStoredMarks([]);
          return tr;
        }
      },
      
      // 斜体规则 (*文本*)
      {
        find: /(?<!\*)\*([^\*]+)\*(?!\*)/,
        handler: ({ state, range, match }) => {
          const text = match[1];
          const { tr, schema } = state;
          const markType = schema.marks.italic;
          if (!markType) return null;
          const mark = markType.create();
          tr.replaceWith(range.from, range.to, schema.text(text, [mark]));
          const pos = range.from + text.length;
          tr.setSelection(TextSelection.create(tr.doc, pos));
          tr.setStoredMarks([]);
          return tr;
        }
      },
      
      // 删除线规则 (~~文本~~)
      {
        find: /~~([^~]+)~~/,
        handler: ({ state, range, match }) => {
          const text = match[1];
          const { tr, schema } = state;
          const markType = schema.marks.strike;
          if (!markType) return null;
          const mark = markType.create();
          tr.replaceWith(range.from, range.to, schema.text(text, [mark]));
          const pos = range.from + text.length;
          tr.setSelection(TextSelection.create(tr.doc, pos));
          tr.setStoredMarks([]);
          return tr;
        }
      },
      
      // 链接规则
      {
        find: /\[([^\]]+)\]\(([^)]+)\)/,
        handler: ({ state, match, chain }) => {
          const [fullMatch, text, url] = match;
          chain()
            .deleteRange({ from: state.selection.from - fullMatch.length, to: state.selection.from })
            .setLink({ href: url })
            .insertContent(text)
            .run();
          return true;
        }
      },
    ];
  }
}); 