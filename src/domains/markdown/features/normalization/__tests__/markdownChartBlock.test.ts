import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_CHART_TYPES,
  MarkdownChartSpecInvalidError,
  admitMarkdownChartSpec,
  encodeMarkdownChartFence,
  type MarkdownChartType,
} from '@app/schemas';
import { importMarkdownToDocJson } from '../importMarkdownToDocJson';
import { planMarkdownBlocks } from '../markdownBlockPlanner';
import { serializeRootBlockToMarkdown } from '../markdownJsonSerializer';
import { validateMarkdownDocJson, workspaceMarkdownSchemaContract } from '../schemaLite';
import type { MarkdownDocJson, ProseMirrorJsonNode } from '../types';
import { flattenMarkdownDocumentBlocks, serializeMarkdownBlocks } from '../../../shared/markdownBlockProjection';

const specs: Record<MarkdownChartType, Record<string, unknown>> = {
  bar: {
    chartType: 'bar', title: '各城市销量', categories: ['北京', '上海', '广州'],
    series: [{ name: '2025', values: [12, 20.5, 8] }], barDirection: 'horizontal',
    valueAxis: { title: '万件', numberFormat: '#,##0.0' },
  },
  line: {
    chartType: 'line', categories: ['Q1', 'Q2', 'Q3'],
    series: [{ name: '营收', values: [120, 132, 101], marker: 'circle' }, { name: '成本', values: [80, 90, 85], lineDash: 'dash' }],
  },
  area: { chartType: 'area', categories: ['2022', '2023'], series: [{ name: '用户数', values: [10, 18] }], valueAxis: { min: 0 } },
  pie: { chartType: 'pie', categories: ['订阅', '广告'], series: [{ name: '占比', values: [60, 40] }], dataLabelContent: 'percentage' },
  doughnut: { chartType: 'doughnut', categories: ['A', 'B'], series: [{ name: '份额', values: [3, 1], pointColors: ['#1F6FEB', null] }] },
  scatter: {
    chartType: 'scatter', categories: [1, 2, 10], series: [{ name: '样本', values: [3, 5, 21] }],
    pointLabels: ['甲', '乙', '丙'], xAxis: { title: '投入' }, valueAxis: { title: '专利' },
  },
  radar: {
    chartType: 'radar', categories: ['性能', '成本', '体验'], series: [{ name: '方案甲', values: [80, 60, 70] }],
    radarScale: { min: 0, max: 100 },
  },
  combo: {
    chartType: 'combo', categories: ['Q1', 'Q2'],
    series: [{ name: '营收', values: [120, 132], chartType: 'bar' }, { name: '利润率', values: [0.27, 0.31], chartType: 'line', axis: 'secondary' }],
    secondaryValueAxis: { numberFormat: '0%' },
  },
};

function fenceOf(spec: Record<string, unknown>): string {
  const result = admitMarkdownChartSpec(spec);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return encodeMarkdownChartFence(result.spec);
}

function project(doc: MarkdownDocJson): string {
  return serializeMarkdownBlocks(flattenMarkdownDocumentBlocks(doc));
}

function semantics(node: ProseMirrorJsonNode): unknown {
  return {
    type: node.type,
    text: node.text,
    attrs: node.attrs && Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'id')),
    content: node.content?.map(semantics),
  };
}

function chartOf(doc: MarkdownDocJson | null, index = 0): ProseMirrorJsonNode {
  const inner = doc?.content[index]?.content?.[0];
  if (!inner) throw new Error('missing block');
  return inner;
}

