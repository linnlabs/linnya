import { describe, expect, it } from 'vitest';
import {
  buildTableColumnWidths,
  mapTextParagraphStyleToProps,
  mapTextRunStyleToProps,
} from '../presentationVisualDefaults.js';

describe('presentationVisualDefaults', () => {
  it('emits point-based lineSpacing and charSpacing when text style uses physical units', () => {
    expect(mapTextParagraphStyleToProps({
      fontSize: 12,
      lineSpacing: { kind: 'exactPt', value: 18 },
      letterSpacing: 1.5,
    })).toMatchObject({
      fontSize: 12,
      lineSpacing: 18,
      charSpacing: 1.5,
    });
  });

  it('emits multiplier-based lineSpacingMultiple when text style uses line-height ratio', () => {
    expect(mapTextParagraphStyleToProps({
      fontSize: 12,
      lineSpacing: { kind: 'multiple', value: 1.2 },
    })).toMatchObject({
      fontSize: 12,
      lineSpacingMultiple: 1.2,
    });
  });

  it('does not copy paragraph spacing into a rich-text run', () => {
    expect(mapTextRunStyleToProps({
      fontSize: 12,
      lineSpacing: { kind: 'multiple', value: 1.4 },
      align: 'center',
    })).toEqual({ fontSize: 12 });
  });

  it('长表里每格都带空格的短文字不会把其他列挤到最小宽度', () => {
    const rows = Array.from({ length: 30 }, (_, index) => [
      { text: `第 ${index + 1} 行` }, { text: String(index * 37 % 101) }, { text: '备注' },
    ]);
    const [first, second, third] = buildTableColumnWidths(5.5, ['序号', '值', '备注'], rows) ?? [];
    // 修复前第一列按 30 行累加权重拿到 4.5in，另外两列只剩 0.5in。
    expect(first).toBeLessThan(3.2);
    expect(second).toBeGreaterThan(1.1);
    expect(third).toBeGreaterThan(1.1);
  });

  it('三行以内的表格列宽与原规则一致', () => {
    const rows = [[{ text: 'New York' }, { text: '8.3' }], [{ text: 'Los Angeles' }, { text: '3.9' }]];
    // 第一列：maxCell 11 + 两行各 2 + 6 = 21；第二列：max(8, 3 + 6) = 9。
    expect(buildTableColumnWidths(3, ['City', 'Pop'], rows)).toEqual([2.1, 0.9]);
  });
});
