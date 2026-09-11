/**
 * AestheticLint 单元测试
 */
import { describe, expect, it } from 'vitest';import { AestheticLint } from '../engine/quality/AestheticLint.js';
import type {
  PresentationInfo,
  SlideElementInfo,
  TextFontResolutionKind,
  TextFontScript,
} from '@plugin/slides/shared';

const lint = new AestheticLint();

function makeInfo(overrides?: Partial<PresentationInfo>): PresentationInfo {
  return {
    slideCount: 1,
    slideSize: { width: 10, height: 5.625 },
    slides: [
      {
        number: 1,
        elements: [
          {
            name: 'Title',
            type: 'text',
            text: 'Slide Title',
            position: { x: 0.7, y: 0.45, w: 5.4, h: 0.65 },
          },
          {
            name: 'Body',
            type: 'text',
            text: 'Body content here',
            position: { x: 0.7, y: 1.5, w: 8.6, h: 3.0 },
          },
          {
            name: 'Footer',
            type: 'text',
            text: 'Source: internal',
            position: { x: 0.7, y: 5.0, w: 4.5, h: 0.35 },
          },
        ],
      },
    ],
    theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
    masters: [],
    ...overrides,
  };
}

function makeResolvedFontText(options: {
  name: string;
  text: string;
  declaredFamily: string;
  resolvedFamily?: string;
  script?: TextFontScript;
  resolution?: TextFontResolutionKind;
  runs?: NonNullable<SlideElementInfo['paragraphs']>[number]['runs'];
}): SlideElementInfo {
  return {
    name: options.name,
    type: 'text',
    text: options.text,
    position: { x: 1, y: 1, w: 7, h: 0.6 },
    paragraphs: [{
      runs: options.runs ?? [{
        text: options.text,
        fontFamily: options.declaredFamily,
        resolvedFontFamily: options.resolvedFamily ?? options.declaredFamily,
        fontScript: options.script ?? 'latin',
        fontResolution: options.resolution ?? 'exact',
      }],
    }],
  };
}

function makeChartElement(options: {
  chartType: NonNullable<SlideElementInfo['chartInfo']>['chartType'];
  categories: string[];
  seriesNames?: string[];
  width?: number;
  height?: number;
  legendVisible?: boolean;
  dataLabelsVisible?: boolean;
  dataLabelPosition?: 'inside' | 'outside' | 'center';
  categoryAxisVisible?: boolean;
  fontSizePt?: number;
}): SlideElementInfo {
  const fontSizePt = options.fontSizePt ?? 8;
  return {
    name: 'Chart',
    nodeId: 'chart-1',
    type: 'chart',
    position: { x: 1, y: 1, w: options.width ?? 6, h: options.height ?? 3 },
    chartInfo: {
      chartType: options.chartType,
      categoryLabels: options.categories,
      seriesNames: options.seriesNames ?? ['Series 1'],
      legend: {
        visible: options.legendVisible ?? false,
        position: 'right',
        fontSizePt,
      },
      dataLabels: {
        visible: options.dataLabelsVisible ?? false,
        position: options.dataLabelPosition ?? 'outside',
        fontSizePt,
        includesCategoryName: true,
      },
      categoryAxis: {
        visible: options.categoryAxisVisible ?? true,
        fontSizePt,
      },
    },
  };
}

