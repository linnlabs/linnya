import { describe, expect, it } from 'vitest';
import { MARKDOWN_CHART_TYPES, type MarkdownChartType } from '../definitions/markdownChartConstants';
import { admitMarkdownChartFenceBody, admitMarkdownChartSpec } from '../functions/admitMarkdownChartSpec';
import { encodeMarkdownChartFence } from '../functions/serializeMarkdownChartSpec';
import { cloneFixture, markdownChartFixtures } from './markdownChartFixtures';

function canonicalOf(input: unknown): string {
  const result = admitMarkdownChartSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.canonicalText;
}

describe('canonical 文本', () => {
  it('组合图的 canonical 文本逐字符等于方案示例（Agent 读写的稳定形态）', () => {
    expect(canonicalOf(markdownChartFixtures.combo)).toBe([
      '{',
      '  "chartType": "combo",',
      '  "title": "2026 年各季度营收与利润率",',
      '  "categories": ["Q1", "Q2", "Q3", "Q4"],',
      '  "series": [',
      '    { "name": "营收", "values": [120, 132, 101, 134], "chartType": "bar" },',
      '    { "name": "利润率", "values": [0.27, 0.31, 0.25, 0.29], "chartType": "line", "axis": "secondary" }',
      '  ],',
      '  "valueAxis": { "title": "万元", "numberFormat": "#,##0" },',
      '  "secondaryValueAxis": { "title": "利润率", "numberFormat": "0%" }',
      '}',
    ].join('\n'));
  });

  it('每个系列独占一行，便于 edit_file 精确替换其中一个数值', () => {
    const lines = canonicalOf(markdownChartFixtures.line).split('\n');
    expect(lines.filter(line => line.startsWith('    {'))).toHaveLength(2);
    expect(lines.every(line => !line.includes('\r'))).toBe(true);
  });

  it('省略 v1 合同下的默认值与空轴对象', () => {
    const spec = cloneFixture('bar');
    Object.assign(spec, {
      version: 1,
      barDirection: 'vertical',
      stacking: 'none',
      size: 'medium',
      dataLabelContent: 'value',
      categoryAxis: {},
      valueAxis: {},
    });
    const text = canonicalOf(spec);
    for (const omitted of ['version', 'barDirection', 'stacking', 'size', 'dataLabelContent', 'categoryAxis', 'valueAxis']) {
      expect(text, omitted).not.toContain(`"${omitted}"`);
    }

    const combo = cloneFixture('combo');
    (combo.series as Record<string, unknown>[])[0].axis = 'primary';
    (combo.series as Record<string, unknown>[])[1].lineDash = 'solid';
    const comboText = canonicalOf(combo);
    expect(comboText).not.toContain('"axis": "primary"');
    expect(comboText).not.toContain('"lineDash"');
    expect(comboText).toContain('"axis": "secondary"');
  });

  it('保留非默认值与显式的“关闭”，避免与未声明混淆', () => {
    const spec = cloneFixture('line');
    Object.assign(spec, { size: 'large', showDataLabels: false, legendPosition: 'none' });
    const text = canonicalOf(spec);
    expect(text).toContain('"size": "large"');
    expect(text).toContain('"showDataLabels": false');
    expect(text).toContain('"legendPosition": "none"');
  });

  it('-0 规范为 0，颜色规范为大写，数字用最短往返表示', () => {
    const spec = cloneFixture('bar');
    spec.series = [{
      name: 'S',
      values: [-0, 0.1 + 0.2, 1e21],
      color: '#abcdef',
      pointColors: ['#0a0b0c', null, '#FFFFFF'],
    }];
    const text = canonicalOf(spec);
    expect(text).toContain('"values": [0, 0.30000000000000004, 1e+21]');
    expect(text).toContain('"color": "#ABCDEF"');
    expect(text).toContain('"pointColors": ["#0A0B0C", null, "#FFFFFF"]');
  });

  it('字段输入顺序不影响 canonical 文本', () => {
    for (const type of MARKDOWN_CHART_TYPES) {
      const original = markdownChartFixtures[type];
      const reversed = reverseKeys(original);
      expect(canonicalOf(reversed), type).toBe(canonicalOf(original));
    }
  });

  it('等价的非规范输入（缩进、键序、显式默认）与规范输入得到同一文本', () => {
    const loose = admitMarkdownChartFenceBody(`{ "size":"medium","series":[{"values":[1,2,3],"name":"A"}],
      "categories":["x","y","z"], "chartType":"bar", "stacking":"none" }`);
    const tight = admitMarkdownChartFenceBody('{"chartType":"bar","categories":["x","y","z"],"series":[{"name":"A","values":[1,2,3]}]}');
    expect(loose.ok && tight.ok && loose.canonicalText).toBe(tight.ok && tight.canonicalText);
  });
});

