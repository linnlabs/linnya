import { describe, expect, it } from 'vitest';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import {
  buildTableBlockAiOptions,
  buildTableBlockAlignOptions,
  buildTableBlockDebugOptions,
  buildTableBlockInsertOptions,
  formatTableBlockReferenceTitle,
  formatTableBlockSelectionRangeTitle,
  formatTableBlockSizeDisplay,
} from './tableBlockPresentation';

const testMessage: EditorMessageResolver = (key, params) => {
  const messages: Partial<Record<Parameters<EditorMessageResolver>[0], string>> = {
    'editor.tableBlock.menu.insertRowBefore': 'Insert row above',
    'editor.tableBlock.menu.insertRowAfter': 'Insert row below',
    'editor.tableBlock.menu.insertColumnBefore': 'Insert column left',
    'editor.tableBlock.menu.insertColumnAfter': 'Insert column right',
    'editor.tableBlock.toolbar.aiFill': 'AI fill',
    'editor.tableBlock.menu.aiAnalyze': 'AI analyze',
    'editor.tableBlock.menu.alignLeft': 'Align left',
    'editor.tableBlock.menu.alignCenter': 'Align center',
    'editor.tableBlock.menu.alignRight': 'Align right',
    'editor.tableBlock.menu.jsonFormat': 'JSON format',
    'editor.tableBlock.menu.csvFormat': 'CSV format',
    'editor.tableBlock.menu.markdownTable': 'Markdown table',
    'editor.tableBlock.menu.rawData': 'Raw data',
    'editor.tableBlock.size.display': '{rows} × {cols} table',
    'editor.tableBlock.context.insertReference': 'Insert reference: {reference}',
    'editor.tableBlock.context.selectionRangeTitle': 'Selection range: {range}',
  };

  const raw = messages[key] ?? key;
  if (!params) return raw;

  return Object.entries(params).reduce((text, [paramKey, value]) => {
    return text.replace(`{${paramKey}}`, String(value));
  }, raw);
};

describe('tableBlockPresentation', () => {
  it('构造表格工具栏菜单展示文案', () => {
    expect(buildTableBlockInsertOptions(testMessage).map((option) => option.text)).toEqual([
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
    ]);
    expect(buildTableBlockAiOptions(testMessage).map((option) => option.text)).toEqual([
      'AI fill',
      'AI analyze',
    ]);
    expect(buildTableBlockDebugOptions(testMessage).map((option) => option.text)).toEqual([
      'JSON format',
      'CSV format',
      'Markdown table',
      'Raw data',
    ]);
  });

  it('保留对齐图标并解析对齐菜单文案', () => {
    const alignOptions = buildTableBlockAlignOptions(testMessage);

    expect(alignOptions.map((option) => option.text)).toEqual([
      'Align left',
      'Align center',
      'Align right',
    ]);
    expect(alignOptions.every((option) => option.icon?.includes('<svg'))).toBe(true);
  });

  it('格式化表格上下文和尺寸展示', () => {
    expect(formatTableBlockSizeDisplay(3, 4, testMessage)).toBe('3 × 4 table');
    expect(formatTableBlockReferenceTitle('A1:A3', testMessage)).toBe('Insert reference: A1:A3');
    expect(formatTableBlockSelectionRangeTitle('B2:C4', testMessage)).toBe('Selection range: B2:C4');
  });
});
