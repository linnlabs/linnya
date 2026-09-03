/**
 * TablePasteExtension.ts
 *
 * TableBlock 的“粘贴集成”扩展（ProseMirror 原生粘贴管线）
 *
 * 目标：
 * - 将表格相关的粘贴处理（如外部表格去样式）内聚在 TableBlock 模块内；
 * - 走 ProseMirror 的 `transformPastedHTML` / `transformPasted`，在“解析前/解析后”做归一化；
 * - 根因修复“去样式后出现视觉空白行/列、行高异常”：归一化 cell 内部占位结构（末尾 br/空段落/空白文本等）。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

import { normalizePastedTableSlice, sanitizePastedTableHtml } from './TablePasteSanitizerHandler';

export const TablePasteExtension = Extension.create({
  name: 'tablePasteExtension',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tablePasteSanitizer'),
        props: {
          /**
           * 解析前：清洗 Word/Excel 的 HTML（去样式、去 Office 垃圾节点、归一化单元格末尾占位等）
           */
          transformPastedHTML: (html) => {
            if (typeof html !== 'string' || html.length === 0) return html;
            // 只在包含 table 时处理，避免影响普通富文本粘贴
            if (!/<table[\s>]/i.test(html)) return html;
            return sanitizePastedTableHtml(html);
          },

          /**
           * 解析后：对 Slice 做结构归一化（例如清理“空单元格里只有 hardBreak”这类撑高行高的内容）
           */
          transformPasted: (slice, view) => {
            try {
              const schema = view?.state?.schema;
              if (!schema) return slice;
              return normalizePastedTableSlice(slice, schema);
            } catch (e) {
              // 粘贴链路容错：不让归一化失败阻断粘贴
              return slice;
            }
          },
        },
      }),
    ];
  },
});

export default TablePasteExtension;


