import { describe, expect, it } from 'vitest';
import { MARKDOWN_CHART_TYPES, type MarkdownChartType } from '../definitions/markdownChartConstants';
import type { MarkdownChartDiagnosticCode } from '../definitions/markdownChartDiagnostic';
import { admitMarkdownChartFenceBody, admitMarkdownChartSpec } from '../functions/admitMarkdownChartSpec';
import { MarkdownChartSpecSchema } from '../functions/markdownChartSpecSchema';
import { cloneFixture, markdownChartFixtures } from './markdownChartFixtures';

type Mutation = (spec: Record<string, unknown>) => void;

function reject(type: MarkdownChartType, mutate: Mutation) {
  const spec = cloneFixture(type);
  mutate(spec);
  const result = admitMarkdownChartSpec(spec);
  if (result.ok) throw new Error(`expected rejection for ${type}, got:\n${result.canonicalText}`);
  return result.diagnostics;
}

function find(
  diagnostics: ReturnType<typeof reject>,
  code: MarkdownChartDiagnosticCode,
  path: string,
) {
  const hit = diagnostics.find(item => item.code === code && item.path === path);
  expect(hit, `${code} at ${path} in ${JSON.stringify(diagnostics)}`).toBeDefined();
  return hit;
}

describe('图表规格准入：八类合法样本', () => {
  it.each(MARKDOWN_CHART_TYPES)('%s 样本通过，并给出可重新准入的 canonical 文本', type => {
    const result = admitMarkdownChartSpec(markdownChartFixtures[type]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.chartType).toBe(type);

    const again = admitMarkdownChartFenceBody(result.canonicalText);
    expect(again.ok && again.canonicalText).toBe(result.canonicalText);
    expect(MarkdownChartSpecSchema.safeParse(result.spec).success).toBe(true);
  });

  it('接受大小写混写的十六进制色并规范为大写', () => {
    const spec = cloneFixture('radar');
    const result = admitMarkdownChartSpec(spec);
    expect(result.ok && result.canonicalText).toContain('"color": "#D9480F"');
  });
});

describe('图表规格准入：形状与适用性', () => {
  it('拒绝未知字段与对当前类型不适用的字段，并区分两种说明', () => {
    const unknown = reject('bar', spec => { spec.echartsOption = {}; });
    expect(find(unknown, 'unknown_field', 'echartsOption')?.message).toMatch(/^unknown field/);

    const inapplicable = reject('bar', spec => { spec.radarScale = { min: 0, max: 10 }; });
    expect(find(inapplicable, 'unknown_field', 'radarScale')?.message).toMatch(/does not apply to chartType "bar"/);

    const series = reject('bar', spec => {
      (spec.series as Record<string, unknown>[])[0].lineDash = 'dash';
    });
    expect(find(series, 'unknown_field', 'series[0].lineDash')?.message).toMatch(/does not apply/);
  });

  it.each<[MarkdownChartType, string, unknown]>([
    ['line', 'stacking', 'stacked'],
    ['line', 'barDirection', 'horizontal'],
    ['area', 'stacking', 'stacked'],
    ['pie', 'valueAxis', { title: 'x' }],
    ['pie', 'categoryAxis', {}],
    ['doughnut', 'stacking', 'none'],
    ['scatter', 'categoryAxis', { title: 'x' }],
    ['scatter', 'showDataLabels', true],
    ['radar', 'valueAxis', { min: 0 }],
    ['radar', 'showDataLabels', true],
    ['bar', 'secondaryValueAxis', { title: 'x' }],
    ['bar', 'xAxis', { title: 'x' }],
    ['bar', 'pointLabels', ['a', 'b', 'c']],
    ['combo', 'stacking', 'stacked'],
    ['combo', 'barDirection', 'horizontal'],
  ])('%s 不接受字段 %s', (type, field, value) => {
    const diagnostics = reject(type, spec => { spec[field] = value; });
    find(diagnostics, 'unknown_field', field);
  });

  it('饼图系列不接受 color（按类目取色，逐点色用 pointColors）', () => {
    const diagnostics = reject('pie', spec => { (spec.series as Record<string, unknown>[])[0].color = '#112233'; });
    find(diagnostics, 'unknown_field', 'series[0].color');
  });

  it('percentage / category 标签内容只属于饼与环', () => {
    const bar = reject('bar', spec => { spec.dataLabelContent = 'percentage'; });
    expect(bar.some(item => item.path === 'dataLabelContent')).toBe(true);

    const doughnut = cloneFixture('doughnut');
    doughnut.dataLabelContent = 'category';
    expect(admitMarkdownChartSpec(doughnut).ok).toBe(true);
  });

  it('缺失或错误的 chartType、版本都有明确诊断', () => {
    find(reject('bar', spec => { delete spec.chartType; }), 'invalid_chart_type', 'chartType');
    find(reject('bar', spec => { spec.chartType = 'funnel'; }), 'invalid_chart_type', 'chartType');
    find(reject('bar', spec => { spec.version = 2; }), 'unsupported_version', 'version');

    const explicitOne = cloneFixture('bar');
    explicitOne.version = 1;
    const result = admitMarkdownChartSpec(explicitOne);
    expect(result.ok && result.canonicalText).not.toContain('version');
  });

  it('根必须是 JSON 对象', () => {
    for (const input of [null, [], 'bar', 3]) {
      const result = admitMarkdownChartSpec(input);
      expect(!result.ok && result.diagnostics[0]?.code).toBe('not_an_object');
    }
  });

  it('数值必须是有限数字，不接受 null、字符串数字或布尔', () => {
    for (const bad of [null, '12', true, Number.NaN, Number.POSITIVE_INFINITY]) {
      const diagnostics = reject('bar', spec => {
        (spec.series as { values: unknown[] }[])[0].values[1] = bad;
      });
      expect(diagnostics.some(item => item.path === 'series[0].values[1]')).toBe(true);
    }
    const categoryBoolean = reject('bar', spec => { (spec.categories as unknown[])[0] = true; });
    expect(categoryBoolean.some(item => item.path === 'categories[0]')).toBe(true);
  });

  it('标题、类目、系列名不能为空白或含控制字符', () => {
    find(reject('bar', spec => { spec.title = '   '; }), 'invalid_shape', 'title');
    find(reject('bar', spec => { spec.title = '第一行\n第二行'; }), 'invalid_shape', 'title');
    find(reject('bar', spec => { (spec.categories as unknown[])[1] = ''; }), 'invalid_shape', 'categories[1]');
    find(reject('bar', spec => { (spec.series as { name: string }[])[0].name = '\t'; }), 'invalid_shape', 'series[0].name');
  });

  it('颜色只接受 #RRGGBB', () => {
    for (const color of ['red', '#12345', '#GGGGGG', 'rgb(1,2,3)', 'url(x)']) {
      find(reject('radar', spec => { (spec.series as { color?: string }[])[0].color = color; }), 'invalid_shape', 'series[0].color');
    }
  });
});

