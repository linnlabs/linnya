import { describe, expect, it } from 'vitest';
import { admitMarkdownChartFenceBody, admitMarkdownChartSpec } from '../functions/admitMarkdownChartSpec';
import { MarkdownChartSpecSchema } from '../functions/markdownChartSpecSchema';

describe('图表准入与持久化采用同一合同', () => {
  it('组合图空次轴声明经过 canonical 后仍可保存和再导入', () => {
    const result = admitMarkdownChartSpec({
      chartType: 'combo', categories: ['Q1'],
      series: [
        { name: '数量', chartType: 'bar', values: [20] },
        { name: '比率', chartType: 'line', axis: 'secondary', values: [0.2] },
      ],
      secondaryValueAxis: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('fixture must admit');
    expect(MarkdownChartSpecSchema.safeParse(result.spec).success).toBe(true);
    expect(admitMarkdownChartFenceBody(result.canonicalText)).toEqual(result);
  });

  it('直接写入 spec 与围栏准入都拒绝超出 canonical 字节上限的数据', () => {
    const oversized = {
      chartType: 'bar',
      categories: Array.from({ length: 1000 }, (_, index) => `${index}${'类'.repeat(190)}`),
      series: [{ name: '数量', values: Array.from({ length: 1000 }, () => 1) }],
    };
    expect(admitMarkdownChartSpec(oversized).ok).toBe(false);
    expect(MarkdownChartSpecSchema.safeParse(oversized).success).toBe(false);
  });
});