describe('chartBlock：围栏导入与 canonical 投影（真实 Node WASM parser）', () => {
  it.each(MARKDOWN_CHART_TYPES)('%s：导入为 chartBlock，投影回同一 canonical 围栏且再导入语义不变', async type => {
    const fence = fenceOf(specs[type]);
    const markdown = `前文\n\n${fence}\n\n后文`;

    const first = (await importMarkdownToDocJson(markdown)).docJson;
    expect(first?.content.map(root => root.content?.[0]?.type)).toEqual(['baseBlock', 'chartBlock', 'baseBlock']);
    const chart = chartOf(first, 1);
    expect(chart.attrs).toMatchObject({ blockType: 'chart', spec: expect.objectContaining({ chartType: type }) });
    expect(typeof chart.attrs?.id).toBe('string');

    const output = project(first as MarkdownDocJson);
    expect(output).toBe(markdown);

    const second = (await importMarkdownToDocJson(output)).docJson;
    expect(second && semantics(second)).toEqual(first && semantics(first));
    expect(second && project(second)).toBe(output);
  });

  it('非规范输入（键序、缩进、显式默认值）导入后得到规范 spec 与规范投影', async () => {
    const loose = '```linnya-chart\n{ "size":"medium", "series":[{"values":[1,2],"name":"A"}],\n  "categories":["x","y"], "chartType":"bar", "stacking":"none" }\n```';
    const imported = (await importMarkdownToDocJson(loose)).docJson;
    expect(chartOf(imported).attrs?.spec).toEqual({
      chartType: 'bar', categories: ['x', 'y'], series: [{ name: 'A', values: [1, 2] }],
    });
    expect(imported && project(imported)).toBe(
      '```linnya-chart\n{\n  "chartType": "bar",\n  "categories": ["x", "y"],\n  "series": [\n    { "name": "A", "values": [1, 2] }\n  ]\n}\n```',
    );
  });

  it('标题含围栏字符时 delimiter 自动加长，真实 parser 仍能无损读回', async () => {
    const fence = fenceOf({ ...specs.bar, title: '含 ``` 与 ```` 的标题' });
    expect(fence.startsWith('`````linnya-chart\n')).toBe(true);
    const imported = (await importMarkdownToDocJson(fence)).docJson;
    expect(chartOf(imported).attrs?.spec).toMatchObject({ title: '含 ``` 与 ```` 的标题' });
    expect(imported && project(imported)).toBe(fence);
  });

  it('EOF 结束的合法围栏沿用 parser 合同被接纳', async () => {
    const imported = (await importMarkdownToDocJson('```linnya-chart\n{"chartType":"pie","categories":["a"],"series":[{"name":"s","values":[1]}]}')).docJson;
    expect(chartOf(imported).type).toBe('chartBlock');
  });

  it('chart 之后的普通 comment 作为批注绑定到图表块', async () => {
    const markdown = `${fenceOf(specs.bar)}\n\n<!-- 这张图的口径需要核对 -->`;
    const imported = (await importMarkdownToDocJson(markdown)).docJson;
    expect(imported?.content).toHaveLength(1);
    expect(imported?.content[0]?.attrs?.annotations).toEqual([
      expect.objectContaining({ content: '这张图的口径需要核对' }),
    ]);
    expect(imported && project(imported)).toContain('这张图的口径需要核对');
    expect(imported && project(imported)).toContain('```linnya-chart');
  });
});