describe('图表规格准入：数据关系', () => {
  it('每个系列必须与类目等长，且系列名唯一', () => {
    const mismatch = reject('line', spec => { (spec.series as { values: number[] }[])[1].values.pop(); });
    expect(find(mismatch, 'length_mismatch', 'series[1].values')?.message).toMatch(/one value per category/);

    find(reject('line', spec => { (spec.series as { name: string }[])[1].name = '营收'; }), 'duplicate_name', 'series[1].name');
  });

  it('pointColors 必须等长', () => {
    find(reject('doughnut', spec => {
      (spec.series as { pointColors: unknown[] }[])[0].pointColors.push('#000000');
    }), 'length_mismatch', 'series[0].pointColors');
  });

  it('同一阶段内一次报告全部问题；形状修正后才进入数据关系检查', () => {
    const broken = cloneFixture('bar');
    broken.title = '';
    broken.extra = 1;
    (broken.series as { values: number[] }[])[0].values.pop();

    const shape = admitMarkdownChartSpec(broken);
    expect(!shape.ok && new Set(shape.diagnostics.map(item => item.path))).toEqual(new Set(['title', 'extra']));

    delete broken.extra;
    broken.title = '修正后的标题';
    const relation = admitMarkdownChartSpec(broken);
    expect(!relation.ok && relation.diagnostics.map(item => item.path)).toEqual(['series[0].values']);
  });
});

