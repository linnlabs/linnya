import { describe, expect, it } from 'vitest';
import {
  TABLE_FILL_MESSAGE_CATALOG,
  TABLE_FILL_MESSAGE_FALLBACKS,
} from '../definitions/tableFillMessageCatalog';
import { resolveTableFillMessage } from './resolveTableFillMessage';

describe('resolveTableFillMessage', () => {
  it('使用 table-fill feature 自己的流程文案', () => {
    expect(resolveTableFillMessage(
      'tableFill.card.step',
      (_key, fallback, params) => fallback.replace('{index}', String(params?.index)),
      { index: 3 },
    )).toBe('填充第 3 行');

    expect(resolveTableFillMessage(
      'tableFill.flow.missingProject',
      (_key, fallback) => fallback,
    )).toBe('当前版本会话必须依附项目：缺少 projectId，已中止表格填充。');
  });

  it('英文 catalog 覆盖工具卡与输入上下文的全部用户文案', () => {
    const englishCatalog = TABLE_FILL_MESSAGE_CATALOG.catalogs['en-US'];
    expect(Object.keys(englishCatalog ?? {}).sort())
      .toEqual(Object.keys(TABLE_FILL_MESSAGE_FALLBACKS).sort());
    expect(englishCatalog?.['tableFill.context.exitMode']).toBe('Exit table AI mode');
    expect(englishCatalog?.['tableFill.tool.write']).toBe('Write to table');
    expect(englishCatalog?.['tableFill.tool.modeLabel']).toBe('Mode: {mode}');
  });
});