describe('chartBlock：无效专属围栏统一拒绝', () => {
  async function rejectedWith(markdown: string): Promise<MarkdownChartSpecInvalidError> {
    try {
      await importMarkdownToDocJson(markdown);
    } catch (error) {
      if (error instanceof MarkdownChartSpecInvalidError) return error;
      throw error;
    }
    throw new Error('expected the import to be rejected');
  }

  it('整体失败，诊断带围栏序号、块序号和字段路径，且文案可直接指导修复', async () => {
    const good = fenceOf(specs.bar);
    const bad = '```linnya-chart\n{"chartType":"line","categories":["a","b"],"series":[{"name":"s","values":[1]}]}\n```';
    const error = await rejectedWith(`# 标题\n\n${good}\n\n${bad}\n\n结尾`);

    expect(error.code).toBe('MARKDOWN_CHART_SPEC_INVALID');
    expect(error.context).toEqual({ chartOrdinal: 2, blockIndex: 3 });
    expect(error.diagnostics).toEqual([expect.objectContaining({ code: 'length_mismatch', path: 'series[0].values' })]);
    expect(error.message).toContain('#2, block 3');
    expect(error.message).toContain('series[0].values');
    expect(error.message).toContain('No change was committed');
  });

  it.each([
    ['JSON 语法错误', '```linnya-chart\n{ "chartType": "bar", }\n```', 'invalid_json'],
    ['YAML', '```linnya-chart\nchartType: bar\n```', 'invalid_json'],
    ['空围栏', '```linnya-chart\n```', 'invalid_json'],
    ['数组根', '```linnya-chart\n[1, 2]\n```', 'not_an_object'],
    ['未知字段', '```linnya-chart\n{"chartType":"bar","categories":["a"],"series":[{"name":"s","values":[1]}],"echartsOption":{}}\n```', 'unknown_field'],
  ])('%s', async (_name, markdown, code) => {
    const error = await rejectedWith(markdown);
    expect(error.diagnostics[0]?.code).toBe(code);
  });

  it('planMarkdownBlocks（file-style 写入的第一步）同样在对齐身份之前整体失败', async () => {
    await expect(planMarkdownBlocks('正文\n\n```linnya-chart\n{}\n```')).rejects.toBeInstanceOf(MarkdownChartSpecInvalidError);
  });
});

describe('普通代码保真：只有 linnya-chart 是专属语言', () => {
  const chartYaml = 'type: bar\ndata:\n  labels: [a, b]\n';

  it.each(['chart', 'echarts', 'json', 'yaml', 'linnya-chart-draft', 'LINNYA-CHART', 'mermaid', ''])(
    '语言 %j 保持普通 codeBlock，正文逐字不变，不触发图表校验',
    async language => {
      const markdown = `\`\`\`${language}\n${chartYaml}\n\`\`\``;
      const imported = (await importMarkdownToDocJson(markdown)).docJson;
      const code = chartOf(imported);
      expect(code.type).toBe('codeBlock');
      expect(code.attrs?.language).toBe(language);
      expect(code.content?.[0]?.text).toBe(`${chartYaml}`);
      expect(imported && project(imported)).toBe(markdown);
    },
  );

  it('与合法图表混排时，图表和普通代码块各自按语义处理', async () => {
    const markdown = `${fenceOf(specs.pie)}\n\n\`\`\`json\n{"chartType": "pie"}\n\`\`\``;
    const imported = (await importMarkdownToDocJson(markdown)).docJson;
    expect(imported?.content.map(root => root.content?.[0]?.type)).toEqual(['chartBlock', 'codeBlock']);
    expect(imported && project(imported)).toBe(markdown);
  });
});