describe('围栏编码', () => {
  it('使用 linnya-chart 语言，正文即 canonical 文本', () => {
    const result = admitMarkdownChartSpec(markdownChartFixtures.pie);
    if (!result.ok) throw new Error('fixture must admit');
    expect(encodeMarkdownChartFence(result.spec)).toBe(`\`\`\`linnya-chart\n${result.canonicalText}\n\`\`\``);
  });

  it('正文含反引号时选择更长的 delimiter，围栏不会被提前闭合', () => {
    const spec = cloneFixture('bar');
    spec.title = '含 ``` 与 ```` 的标题 `x`';
    const result = admitMarkdownChartSpec(spec);
    if (!result.ok) throw new Error('fixture must admit');
    const fence = encodeMarkdownChartFence(result.spec);
    const delimiter = /^`+/.exec(fence)?.[0] ?? '';
    const longestRun = Math.max(...(result.canonicalText.match(/`+/g) ?? ['']).map(run => run.length));
    expect(delimiter.length).toBe(longestRun + 1);
    expect(fence.endsWith(`\n${delimiter}`)).toBe(true);
  });
});

describe('canonical 往返的幂等性', () => {
  it('确定性随机规格：准入 → canonical → 再准入 → canonical 字节不变', () => {
    const random = createRandom(20261022);
    let checked = 0;
    for (let round = 0; round < 40; round += 1) {
      for (const type of MARKDOWN_CHART_TYPES) {
        const generated = generateSpec(type, random);
        const first = admitMarkdownChartSpec(generated);
        if (!first.ok) throw new Error(`${type} round ${round}: ${JSON.stringify(first.diagnostics)}\n${JSON.stringify(generated)}`);

        const second = admitMarkdownChartFenceBody(first.canonicalText);
        expect(second.ok && second.canonicalText, `${type} round ${round}`).toBe(first.canonicalText);
        expect(second.ok && second.spec).toEqual(first.spec);

        const shuffled = admitMarkdownChartSpec(shuffleKeys(generated, random));
        expect(shuffled.ok && shuffled.canonicalText, `${type} round ${round} shuffled`).toBe(first.canonicalText);
        checked += 1;
      }
    }
    expect(checked).toBe(40 * MARKDOWN_CHART_TYPES.length);
  });
});

// ---------- 测试辅助：确定性随机规格 ----------