describe('图表规格准入：类型专属规则', () => {
  it('柱与面积的数值轴必须包含零，折线可以不含', () => {
    find(reject('bar', spec => { spec.valueAxis = { min: 5 }; }), 'out_of_range', 'valueAxis.min');
    find(reject('bar', spec => { spec.valueAxis = { max: -1 }; }), 'out_of_range', 'valueAxis.max');
    find(reject('area', spec => { spec.valueAxis = { min: 10 }; }), 'out_of_range', 'valueAxis.min');

    const line = cloneFixture('line');
    line.valueAxis = { min: 80, max: 140 };
    expect(admitMarkdownChartSpec(line).ok).toBe(true);
  });

  it('坐标轴范围、主刻度和数字格式', () => {
    find(reject('line', spec => { spec.valueAxis = { min: 5, max: 5 }; }), 'out_of_range', 'valueAxis.max');
    expect(reject('line', spec => { spec.valueAxis = { majorUnit: 0 }; }).some(item => item.path === 'valueAxis.majorUnit')).toBe(true);
    expect(reject('line', spec => { spec.valueAxis = { numberFormat: 'yyyy' }; }).some(item => item.path === 'valueAxis.numberFormat')).toBe(true);
    expect(reject('line', spec => { spec.categoryAxis = { labelRotation: 120 }; }).some(item => item.path === 'categoryAxis.labelRotation')).toBe(true);
    expect(reject('line', spec => { spec.dataLabelFormat = '[Red]0'; }).some(item => item.path === 'dataLabelFormat')).toBe(true);
  });

  it('百分比堆叠只接受非负组成数据，且不能设置轴范围', () => {
    const percent = (mutate: Mutation) => reject('bar', spec => {
      spec.stacking = 'percent';
      spec.series = [
        { name: 'A', values: [1, 2, 3] },
        { name: 'B', values: [3, 2, 1] },
      ];
      mutate(spec);
    });
    find(percent(spec => { (spec.series as { values: number[] }[])[0].values[1] = -1; }), 'out_of_range', 'series[0].values[1]');
    find(percent(spec => { spec.series = [{ name: 'A', values: [0, 1, 1] }, { name: 'B', values: [0, 1, 1] }]; }), 'out_of_range', 'categories[0]');
    find(percent(spec => { spec.valueAxis = { max: 1 }; }), 'invalid_combination', 'valueAxis');

    const ok = cloneFixture('bar');
    ok.stacking = 'percent';
    ok.series = [{ name: 'A', values: [1, 2, 3] }, { name: 'B', values: [3, 2, 1] }];
    expect(admitMarkdownChartSpec(ok).ok).toBe(true);
  });

  it('普通堆叠允许正负贡献', () => {
    const stacked = cloneFixture('bar');
    stacked.stacking = 'stacked';
    stacked.series = [{ name: '增', values: [3, 2, 1] }, { name: '减', values: [-1, -2, -1] }];
    expect(admitMarkdownChartSpec(stacked).ok).toBe(true);
  });

  it('饼与环只有一个非负、合计为正的系列', () => {
    find(reject('pie', spec => { (spec.series as unknown[]).push({ name: '第二个', values: [1, 2, 3] }); }), 'invalid_combination', 'series');
    find(reject('pie', spec => { (spec.series as { values: number[] }[])[0].values[0] = -1; }), 'out_of_range', 'series[0].values[0]');
    find(reject('doughnut', spec => { (spec.series as { values: number[] }[])[0].values = [0, 0]; }), 'out_of_range', 'series[0].values');
  });

  it('散点：X 必须是数值，pointLabels 与 X 等长', () => {
    expect(reject('scatter', spec => { spec.categories = ['a', 'b', 'c']; }).some(item => item.path.startsWith('categories'))).toBe(true);
    find(reject('scatter', spec => { (spec.pointLabels as string[]).pop(); }), 'length_mismatch', 'pointLabels');

    const duplicateX = cloneFixture('scatter');
    duplicateX.categories = [1, 1, 2];
    expect(admitMarkdownChartSpec(duplicateX).ok).toBe(true);
  });

  it('雷达：至少三个不重复维度、固定量尺、数值在量尺内', () => {
    expect(reject('radar', spec => { spec.categories = ['a', 'b']; (spec.series as { values: number[] }[]).forEach(s => { s.values = [1, 2]; }); }).some(item => item.path === 'categories')).toBe(true);
    find(reject('radar', spec => { (spec.categories as string[])[1] = '性能'; }), 'duplicate_name', 'categories[1]');
    expect(reject('radar', spec => { delete spec.radarScale; }).some(item => item.path === 'radarScale')).toBe(true);
    expect(reject('radar', spec => { spec.radarScale = { min: 1, max: 10 }; }).some(item => item.path === 'radarScale.min')).toBe(true);
    find(reject('radar', spec => { (spec.series as { values: number[] }[])[0].values[0] = 101; }), 'out_of_range', 'series[0].values[0]');
    find(reject('radar', spec => { (spec.series as { values: number[] }[])[0].values[0] = -1; }), 'out_of_range', 'series[0].values[0]');
  });

  it('组合：显式系列类型，次轴与次轴系列双向对应', () => {
    expect(reject('combo', spec => { delete (spec.series as Record<string, unknown>[])[0].chartType; }).some(item => item.path === 'series[0].chartType')).toBe(true);
    find(reject('combo', spec => { spec.series = [(spec.series as unknown[])[0]]; }), 'invalid_shape', 'series');
    find(reject('combo', spec => { delete spec.secondaryValueAxis; }), 'invalid_combination', 'secondaryValueAxis');
    find(reject('combo', spec => { delete (spec.series as Record<string, unknown>[])[1].axis; }), 'invalid_combination', 'secondaryValueAxis');
    find(reject('combo', spec => {
      (spec.series as Record<string, unknown>[]).forEach(series => { series.axis = 'secondary'; });
    }), 'invalid_combination', 'series');
    find(reject('combo', spec => { (spec.series as Record<string, unknown>[])[0].lineDash = 'dash'; }), 'invalid_combination', 'series[0].lineDash');
    find(reject('combo', spec => { (spec.series as Record<string, unknown>[])[1].pointColors = ['#000000', null, null, null]; }), 'invalid_combination', 'series[1].pointColors');
  });

  it('组合的次轴如果承载柱系列，同样必须包含零', () => {
    const combo = cloneFixture('combo');
    (combo.series as Record<string, unknown>[])[0].axis = 'secondary';
    (combo.series as Record<string, unknown>[])[1].axis = 'primary';
    combo.secondaryValueAxis = { min: 50 };
    const result = admitMarkdownChartSpec(combo);
    expect(!result.ok && result.diagnostics.some(item => item.path === 'secondaryValueAxis.min')).toBe(true);
  });
});