describe('chartBlock：持久化 schema 闸门', () => {
  const root = (inner: ProseMirrorJsonNode): MarkdownDocJson => ({
    type: 'doc',
    content: [{ type: 'rootBlock', attrs: { id: 'root-1' }, content: [inner] }],
  });
  const validSpec = admitMarkdownChartSpec(specs.bar);
  if (!validSpec.ok) throw new Error('fixture must admit');

  it('合同把 chartBlock 暴露给 Editor conformance：属性集合固定为 blockType、id、spec', () => {
    expect(workspaceMarkdownSchemaContract.nodes.chartBlock).toEqual(['blockType', 'id', 'spec']);
  });

  it('接纳合法 chartBlock 并原样保留 spec', () => {
    const doc = root({ type: 'chartBlock', attrs: { id: 'chart-1', blockType: 'chart', spec: validSpec.spec } });
    expect(chartOf(validateMarkdownDocJson(doc)).attrs?.spec).toEqual(validSpec.spec);
  });

  it.each([
    ['缺少 spec', { id: 'chart-1', blockType: 'chart' }],
    ['spec 不满足图表规则', { id: 'chart-1', blockType: 'chart', spec: { ...specs.bar, series: [{ name: 's', values: [1] }] } }],
    ['spec 含未知字段', { id: 'chart-1', blockType: 'chart', spec: { ...specs.bar, echartsOption: {} } }],
    ['节点带未登记属性', { id: 'chart-1', blockType: 'chart', spec: validSpec.spec, width: 300 }],
  ])('拒绝 chartBlock：%s', (_name, attrs) => {
    expect(() => validateMarkdownDocJson(root({ type: 'chartBlock', attrs })), JSON.stringify(attrs)).toThrow();
  });

  it('专属语言不能以普通代码的形态留在正文中', () => {
    const doc = root({
      type: 'codeBlock',
      attrs: { id: 'code-1', blockType: 'code', language: 'linnya-chart' },
      content: [{ type: 'text', text: '{}' }],
    });
    expect(() => validateMarkdownDocJson(doc)).toThrow(/reserved for chartBlock/);

    const ordinary = root({
      type: 'codeBlock',
      attrs: { id: 'code-1', blockType: 'code', language: 'chart' },
      content: [{ type: 'text', text: '{}' }],
    });
    expect(() => validateMarkdownDocJson(ordinary)).not.toThrow();
  });

  it('chartBlock 是 atom，不能携带内容', () => {
    const doc = root({
      type: 'chartBlock',
      attrs: { id: 'chart-1', blockType: 'chart', spec: validSpec.spec },
      content: [{ type: 'text', text: 'x' }],
    });
    expect(() => validateMarkdownDocJson(doc)).toThrow();
  });
});

describe('chartBlock：序列化器', () => {
  it('投影只依赖 spec，且对非 canonical 的已存 spec 也输出 canonical 文本', () => {
    const text = serializeRootBlockToMarkdown({
      type: 'rootBlock',
      content: [{
        type: 'chartBlock',
        attrs: {
          id: 'c', blockType: 'chart',
          spec: { chartType: 'bar', size: 'medium', stacking: 'none', categories: ['a'], series: [{ name: 's', values: [-0], color: '#abcdef' }] },
        },
      }],
    });
    expect(text).toBe([
      '```linnya-chart',
      '{',
      '  "chartType": "bar",',
      '  "categories": ["a"],',
      '  "series": [',
      '    { "name": "s", "values": [0], "color": "#ABCDEF" }',
      '  ]',
      '}',
      '```',
    ].join('\n'));
  });

  it('已存 spec 损坏时失败，而不是输出空块掩盖数据问题', () => {
    expect(() => serializeRootBlockToMarkdown({
      type: 'rootBlock',
      content: [{ type: 'chartBlock', attrs: { id: 'c', blockType: 'chart', spec: { chartType: 'bar' } } }],
    })).toThrow();
  });
});

describe('planMarkdownBlocks：图表块与 file-style 写入规划', () => {
  it('canonical 块列表幂等，图表作为一个独立块参与对齐', async () => {
    const markdown = `第一段\n\n${fenceOf(specs.line)}\n\n第三段`;
    const first = await planMarkdownBlocks(markdown);
    expect(first.blocks).toHaveLength(3);
    expect(first.blocks[1]).toBe(fenceOf(specs.line));
    expect(first.text).toBe(markdown);

    const second = await planMarkdownBlocks(first.text);
    expect(second.blocks).toEqual(first.blocks);
  });

  it('等价的格式变化规划为同一文本，不会制造修订', async () => {
    const compact = '```linnya-chart\n{"chartType":"pie","categories":["a","b"],"series":[{"name":"s","values":[1,2]}],"size":"medium"}\n```';
    const spaced = '```linnya-chart\n{\n    "series": [ { "values": [1, 2], "name": "s" } ],\n    "categories": ["a", "b"],\n    "chartType": "pie"\n}\n```';
    const [a, b] = await Promise.all([planMarkdownBlocks(compact), planMarkdownBlocks(spaced)]);
    expect(a.blocks).toEqual(b.blocks);
  });
});