type Random = () => number;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const between = (random: Random, min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const chance = (random: Random, probability: number) => random() < probability;

const LABELS = ['北京', 'Q1 2026', 'a "quoted" b', 'back\\slash', '`tick`', '```', 'emoji 😀', '<b>&amp;</b>', '  spaced  ', 'ÄÖÜ', '100%'];

function numbers(random: Random, count: number, options: { min?: number; max?: number } = {}): number[] {
  const min = options.min ?? -50;
  const max = options.max ?? 200;
  return Array.from({ length: count }, () => {
    const kind = random();
    if (kind < 0.05) return -0;
    if (kind < 0.1) return pick(random, [1e-7, 0.1 + 0.2, 0.5, 12.25]);
    return Math.round((min + random() * (max - min)) * 100) / 100;
  });
}

function labelList(random: Random, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${pick(random, LABELS)}#${index}`);
}

function hex(random: Random): string {
  return `#${Array.from({ length: 6 }, () => pick(random, '0123456789abcdefABCDEF'.split(''))).join('')}`;
}

function generateSpec(type: MarkdownChartType, random: Random): Record<string, Json> {
  const count = type === 'radar' ? between(random, 3, 6) : between(random, 2, 8);
  const common: Record<string, Json> = { chartType: type };
  if (chance(random, 0.6)) common.title = pick(random, LABELS);
  if (chance(random, 0.4)) common.description = pick(random, LABELS);
  if (chance(random, 0.3)) common.size = pick(random, ['small', 'medium', 'large']);
  if (chance(random, 0.3)) common.legendPosition = pick(random, ['top', 'bottom', 'left', 'right', 'none']);

  const seriesCount = type === 'pie' || type === 'doughnut' ? 1 : type === 'combo' ? between(random, 2, 4) : between(random, 1, 4);
  const series: Json[] = Array.from({ length: seriesCount }, (_, index) => {
    const item: Record<string, Json> = { name: `${pick(random, LABELS)} S${index}`, values: [] };
    if (type === 'pie' || type === 'doughnut') item.values = numbers(random, count, { min: 0, max: 100 }).map(Math.abs).map(value => value + 1);
    else if (type === 'radar') item.values = numbers(random, count, { min: 0, max: 100 }).map(Math.abs);
    else item.values = numbers(random, count);
    if (type !== 'pie' && type !== 'doughnut' && chance(random, 0.4)) item.color = hex(random);
    if ((type === 'pie' || type === 'doughnut' || type === 'bar') && chance(random, 0.3)) {
      item.pointColors = Array.from({ length: count }, () => (chance(random, 0.5) ? hex(random) : null));
    }
    if (type === 'line' && chance(random, 0.4)) item.lineDash = pick(random, ['solid', 'dash', 'dot']);
    if ((type === 'line' || type === 'scatter') && chance(random, 0.4)) item.marker = pick(random, ['none', 'circle', 'square', 'diamond', 'triangle']);
    if (type === 'combo') {
      item.chartType = index === 0 ? 'bar' : pick(random, ['bar', 'line', 'area']);
      if (index > 0 && chance(random, 0.5)) item.axis = 'secondary';
      if (item.chartType === 'line' && chance(random, 0.4)) item.lineDash = pick(random, ['solid', 'dash', 'dot']);
      if (item.chartType === 'bar' && chance(random, 0.3)) item.pointColors = Array.from({ length: count }, () => (chance(random, 0.5) ? hex(random) : null));
      if (item.chartType !== 'bar') {
        const hasPointColors = 'pointColors' in item;
        if (hasPointColors) delete item.pointColors;
      }
    }
    return item;
  });

  const spec: Record<string, Json> = { ...common, series };
  spec.categories = type === 'scatter'
    ? numbers(random, count, { min: -10, max: 100 })
    : type === 'radar'
      ? labelList(random, count)
      : chance(random, 0.7) ? labelList(random, count) : numbers(random, count);

  if (type === 'scatter' && chance(random, 0.5)) spec.pointLabels = labelList(random, count);
  if (type === 'radar') spec.radarScale = { min: 0, max: between(random, 100, 500) };
  if (type === 'bar') {
    if (chance(random, 0.5)) spec.barDirection = pick(random, ['vertical', 'horizontal']);
    if (chance(random, 0.4)) spec.stacking = 'stacked';
  }
  if (type === 'combo') {
    const hasSecondary = series.some(item => typeof item === 'object' && item !== null && !Array.isArray(item) && item.axis === 'secondary');
    if (hasSecondary) spec.secondaryValueAxis = { title: pick(random, LABELS), numberFormat: pick(random, ['0%', '#,##0', '0.0']) };
    if (series.every(item => typeof item === 'object' && item !== null && !Array.isArray(item) && item.axis === 'secondary')) {
      // 至少保留一个主轴系列
      const first = series[0];
      if (typeof first === 'object' && first !== null && !Array.isArray(first)) delete first.axis;
    }
  }
  if (type === 'bar' || type === 'line' || type === 'area' || type === 'combo') {
    if (chance(random, 0.5)) spec.categoryAxis = { title: pick(random, LABELS), labelRotation: between(random, -90, 90) };
    if (chance(random, 0.5)) spec.valueAxis = { title: pick(random, LABELS), numberFormat: pick(random, ['General', '0.0', '#,##0', '0.0%']), showGridlines: chance(random, 0.5) };
    if (chance(random, 0.3)) spec.showDataLabels = chance(random, 0.5);
  }
  if (type === 'scatter') {
    if (chance(random, 0.5)) spec.xAxis = { title: pick(random, LABELS), min: -20, max: 200 };
    if (chance(random, 0.5)) spec.valueAxis = { title: pick(random, LABELS) };
  }
  if (type === 'pie' || type === 'doughnut') {
    if (chance(random, 0.5)) spec.dataLabelContent = pick(random, ['value', 'percentage', 'category']);
  }
  return spec;
}

function shuffleKeys(value: Json, random: Random): Json {
  if (Array.isArray(value)) return value.map(item => shuffleKeys(item, random));
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value);
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [entries[index], entries[swap]] = [entries[swap] as [string, Json], entries[index] as [string, Json]];
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, shuffleKeys(item, random)]));
}

function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) as T;
}