describe('图表规格准入：上限', () => {
  function wide(seriesCount: number, categoryCount: number) {
    return {
      chartType: 'line',
      categories: Array.from({ length: categoryCount }, (_, index) => `C${index}`),
      series: Array.from({ length: seriesCount }, (_, index) => ({
        name: `S${index}`,
        values: Array.from({ length: categoryCount }, (_, value) => value),
      })),
    };
  }

  it('系列、类目和数据点总数各自有上限', () => {
    const tooManySeries = admitMarkdownChartSpec(wide(21, 2));
    expect(!tooManySeries.ok && tooManySeries.diagnostics.some(item => item.code === 'limit_exceeded' && item.path === 'series')).toBe(true);

    const tooManyCategories = admitMarkdownChartSpec(wide(1, 1001));
    expect(!tooManyCategories.ok && tooManyCategories.diagnostics.some(item => item.path === 'categories')).toBe(true);

    const tooManyPoints = admitMarkdownChartSpec(wide(6, 900));
    expect(!tooManyPoints.ok && tooManyPoints.diagnostics.some(item => /data points/.test(item.message))).toBe(true);

    expect(admitMarkdownChartSpec(wide(5, 1000)).ok).toBe(true);
  });

  it('canonical 文本超过 128 KiB 时拒绝，而不是写入后读不回来', () => {
    const longName = 'x'.repeat(150);
    const heavy = {
      chartType: 'bar',
      categories: Array.from({ length: 1000 }, (_, index) => `${longName}${index}`),
      series: [{ name: 'S', values: Array.from({ length: 1000 }, () => 1) }],
    };
    const result = admitMarkdownChartSpec(heavy);
    expect(!result.ok && result.diagnostics.some(item => item.code === 'limit_exceeded' && item.path === '$')).toBe(true);
  });
});

describe('围栏正文', () => {
  it('只接受严格 JSON，并定位语法错误', () => {
    const result = admitMarkdownChartFenceBody('{\n  "chartType": "bar",\n  categories: []\n}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]).toMatchObject({ code: 'invalid_json', path: '$' });
    expect(result.diagnostics[0].location?.line).toBe(3);
  });

  it.each([
    ['空正文', '   \n'],
    ['YAML', 'chartType: bar\ncategories: [a]'],
    ['JSON5 注释', '{ // c\n "chartType": "bar" }'],
    ['尾随逗号', '{"chartType": "bar",}'],
  ])('拒绝 %s', (_name, body) => {
    const result = admitMarkdownChartFenceBody(body);
    expect(!result.ok && result.diagnostics[0]?.code).toBe('invalid_json');
  });

  it('正文不是对象时指出根类型', () => {
    const result = admitMarkdownChartFenceBody('[1, 2]');
    expect(!result.ok && result.diagnostics[0]?.code).toBe('not_an_object');
  });

  it('异常巨大的正文在解析前被拒绝', () => {
    const result = admitMarkdownChartFenceBody(' '.repeat(1024 * 1024 + 1));
    expect(!result.ok && result.diagnostics[0]?.code).toBe('limit_exceeded');
  });
});

describe('MarkdownChartSpecSchema（持久化节点属性校验）', () => {
  it('同时校验形状与组合规则，并保留诊断路径', () => {
    const spec = cloneFixture('line');
    (spec.series as { values: number[] }[])[0].values.pop();
    const parsed = MarkdownChartSpecSchema.safeParse(spec);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some(issue => issue.path.join('.') === 'series.0.values')).toBe(true);
  });
});