describe('AestheticLint', () => {
  describe('basic report structure', () => {
    it('returns layout, aesthetic findings and reproducible metrics', () => {
      const report = lint.lint(makeInfo());
      expect(report.layout).toBeDefined();
      expect(report.aesthetic).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report).not.toHaveProperty('score');
    });
  });

  describe('chart readability (P1 standard findings)', () => {
    it('reports a radial chart whose categories have no visible identity channel', () => {
      const chart = makeChartElement({
        chartType: 'doughnut',
        categories: ['执行器', '减速器', '传感器', '电池'],
      });
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements: [chart] }] }));

      const issue = report.aesthetic.find((item) => item.code === 'chart_identity_missing');
      expect(issue).toMatchObject({
        severity: 'warning',
        confidence: 'medium',
        evidence: {
          assessment: 'identity_missing',
          missingIdentity: 'categories',
          unidentifiedLabelCount: 4,
        },
      });
    });

    it('reports a multi-series chart without a legend but accepts a single-series chart', () => {
      const multiple = makeChartElement({
        chartType: 'line',
        categories: ['2024', '2025', '2026E'],
        seriesNames: ['收入', '利润'],
        width: 8,
      });
      const single = makeChartElement({
        chartType: 'line',
        categories: ['2024', '2025', '2026E'],
        seriesNames: ['收入'],
        width: 8,
      });

      const multipleReport = lint.lint(makeInfo({ slides: [{ number: 1, elements: [multiple] }] }));
      const singleReport = lint.lint(makeInfo({ slides: [{ number: 1, elements: [single] }] }));

      expect(multipleReport.aesthetic.find((item) => item.code === 'chart_identity_missing'))
        .toMatchObject({ evidence: { missingIdentity: 'series' } });
      expect(singleReport.aesthetic.find((item) => item.code === 'chart_identity_missing'))
        .toBeUndefined();
    });

    it('reports clearly crowded outside doughnut labels with capacity evidence', () => {
      const chart = makeChartElement({
        chartType: 'doughnut',
        categories: Array.from({ length: 12 }, (_, index) => `部件${index + 1}`),
        dataLabelsVisible: true,
        dataLabelPosition: 'outside',
        height: 0.7,
        fontSizePt: 10,
      });
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements: [chart] }] }));

      const issue = report.aesthetic.find((item) => item.code === 'chart_label_capacity_exceeded');
      expect(issue).toMatchObject({
        severity: 'warning',
        confidence: 'medium',
        evidence: {
          assessment: 'label_capacity_exceeded',
          channel: 'data_labels',
          direction: 'vertical',
          labelCount: 12,
        },
      });
    });

    it('reports long category labels in a narrow chart and keeps normal charts quiet', () => {
      const crowded = makeChartElement({
        chartType: 'column',
        categories: ['核心执行器系统', '精密减速器总成', '高性能触觉传感', '电池与热管理'],
        width: 2.4,
      });
      const normal = makeChartElement({
        chartType: 'column',
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        width: 6,
      });

      const crowdedReport = lint.lint(makeInfo({ slides: [{ number: 1, elements: [crowded] }] }));
      const normalReport = lint.lint(makeInfo({ slides: [{ number: 1, elements: [normal] }] }));

      expect(crowdedReport.aesthetic.find((item) => item.code === 'chart_label_capacity_exceeded'))
        .toMatchObject({ evidence: { channel: 'category_axis', direction: 'horizontal' } });
      expect(normalReport.aesthetic.find((item) => item.code === 'chart_label_capacity_exceeded'))
        .toBeUndefined();
    });

    it('does not infer missing chart facts for imported inspection input', () => {
      const importedChart: SlideElementInfo = {
        name: 'Imported chart',
        type: 'chart',
        chartType: 'chart',
        position: { x: 1, y: 1, w: 6, h: 3 },
      };
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements: [importedChart] }] }));

      expect(report.aesthetic.some((item) => (
        item.code === 'chart_identity_missing' || item.code === 'chart_label_capacity_exceeded'
      ))).toBe(false);
    });
  });

  describe('text density', () => {
    it('warns when text covers most of the slide', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'BigText', type: 'text', text: 'A'.repeat(500), position: { x: 0.3, y: 0.3, w: 9.4, h: 5.0 } },
          ],
        }],
      }));
      const dense = report.aesthetic.find((i) => i.code === 'text_too_dense');
      expect(dense).toBeDefined();
      expect(dense!.severity).toBe('warning');
    });

    it('notes when text is very sparse', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'TinyText', type: 'text', text: 'Hi', position: { x: 4, y: 2.5, w: 0.5, h: 0.2 } },
          ],
        }],
      }));
      const sparse = report.aesthetic.find((i) => i.code === 'text_too_sparse');
      expect(sparse).toBeDefined();
      expect(sparse!.severity).toBe('info');
    });
  });

  describe('visual hierarchy', () => {
    it('notes weak hierarchy when all text elements are similar size', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'T1', type: 'text', text: 'Line 1', position: { x: 0.7, y: 1, w: 8, h: 0.5 } },
            { name: 'T2', type: 'text', text: 'Line 2', position: { x: 0.7, y: 1.6, w: 8, h: 0.5 } },
            { name: 'T3', type: 'text', text: 'Line 3', position: { x: 0.7, y: 2.2, w: 8, h: 0.5 } },
          ],
        }],
      }));
      const weak = report.aesthetic.find((i) => i.code === 'weak_hierarchy');
      expect(weak).toBeDefined();
    });

    it('does not flag hierarchy when sizes differ', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Title', type: 'text', text: 'Big', position: { x: 0.7, y: 0.5, w: 8, h: 1.0 } },
            { name: 'Body', type: 'text', text: 'Small', position: { x: 0.7, y: 2, w: 8, h: 0.4 } },
          ],
        }],
      }));
      const weak = report.aesthetic.find((i) => i.code === 'weak_hierarchy');
      expect(weak).toBeUndefined();
    });
  });

  describe('whitespace balance', () => {
    it('notes unbalanced horizontal margins', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Box', type: 'shape', position: { x: 0.5, y: 1, w: 4, h: 3 } },
          ],
        }],
      }));
      const unbalanced = report.aesthetic.find((i) => i.code === 'unbalanced_whitespace');
      expect(unbalanced).toBeDefined();
    });

    it('does not flag centered content', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Box', type: 'shape', position: { x: 2.5, y: 1.5, w: 5, h: 2.5 } },
          ],
        }],
      }));
      const hIssues = report.aesthetic.filter(
        (i) => i.code === 'unbalanced_whitespace' && i.evidence.axis === 'horizontal',
      );
      expect(hIssues).toHaveLength(0);
    });
  });

  describe('element count', () => {
    it('does not warn for typical Scene Graph DSL output (30-40 elements)', () => {
      const elements = Array.from({ length: 36 }, (_, i) => ({
        name: `El${i}`,
        type: 'shape' as const,
        position: { x: 0.5 + (i % 6) * 1.5, y: 0.5 + Math.floor(i / 6) * 0.8, w: 1.2, h: 0.6 },
      }));
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements }] }));
      const tooMany = report.aesthetic.find((i) => i.code === 'too_many_elements');
      expect(tooMany).toBeUndefined();
    });

    it('warns when slide has excessively many elements (>50)', () => {
      const elements = Array.from({ length: 55 }, (_, i) => ({
        name: `El${i}`,
        type: 'shape' as const,
        position: { x: 0.3 + (i % 10) * 0.9, y: 0.3 + Math.floor(i / 10) * 0.9, w: 0.7, h: 0.7 },
      }));
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements }] }));
      const tooMany = report.aesthetic.find((i) => i.code === 'too_many_elements');
      expect(tooMany).toBeDefined();
    });
  });

  describe('visual anchor', () => {
    /**
     * 收紧后的触发条件：必须同时满足
     * 1) 元素 ≥ 6
     * 2) 最大几何元素面积 < 整页 25%
     * 3) 最大文本字号 < 18pt（无字号锚点）
     *
     * 设计意图：均衡布局是合法风格选择（modern minimalist / consulting grids），
     * 不应被识别为缺陷。仅当页面"既无几何锚点也无字号锚点"时才提示。
     */
    it('notes missing visual anchor only when no geometric AND no font-size anchor', () => {
      // 6 个小色块（每个 1×0.5 = 0.5 sqin，远小于 25% × 56.25 = 14 sqin），
      // 全部不带 fontSize → 同时缺 geometric / font 锚点
      const elements = Array.from({ length: 6 }, (_, i) => ({
        name: `Box${i}`,
        type: 'shape' as const,
        position: { x: 0.5 + (i % 3) * 1.5, y: 1 + Math.floor(i / 3) * 1, w: 1, h: 0.5 },
      }));
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements }] }));
      const noAnchor = report.aesthetic.find((i) => i.code === 'missing_visual_anchor');
      expect(noAnchor).toBeDefined();
    });

    it('does not flag balanced 4-card grid (modern minimalist style is legitimate)', () => {
      // 旧规则会误报：4 个等大卡片
      const elements = Array.from({ length: 4 }, (_, i) => ({
        name: `Card${i}`,
        type: 'shape' as const,
        position: { x: 0.5 + i * 2.3, y: 2, w: 2, h: 1.5 },
      }));
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements }] }));
      const noAnchor = report.aesthetic.find((i) => i.code === 'missing_visual_anchor');
      expect(noAnchor).toBeUndefined();
    });

    it('does not flag when one element is dominant', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Big', type: 'shape', position: { x: 0.5, y: 0.5, w: 6, h: 4 } },
            { name: 'Small1', type: 'text', text: 'a', position: { x: 7, y: 1, w: 2, h: 0.5 } },
            { name: 'Small2', type: 'text', text: 'b', position: { x: 7, y: 2, w: 2, h: 0.5 } },
            { name: 'Small3', type: 'text', text: 'c', position: { x: 7, y: 3, w: 2, h: 0.5 } },
          ],
        }],
      }));
      const noAnchor = report.aesthetic.find((i) => i.code === 'missing_visual_anchor');
      expect(noAnchor).toBeUndefined();
    });

    it('does not flag when page has a title-tier text anchor (≥18pt)', () => {
      // 6 个小元素，但其中一个 22pt 的标题作为字号锚点 → 不应报
      const elements: Parameters<typeof lint.lint>[0]['slides'][number]['elements'] = [
        { name: 'Title', type: 'text', text: 'Slide Title', fontSize: 22, position: { x: 0.4, y: 0.5, w: 6, h: 0.5 } },
        ...Array.from({ length: 5 }, (_, i) => ({
          name: `Box${i}`,
          type: 'shape' as const,
          position: { x: 0.5 + (i % 3) * 1.5, y: 2 + Math.floor(i / 3) * 1, w: 1, h: 0.5 },
        })),
      ];
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements }] }));
      const noAnchor = report.aesthetic.find((i) => i.code === 'missing_visual_anchor');
      expect(noAnchor).toBeUndefined();
    });
  });

  describe('slide repetition', () => {
    it('notes when consecutive slides have identical structure', () => {
      const slide = {
        number: 1,
        elements: [
          { name: 'Title', type: 'text' as const, text: 'T', position: { x: 0.7, y: 0.5, w: 8, h: 0.8 } },
          { name: 'Body', type: 'text' as const, text: 'B', position: { x: 0.7, y: 1.5, w: 8, h: 3 } },
        ],
      };
      const report = lint.lint(makeInfo({
        slideCount: 3,
        slides: [
          { ...slide, number: 1 },
          { ...slide, number: 2 },
          { ...slide, number: 3 },
        ],
      }));
      const repetition = report.aesthetic.filter((i) => i.code === 'slide_repetition');
      expect(repetition.length).toBeGreaterThan(0);
      expect(report.metrics.repeatedAdjacentPairs).toBe(2);
      expect(report.metrics.longestRepetitionRun).toBe(3);
      expect(report.metrics.maxAdjacentSimilarity).toBeGreaterThanOrEqual(0.95);
    });

    it('does not flag slides with different structures', () => {
      const report = lint.lint(makeInfo({
        slideCount: 3,
        slides: [
          { number: 1, elements: [{ name: 'T', type: 'text', text: 'A', position: { x: 1, y: 1, w: 8, h: 1 } }] },
          { number: 2, elements: [{ name: 'C', type: 'chart', position: { x: 0.5, y: 0.5, w: 9, h: 4.5 } }] },
          { number: 3, elements: [{ name: 'Tbl', type: 'table', position: { x: 1, y: 1, w: 8, h: 3 } }] },
        ],
      }));
      const repetition = report.aesthetic.filter((i) => i.code === 'slide_repetition');
      expect(repetition).toHaveLength(0);
      expect(report.metrics.repeatedAdjacentPairs).toBe(0);
      expect(report.metrics.maxAdjacentSimilarity).toBe(0);
    });

    it('distinguishes adjacent slides with the same element count but different structures', () => {
      const report = lint.lint(makeInfo({
        slideCount: 2,
        slides: [
          {
            number: 1,
            elements: [
              { name: 'Title', type: 'text', text: 'A', position: { x: 0.7, y: 0.5, w: 8, h: 0.8 } },
              { name: 'Chart', type: 'chart', position: { x: 0.7, y: 1.6, w: 5.8, h: 2.8 } },
              { name: 'Rail', type: 'text', text: 'B', position: { x: 7, y: 1.6, w: 2.1, h: 2.8 } },
            ],
          },
          {
            number: 2,
            elements: [
              { name: 'Title', type: 'text', text: 'A', position: { x: 0.7, y: 0.5, w: 8, h: 0.8 } },
              { name: 'Table', type: 'table', position: { x: 0.7, y: 1.6, w: 8.4, h: 1.6 } },
              { name: 'Footer', type: 'text', text: 'note', position: { x: 0.7, y: 4.9, w: 4, h: 0.3 } },
            ],
          },
        ],
      }));

      expect(report.metrics.maxAdjacentSimilarity).toBeLessThan(0.8);
      expect(report.aesthetic.filter((i) => i.code === 'slide_repetition')).toHaveLength(0);
    });
  });

  describe('font size floor (Tier-1 Rule 2)', () => {
    it('reports font size below 5pt as a warning rather than a build error', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            {
              name: 'Title', type: 'text', text: 'Title',
              position: { x: 0.7, y: 0.5, w: 8, h: 0.8 },
              fontSize: 18,
            },
            {
              name: 'Source', type: 'text', text: '来源：内部',
              position: { x: 0.7, y: 5.0, w: 4, h: 0.25 },
              fontSize: 4.5,
            },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_size_below_floor');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('warns when font size is between 5pt and 6.5pt', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            {
              name: 'Title', type: 'text', text: 'Title',
              position: { x: 0.7, y: 0.5, w: 8, h: 0.8 },
              fontSize: 18,
            },
            {
              name: 'Footer', type: 'text', text: 'footer',
              position: { x: 0.7, y: 5.1, w: 4, h: 0.25 },
              fontSize: 6,
            },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_size_below_floor');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('does not flag when all font sizes are >= 6.5pt', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            {
              name: 'Title', type: 'text', text: 'Title',
              position: { x: 0.7, y: 0.5, w: 8, h: 0.8 },
              fontSize: 24,
            },
            {
              name: 'Body', type: 'text', text: 'body',
              position: { x: 0.7, y: 1.6, w: 8, h: 2.5 },
              fontSize: 14,
            },
            {
              name: 'Footer', type: 'text', text: 'footer',
              position: { x: 0.7, y: 5.1, w: 4, h: 0.25 },
              fontSize: 8,
            },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_size_below_floor');
      expect(issue).toBeUndefined();
    });

    it('silently skips elements without fontSize data', () => {
      const report = lint.lint(makeInfo());
      const issue = report.aesthetic.find((i) => i.code === 'font_size_below_floor');
      expect(issue).toBeUndefined();
    });

    it('checks the smallest actual run instead of the element maximum', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [{
            name: 'Mixed size',
            type: 'text',
            text: 'Headline source',
            fontSize: 24,
            position: { x: 1, y: 1, w: 7, h: 0.8 },
            paragraphs: [{
              runs: [
                { text: 'Headline', fontSize: 24 },
                { text: ' source', fontSize: 4.5 },
              ],
            }],
          }],
        }],
      }));

      expect(report.aesthetic.find((issue) => issue.code === 'font_size_below_floor')).toBeDefined();
    });

    it('uses the annotation floor for source text', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [{
            name: 'Source',
            type: 'text',
            text: 'Source: internal',
            semanticRole: 'source',
            position: { x: 1, y: 5, w: 4, h: 0.3 },
            paragraphs: [{ runs: [{ text: 'Source: internal', fontSize: 6 }] }],
          }],
        }],
      }));

      expect(report.aesthetic.find((issue) => issue.code === 'font_size_below_floor')).toBeUndefined();
    });
  });

  describe('font size tiers (Tier-1 Rule 3)', () => {
    it('warns when a slide uses more than 4 distinct font-size tiers', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'T1', type: 'text', text: 'A', position: { x: 1, y: 0.5, w: 8, h: 0.6 }, fontSize: 36 },
            { name: 'T2', type: 'text', text: 'B', position: { x: 1, y: 1.2, w: 8, h: 0.6 }, fontSize: 24 },
            { name: 'T3', type: 'text', text: 'C', position: { x: 1, y: 2.0, w: 8, h: 0.5 }, fontSize: 18 },
            { name: 'T4', type: 'text', text: 'D', position: { x: 1, y: 2.7, w: 8, h: 0.5 }, fontSize: 14 },
            { name: 'T5', type: 'text', text: 'E', position: { x: 1, y: 3.3, w: 8, h: 0.4 }, fontSize: 10 },
            { name: 'T6', type: 'text', text: 'F', position: { x: 1, y: 3.8, w: 8, h: 0.4 }, fontSize: 8 },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_size_tier_overload');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('merges sizes within 0.5pt into one tier', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'T1', type: 'text', text: 'A', position: { x: 1, y: 0.5, w: 8, h: 0.6 }, fontSize: 36 },
            { name: 'T1b', type: 'text', text: 'A2', position: { x: 1, y: 1.1, w: 8, h: 0.6 }, fontSize: 36.2 },
            { name: 'T2', type: 'text', text: 'B', position: { x: 1, y: 1.8, w: 8, h: 0.5 }, fontSize: 18 },
            { name: 'T2b', type: 'text', text: 'B2', position: { x: 1, y: 2.3, w: 8, h: 0.5 }, fontSize: 18.3 },
            { name: 'T3', type: 'text', text: 'C', position: { x: 1, y: 2.9, w: 8, h: 0.5 }, fontSize: 12 },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_size_tier_overload');
      expect(issue).toBeUndefined();
    });

    it('does not warn with 4 or fewer tiers', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'T1', type: 'text', text: 'A', position: { x: 1, y: 0.5, w: 8, h: 0.6 }, fontSize: 36 },
            { name: 'T2', type: 'text', text: 'B', position: { x: 1, y: 1.2, w: 8, h: 0.5 }, fontSize: 20 },
            { name: 'T3', type: 'text', text: 'C', position: { x: 1, y: 1.9, w: 8, h: 0.5 }, fontSize: 14 },
            { name: 'T4', type: 'text', text: 'D', position: { x: 1, y: 2.6, w: 8, h: 0.4 }, fontSize: 9 },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_size_tier_overload');
      expect(issue).toBeUndefined();
    });
  });

  describe('font family consistency (Tier-1 Rule 9)', () => {
    it('不把纯符号补字字体计为正文第三族，同时仍统计正文替换', () => {
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements: [
        makeResolvedFontText({ name: 'T1', text: 'A', declaredFamily: 'Inter' }),
        makeResolvedFontText({ name: 'T2', text: 'B', declaredFamily: 'Roboto' }),
        makeResolvedFontText({ name: 'Symbols', text: '≥ ≤ ± ₂ €', declaredFamily: 'Inter', resolvedFamily: 'Symbol', resolution: 'substituted' }),
      ] }] }));
      expect(report.aesthetic.find(issue => issue.code === 'font_family_inconsistent')).toBeUndefined();
      expect(report.aesthetic.find(issue => issue.code === 'font_family_substituted')).toBeDefined();
    });

    it('warns when one script uses more than 2 resolved font families', () => {
      const report = lint.lint(makeInfo({
        slideCount: 2,
        slides: [
          {
            number: 1,
            elements: [
              makeResolvedFontText({ name: 'T1', text: 'A', declaredFamily: 'Inter' }),
              makeResolvedFontText({ name: 'T2', text: 'B', declaredFamily: 'Roboto' }),
            ],
          },
          {
            number: 2,
            elements: [
              makeResolvedFontText({ name: 'T3', text: 'C', declaredFamily: 'Noto Sans' }),
            ],
          },
        ],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_family_inconsistent');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('treats W3/W6 requests resolved to the same family as one family', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            makeResolvedFontText({
              name: 'W3', text: '正文', declaredFamily: 'Hiragino Sans GB W3',
              resolvedFamily: 'Hiragino Sans GB', script: 'eastAsian', resolution: 'substituted',
            }),
            makeResolvedFontText({
              name: 'W6', text: '标题', declaredFamily: 'Hiragino Sans GB W6',
              resolvedFamily: 'Hiragino Sans GB', script: 'eastAsian', resolution: 'substituted',
            }),
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_family_inconsistent');
      expect(issue).toBeUndefined();
    });

    it('allows one Latin and one East Asian resolved family', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            makeResolvedFontText({ name: 'Latin', text: 'Avenir', declaredFamily: 'Avenir' }),
            makeResolvedFontText({
              name: 'CJK', text: '苹方', declaredFamily: 'Hiragino Sans GB', script: 'eastAsian',
            }),
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'font_family_inconsistent');
      expect(issue).toBeUndefined();
    });

    it('counts a third resolved family in later mixed runs', () => {
      const mixed = makeResolvedFontText({
        name: 'Mixed',
        text: 'ABC',
        declaredFamily: 'Inter',
        runs: [
          { text: 'A', fontFamily: 'Inter', resolvedFontFamily: 'Inter', fontScript: 'latin', fontResolution: 'exact' },
          { text: 'B', fontFamily: 'Roboto', resolvedFontFamily: 'Roboto', fontScript: 'latin', fontResolution: 'exact' },
          { text: 'C', fontFamily: 'Aptos', resolvedFontFamily: 'Aptos', fontScript: 'latin', fontResolution: 'exact' },
        ],
      });
      const report = lint.lint(makeInfo({ slides: [{ number: 1, elements: [mixed] }] }));

      expect(report.aesthetic.find((issue) => issue.code === 'font_family_inconsistent')).toBeDefined();
    });

    it('reports unresolved fonts separately from family consistency', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            makeResolvedFontText({
              name: 'Missing', text: 'A', declaredFamily: 'Missing Display',
              resolvedFamily: 'Missing Display', resolution: 'unresolved',
            }),
            makeResolvedFontText({ name: 'Available', text: 'B', declaredFamily: 'Inter' }),
          ],
        }],
      }));

      expect(report.aesthetic.find((issue) => issue.code === 'font_unresolved')).toBeDefined();
      expect(report.aesthetic.find((issue) => issue.code === 'font_family_inconsistent')).toBeUndefined();
    });

    it('reports a family substitution even when the resolved face style still matches', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 2,
          elements: [makeResolvedFontText({
            name: 'Checkmark',
            text: '✓',
            declaredFamily: 'Heiti SC',
            resolvedFamily: 'Hiragino Sans W6',
            resolution: 'substituted',
            runs: [{
              text: '✓',
              fontFamily: 'Heiti SC',
              resolvedFontFamily: 'Hiragino Sans W6',
              fontScript: 'latin',
              fontResolution: 'substituted',
              bold: true,
              resolvedBold: true,
              resolvedItalic: false,
            }],
          })],
        }],
      }));

      expect(report.aesthetic.find((issue) => issue.code === 'font_family_substituted'))
        .toMatchObject({
          severity: 'warning',
          slides: [2],
          evidence: {
            kind: 'font_resolution',
            difference: 'family',
            requestedFamily: 'Heiti SC',
            resolvedFamily: 'Hiragino Sans W6',
          },
        });
      expect(report.aesthetic.find((issue) => issue.code === 'font_style_substituted'))
        .toBeUndefined();
    });

    it('ignores legacy inputs without resolved font facts', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Legacy', type: 'text', text: 'A', position: { x: 1, y: 1, w: 7, h: 0.6 }, textStyle: { fontFamily: 'Raw Only' } },
          ],
        }],
      }));

      expect(report.aesthetic.filter((issue) => issue.code.startsWith('font_'))).toEqual([]);
    });

    it('reports when a regular request resolves to a bold face', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [makeResolvedFontText({
            name: 'Subtitle',
            text: '一页测试文稿',
            declaredFamily: 'Heiti SC',
            resolvedFamily: 'Hiragino Sans W9',
            script: 'eastAsian',
            resolution: 'substituted',
            runs: [{
              text: '一页测试文稿',
              fontFamily: 'Heiti SC',
              resolvedFontFamily: 'Hiragino Sans W9',
              fontScript: 'eastAsian',
              fontResolution: 'substituted',
              bold: false,
              italic: false,
              resolvedBold: true,
              resolvedItalic: false,
            }],
          })],
        }],
      }));

      expect(report.aesthetic.find((issue) => issue.code === 'font_style_substituted'))
        .toMatchObject({
          severity: 'warning',
          slides: [1],
          evidence: { kind: 'font_resolution', difference: 'style' },
        });
    });
  });

  describe('edge margins (Rule 4)', () => {
    function findEdgeIssues(info: PresentationInfo) {
      return lint.lint(info).aesthetic.filter((i) => i.code === 'element_edge_margin');
    }

    it('warns when an element sits within 0.15" of the left edge', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'TooLeft', type: 'text', text: 'Hi', position: { x: 0.1, y: 2, w: 3, h: 0.5 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].evidence).toMatchObject({
        kind: 'node_bounds',
        violatedSides: ['left'],
        margins: { left: 0.1 },
      });
    });

    it('warns when an element sits within 0.15" of the right edge', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            // right margin = 10 - (8 + 1.95) = 0.05"
            { name: 'TooRight', type: 'text', text: 'Hi', position: { x: 8, y: 2, w: 1.95, h: 0.5 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0].evidence).toMatchObject({
        kind: 'node_bounds',
        violatedSides: ['right'],
      });
      expect(issues[0].evidence.margins.right).toBeCloseTo(0.05);
    });

    it('warns when an element sits within 0.15" of the top edge', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'TooTop', type: 'text', text: 'Hi', position: { x: 1, y: 0.1, w: 3, h: 0.5 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0].evidence).toMatchObject({
        kind: 'node_bounds',
        violatedSides: ['top'],
        margins: { top: 0.1 },
      });
    });

    it('warns when an element sits within 0.15" of the bottom edge', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            // bottom margin = 5.625 - (5.0 + 0.5) = 0.125"
            { name: 'TooBottom', type: 'text', text: 'Hi', position: { x: 1, y: 5.0, w: 3, h: 0.5 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0].evidence).toMatchObject({
        kind: 'node_bounds',
        violatedSides: ['bottom'],
        margins: { bottom: 0.125 },
      });
    });

    it('does not warn when bottom margin sits in the 0.15"–0.3" zone (typical footer band)', () => {
      // 这是阈值放宽的回归：footer / 页脚 / 页码常落在 0.15"–0.3" 之间，
      // 阈值 0.3 → 0.15 后，这一带不再触发误报。
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            // bottom margin = 5.625 - (5.4 + 0.2) = 0.025"... 太小，换个值
            // bottom margin = 5.625 - (5.2 + 0.2) = 0.225"  → 在 0.15–0.3 区间
            { name: 'Footer', type: 'text', text: 'source', position: { x: 0.4, y: 5.2, w: 9.2, h: 0.2 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(0);
    });

    it('aggregates multiple sides into a single message per element', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'TopLeft', type: 'text', text: 'X', position: { x: 0.1, y: 0.1, w: 1, h: 0.5 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0].evidence).toMatchObject({
        kind: 'node_bounds',
        violatedSides: ['left', 'top'],
        margins: { left: 0.1, top: 0.1 },
      });
    });

    it('exempts horizontally full-bleed elements from left/right checks (still checks top/bottom)', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            // 全宽分隔条：宽 100% → 豁免 left/right；高度小且贴顶 → 仍检查 top（0 < 0.15"）
            { name: 'TopBar', type: 'shape', position: { x: 0, y: 0, w: 10, h: 0.05 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0].evidence).toMatchObject({
        violatedSides: ['top'],
        fullBleedAxes: ['horizontal'],
      });
    });

    it('exempts vertically full-bleed elements from top/bottom checks (still checks left/right)', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            // 左侧装饰条：高度 100% → 豁免 top/bottom；宽度小且贴左 → 仍检查 left
            { name: 'SideRail', type: 'shape', position: { x: 0, y: 0, w: 0.05, h: 5.625 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0].evidence).toMatchObject({
        violatedSides: ['left'],
        fullBleedAxes: ['vertical'],
      });
    });

    it('exempts both axes for full-bleed background images / shapes (no warning)', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Background', type: 'shape', position: { x: 0, y: 0, w: 10, h: 5.625 } },
            { name: 'BgImage', type: 'image', position: { x: 0, y: 0, w: 10, h: 5.625 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(0);
    });

    it('does not warn when all margins are >= 0.15"', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Centered', type: 'text', text: 'Hi', position: { x: 1, y: 1, w: 8, h: 3 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(0);
    });

    it('skips out-of-canvas elements (LayoutLint owns those)', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'OOB', type: 'shape', position: { x: -1, y: -1, w: 3, h: 3 } },
            { name: 'OverHang', type: 'shape', position: { x: 8, y: 4, w: 5, h: 2 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(0);
    });

    it('reports per-element when multiple elements all hug the same edge', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'L1', type: 'text', text: 'a', position: { x: 0.1, y: 1, w: 2, h: 0.5 } },
            { name: 'L2', type: 'text', text: 'b', position: { x: 0.1, y: 2, w: 2, h: 0.5 } },
            { name: 'L3', type: 'text', text: 'c', position: { x: 0.1, y: 3, w: 2, h: 0.5 } },
          ],
        }],
      }));
      expect(issues).toHaveLength(3);
      expect(issues.map((issue) => issue.evidence.node.nodeId)).toEqual(['L1', 'L2', 'L3']);
    });

    it('skips elements without a position', () => {
      const issues = findEdgeIssues(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'NoPos', type: 'text', text: 'x' },
          ],
        }],
      }));
      expect(issues).toHaveLength(0);
    });
  });

  describe('report composition', () => {
    it('includes both layout and aesthetic issues in report', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'OOB', type: 'shape', position: { x: -1, y: 0, w: 2, h: 2 } },
            ...Array.from({ length: 14 }, (_, i) => ({
              name: `El${i}`,
              type: 'text' as const,
              text: 'x',
              position: { x: 0.5 + (i % 5) * 1.8, y: 0.5 + Math.floor(i / 5) * 1.5, w: 1.5, h: 1.2 },
            })),
          ],
        }],
      }));
      expect(report.layout.issues.length).toBeGreaterThan(0);
      expect(report.aesthetic.length).toBeGreaterThan(0);
    });

    it('reports more adjacent repetition for repeated decks than varied decks', () => {
      const repeated = lint.lint(makeInfo({
        slideCount: 3,
        slides: Array.from({ length: 3 }, (_, index) => ({
          number: index + 1,
          elements: [
            { name: 'Title', type: 'text', text: `T${index}`, position: { x: 0.7, y: 0.5, w: 8, h: 0.8 } },
            { name: 'Body', type: 'text', text: `B${index}`, position: { x: 0.7, y: 1.5, w: 8, h: 3 } },
          ],
        })),
      }));
      const varied = lint.lint(makeInfo({
        slideCount: 3,
        slides: [
          { number: 1, elements: [{ name: 'Title', type: 'text', text: 'A', position: { x: 0.7, y: 0.5, w: 8, h: 0.8 } }] },
          { number: 2, elements: [{ name: 'Chart', type: 'chart', position: { x: 0.7, y: 1.2, w: 7.5, h: 3.4 } }] },
          { number: 3, elements: [{ name: 'Table', type: 'table', position: { x: 0.7, y: 1.3, w: 8.2, h: 2.7 } }] },
        ],
      }));

      expect(repeated.metrics.repeatedAdjacentPairs).toBeGreaterThan(varied.metrics.repeatedAdjacentPairs);
    });
  });

  // ─── P1 Tier-1: Palette Diversity (Rule 1) ─────────────────────────────
  describe('palette diversity (Rule 1)', () => {
    it('does not warn when chromatic colors share ≤ 4 hue clusters', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Hero', type: 'shape', fill: '#1F4F8A', position: { x: 0.5, y: 0.5, w: 4, h: 2 } },
            { name: 'Accent', type: 'shape', fill: '#2A66B0', position: { x: 5, y: 0.5, w: 4, h: 2 } },
            { name: 'Neutral', type: 'shape', fill: '#FFFFFF', position: { x: 0.5, y: 3, w: 9, h: 2 } },
            { name: 'Title', type: 'text', text: 'T', textColor: '#1F4F8A', position: { x: 0.5, y: 0.6, w: 4, h: 0.6 } },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'palette_too_diverse')).toBeUndefined();
    });

    it('warns when chromatic colors span > 4 hue clusters', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            /* 5 不同 30° 桶：红(0°) / 黄(60°) / 绿(120°) / 青(180°) / 蓝(240°) */
            { name: 'A', type: 'shape', fill: '#FF0000', position: { x: 0, y: 0, w: 1, h: 1 } },
            { name: 'B', type: 'shape', fill: '#FFFF00', position: { x: 1, y: 0, w: 1, h: 1 } },
            { name: 'C', type: 'shape', fill: '#00FF00', position: { x: 2, y: 0, w: 1, h: 1 } },
            { name: 'D', type: 'shape', fill: '#00FFFF', position: { x: 3, y: 0, w: 1, h: 1 } },
            { name: 'E', type: 'shape', fill: '#0000FF', position: { x: 4, y: 0, w: 1, h: 1 } },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'palette_too_diverse');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('ignores neutral colors (white/black/gray) when counting clusters', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'A', type: 'shape', fill: '#FFFFFF', position: { x: 0, y: 0, w: 1, h: 1 } },
            { name: 'B', type: 'shape', fill: '#F5F5F5', position: { x: 1, y: 0, w: 1, h: 1 } },
            { name: 'C', type: 'shape', fill: '#000000', position: { x: 2, y: 0, w: 1, h: 1 } },
            { name: 'D', type: 'shape', fill: '#7F7F7F', position: { x: 3, y: 0, w: 1, h: 1 } },
            { name: 'E', type: 'shape', fill: '#1F4F8A', position: { x: 4, y: 0, w: 1, h: 1 } },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'palette_too_diverse')).toBeUndefined();
    });

    it('treats different tones of the same hue as one cluster', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            /* 5 个全是不同蓝色 tone，仍只是 1 个 hue 桶 */
            { name: 'A', type: 'shape', fill: '#0F2A4D', position: { x: 0, y: 0, w: 1, h: 1 } },
            { name: 'B', type: 'shape', fill: '#1F4F8A', position: { x: 1, y: 0, w: 1, h: 1 } },
            { name: 'C', type: 'shape', fill: '#2A66B0', position: { x: 2, y: 0, w: 1, h: 1 } },
            { name: 'D', type: 'shape', fill: '#3D7DC8', position: { x: 3, y: 0, w: 1, h: 1 } },
            { name: 'E', type: 'shape', fill: '#5295DA', position: { x: 4, y: 0, w: 1, h: 1 } },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'palette_too_diverse')).toBeUndefined();
    });
  });

  // ─── P1 Tier-1: Primary Hue Drift (Rule 8) ─────────────────────────────
  describe('primary hue drift (Rule 8)', () => {
    it('does not warn when every slide uses the same primary hue', () => {
      const report = lint.lint(makeInfo({
        slideCount: 3,
        slides: [1, 2, 3].map((n) => ({
          number: n,
          elements: [
            { name: 'Hero', type: 'shape', fill: '#1F4F8A', position: { x: 0, y: 0, w: 5, h: 3 } },
          ],
        })),
      }));
      expect(report.aesthetic.find((i) => i.code === 'primary_hue_drift')).toBeUndefined();
    });

    it('warns when each slide flips to a wildly different primary', () => {
      const report = lint.lint(makeInfo({
        slideCount: 4,
        slides: [
          { number: 1, elements: [{ name: 'A', type: 'shape', fill: '#E64545', position: { x: 0, y: 0, w: 5, h: 3 } }] }, /* red ~0° */
          { number: 2, elements: [{ name: 'B', type: 'shape', fill: '#2EA866', position: { x: 0, y: 0, w: 5, h: 3 } }] }, /* green ~140° */
          { number: 3, elements: [{ name: 'C', type: 'shape', fill: '#1F4F8A', position: { x: 0, y: 0, w: 5, h: 3 } }] }, /* blue ~210° */
          { number: 4, elements: [{ name: 'D', type: 'shape', fill: '#9C2A99', position: { x: 0, y: 0, w: 5, h: 3 } }] }, /* purple ~300° */
        ],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'primary_hue_drift');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('does not warn when slides have no chromatic fills (all neutral)', () => {
      const report = lint.lint(makeInfo({
        slideCount: 3,
        slides: [1, 2, 3].map((n) => ({
          number: n,
          elements: [
            { name: 'BG', type: 'shape', fill: '#FFFFFF', position: { x: 0, y: 0, w: 5, h: 3 } },
          ],
        })),
      }));
      expect(report.aesthetic.find((i) => i.code === 'primary_hue_drift')).toBeUndefined();
    });

    it('handles wrap-around hues (350° vs 10° are close)', () => {
      const report = lint.lint(makeInfo({
        slideCount: 2,
        slides: [
          { number: 1, elements: [{ name: 'A', type: 'shape', fill: '#E64560', position: { x: 0, y: 0, w: 5, h: 3 } }] }, /* ~350° */
          { number: 2, elements: [{ name: 'B', type: 'shape', fill: '#E66A45', position: { x: 0, y: 0, w: 5, h: 3 } }] }, /* ~10° */
        ],
      }));
      expect(report.aesthetic.find((i) => i.code === 'primary_hue_drift')).toBeUndefined();
    });
  });

  // ─── P1 Tier-1: Text Contrast (Rule 10) ────────────────────────────────
  describe('text contrast (Rule 10)', () => {
    it('does not warn when text has high contrast against container fill', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Card', type: 'shape', fill: '#FFFFFF', position: { x: 0.5, y: 0.5, w: 9, h: 4 } },
            { name: 'Body', type: 'text', text: 'Dark text', textColor: '#1A1A1A', position: { x: 1, y: 1, w: 8, h: 2 } },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'text_contrast_low')).toBeUndefined();
    });

    it('warns on light yellow text over white background (very low contrast)', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Card', type: 'shape', fill: '#FFFFFF', position: { x: 0.5, y: 0.5, w: 9, h: 4 } },
            { name: 'Body', type: 'text', text: 'pale', textColor: '#FFE680', position: { x: 1, y: 1, w: 8, h: 2 } },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'text_contrast_low');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('skips when no containing shape can be found (avoid false positive on bare text)', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            /* no shape at all */
            { name: 'Body', type: 'text', text: 't', textColor: '#FFE680', position: { x: 1, y: 1, w: 8, h: 2 } },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'text_contrast_low')).toBeUndefined();
    });

    it('skips when text has no color', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'Card', type: 'shape', fill: '#FFE680', position: { x: 0.5, y: 0.5, w: 9, h: 4 } },
            { name: 'Body', type: 'text', text: 't', position: { x: 1, y: 1, w: 8, h: 2 } },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'text_contrast_low')).toBeUndefined();
    });

    it('picks the smallest containing shape when multiple are nested', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            /* outer shape: dark; inner card: light yellow; text on light yellow */
            { name: 'BG', type: 'shape', fill: '#1F4F8A', position: { x: 0, y: 0, w: 10, h: 5.625 } },
            { name: 'Card', type: 'shape', fill: '#FFE680', position: { x: 0.5, y: 0.5, w: 9, h: 4 } },
            { name: 'Body', type: 'text', text: 't', textColor: '#FFFFFF', position: { x: 1, y: 1, w: 8, h: 2 } },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'text_contrast_low');
      /* white-on-pale-yellow contrast ≈ 1.2 → must warn against the inner card, not the outer */
      expect(issue).toBeDefined();
      expect(issue!.evidence).toMatchObject({
        kind: 'color_contrast',
        backgroundColor: '#FFE680',
      });
    });
  });

  // ─── P1 Tier-1: Image Aspect Distortion (Rule 7) ──────────────────────
  describe('image aspect distortion (Rule 7)', () => {
    it('warns when fit=stretch and frame aspect deviates > 10% from natural', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            {
              name: 'Hero',
              type: 'image',
              imageFit: 'stretch',
              imageNaturalAspect: 1.0, /* square source */
              position: { x: 0.5, y: 0.5, w: 6, h: 2 }, /* frame aspect = 3.0 */
            },
          ],
        }],
      }));
      const issue = report.aesthetic.find((i) => i.code === 'image_aspect_distorted');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('does not warn when deviation is within 10%', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            {
              name: 'Hero',
              type: 'image',
              imageFit: 'stretch',
              imageNaturalAspect: 1.78, /* 16:9 */
              position: { x: 0.5, y: 0.5, w: 8, h: 4.6 }, /* aspect ≈ 1.74 → 2% off */
            },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'image_aspect_distorted')).toBeUndefined();
    });

    it('does not warn when fit ≠ stretch even with mismatched aspect', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            {
              name: 'Hero',
              type: 'image',
              imageFit: 'cover',
              imageNaturalAspect: 1.0,
              position: { x: 0.5, y: 0.5, w: 6, h: 2 },
            },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'image_aspect_distorted')).toBeUndefined();
    });

    it('skips when imageNaturalAspect is unknown (PptxReader path)', () => {
      const report = lint.lint(makeInfo({
        slides: [{
          number: 1,
          elements: [
            {
              name: 'Hero',
              type: 'image',
              imageFit: 'stretch',
              position: { x: 0.5, y: 0.5, w: 6, h: 2 },
            },
          ],
        }],
      }));
      expect(report.aesthetic.find((i) => i.code === 'image_aspect_distorted')).toBeUndefined();
    });
  });
});
