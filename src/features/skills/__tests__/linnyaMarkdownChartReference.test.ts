import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_CHART_LIMITS,
  MARKDOWN_CHART_PALETTES,
  MARKDOWN_CHART_SERIES_FIELD_NAMES,
  MARKDOWN_CHART_SPEC_FIELD_NAMES,
  MARKDOWN_CHART_TYPES,
  admitMarkdownChartFenceBody,
} from '@app/schemas';
import { importMarkdownToDocJson } from '../../../domains/markdown/features/normalization/importMarkdownToDocJson';

/**
 * 内置 Skill `linnya-markdown` 的图表参考页是 Agent 写图表的唯一语法说明。
 * 这些测试让文档与真实合同保持同步：示例必须被真实准入且已是 canonical 形态，
 * 字段表不能漏掉合同里的字段，上限数字不能漂移。
 */
const reference = readFileSync(
  fileURLToPath(new URL('../builtin/skills/linnya-markdown/references/chart.md', import.meta.url)),
  'utf8',
);
const skill = readFileSync(
  fileURLToPath(new URL('../builtin/skills/linnya-markdown/SKILL.md', import.meta.url)),
  'utf8',
);

interface Example {
  readonly type: string;
  readonly body: string;
}

function readExamples(): Example[] {
  const pattern = /### (\w+)\n\n````markdown\n```linnya-chart\n([\s\S]*?)\n```\n````/g;
  return [...reference.matchAll(pattern)].flatMap(match => (match[1] && match[2] ? [{ type: match[1], body: match[2] }] : []));
}

describe('linnya-markdown 图表参考页', () => {
  const examples = readExamples();

  it('八种图表各有一个示例', () => {
    expect(examples.map(example => example.type)).toEqual([...MARKDOWN_CHART_TYPES]);
  });

  it.each(examples)('$type 示例通过真实准入，且已经是 canonical 文本（Agent 回读时看到的就是它）', ({ type, body }) => {
    const admission = admitMarkdownChartFenceBody(body);
    if (!admission.ok) throw new Error(`${type}: ${JSON.stringify(admission.diagnostics)}`);

    expect(admission.spec.chartType).toBe(type);
    expect(admission.canonicalText).toBe(body);
  });

  it.each(examples)('$type 示例作为完整围栏经真实 parser 导入为图表块', async ({ type, body }) => {
    const imported = (await importMarkdownToDocJson(`\`\`\`linnya-chart\n${body}\n\`\`\``)).docJson;
    const inner = imported?.content[0]?.content?.[0];

    expect(inner?.type).toBe('chartBlock');
    expect(inner?.attrs).toMatchObject({ spec: expect.objectContaining({ chartType: type }) });
  });

  it('字段表覆盖合同里的每个顶层字段和系列字段', () => {
    for (const field of [...MARKDOWN_CHART_SPEC_FIELD_NAMES, ...MARKDOWN_CHART_SERIES_FIELD_NAMES]) {
      expect(reference, `参考页缺少字段 ${field}`).toContain(`\`${field}\``);
    }
  });

  it('颜色指引列出合同里的每个色系名', () => {
    for (const palette of MARKDOWN_CHART_PALETTES) {
      expect(reference, `参考页缺少色系 ${palette}`).toContain(`\`${palette}\``);
    }
  });

  it('颜色指引的强调示例通过真实准入，且已经是 canonical 文本', () => {
    const body = /### Emphasis example\n\n````markdown\n```linnya-chart\n([\s\S]*?)\n```\n````/.exec(reference)?.[1];
    if (body === undefined) throw new Error('参考页缺少强调示例');
    const admission = admitMarkdownChartFenceBody(body);
    if (!admission.ok) throw new Error(JSON.stringify(admission.diagnostics));
    expect(admission.canonicalText).toBe(body);
  });

  it('常用柱图变体示例通过真实准入、canonical 回读与 parser 导入', async () => {
    const section = reference.slice(reference.indexOf('## Common bar variants'));
    const bodies = [...section.matchAll(/```linnya-chart\n([\s\S]*?)\n```/g)].map(match => match[1]);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      if (!body) throw new Error('Missing chart example');
      const admitted = admitMarkdownChartFenceBody(body);
      if (!admitted.ok) throw new Error(JSON.stringify(admitted.diagnostics));
      expect(admitted.canonicalText).toBe(body);
      const imported = await importMarkdownToDocJson(`\`\`\`linnya-chart\n${body}\n\`\`\``);
      expect(imported.docJson?.content[0]?.content?.[0]?.attrs?.spec).toEqual(admitted.spec);
    }
  });

  it('上限数字与合同一致', () => {
    expect(reference).toContain(`At most ${MARKDOWN_CHART_LIMITS.maxSeries} series, ${MARKDOWN_CHART_LIMITS.maxCategories} categories, ${MARKDOWN_CHART_LIMITS.maxDataPoints} data points`);
    expect(reference).toContain(`${MARKDOWN_CHART_LIMITS.maxCanonicalBytes / 1024} KiB`);
    expect(reference).toContain(`Title up to ${MARKDOWN_CHART_LIMITS.maxTitleLength} characters, description up to ${MARKDOWN_CHART_LIMITS.maxDescriptionLength}`);
  });

  it('SKILL.md 指向参考页，并说明只有 linnya-chart 是图表', () => {
    expect(skill).toContain('references/chart.md');
    expect(skill).toContain('`linnya-chart`');
    expect(skill).toContain('`chart`, `echarts` and `json` fences stay ordinary code');
  });
});
