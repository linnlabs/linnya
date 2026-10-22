import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARKDOWN_CHART_SPEC_FIELD_NAMES, MARKDOWN_CHART_TYPES } from '@app/schemas';

/**
 * Deep Research 只提供选图与证据纪律：图表语法的 owner 是 linnya-markdown。
 * 这里固定“入口存在、指向正确 owner、没有复制一套 schema 或示例合同”。
 */
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../builtin/skills/${relative}`, import.meta.url)), 'utf8');
}

const entry = read('deep-research/SKILL.md');
const charts = read('deep-research/references/charts.md');

describe('Deep Research 图表入口', () => {
  it('SKILL.md 把图表需求指向 charts.md，并声明按需读取', () => {
    expect(entry).toContain('references/charts.md');
  });

  it('charts.md 指向 linnya-markdown 的语法参考页', () => {
    expect(charts).toContain('linnya-markdown');
    expect(charts).toContain('references/chart.md');
  });

  it('charts.md 覆盖全部八种图表类型的选择指引', () => {
    for (const type of MARKDOWN_CHART_TYPES) {
      expect(charts, `缺少图表类型 ${type}`).toContain(`\`${type}\``);
    }
  });

  it('charts.md 不复制语法：没有图表围栏、没有 JSON 规格，也不罗列 schema 字段', () => {
    expect(charts).not.toContain('```');
    expect(charts).not.toContain('"chartType"');
    const schemaOnlyFields = [...MARKDOWN_CHART_SPEC_FIELD_NAMES].filter(
      field => !['chartType'].includes(field) && !MARKDOWN_CHART_TYPES.some(type => type === field),
    );
    const mentioned = schemaOnlyFields.filter(field => new RegExp(`\`${field}\``).test(charts));
    // 允许提及少数调用方需要知道的字段名（如 pointLabels），但不能把字段表搬进来。
    expect(mentioned.length).toBeLessThanOrEqual(2);
  });
});
