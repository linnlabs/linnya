import type {
  RenderChartType,
  SlideElementChartInfo,
  SlideElementInfo,
} from '@plugin/slides/shared';
import { buildDiagnosticNodeRef } from '../functions/buildDiagnosticNodeRef.js';
import {
  CHART_LABEL_CAPACITY_RISK_RATIO,
  CHART_LABEL_LINE_HEIGHT_RATIO,
} from './thresholds.js';
import type { AestheticLintIssue } from './types.js';

const MAX_EVIDENCE_LABEL_LENGTH = 40;

/**
 * 检查图表中模型能够直接修正、且无需猜标题语义的可读性事实。
 *
 * 规则只在 RenderModel 已提供最终图例、轴和标签配置时运行；imported PPTX
 * 缺少这些事实会直接跳过，不能从 chartType 或标题反推。
 */
export function lintChartReadability(
  slideNumber: number,
  elements: readonly SlideElementInfo[],
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  for (const element of elements) {
    if (element.type !== 'chart' || !element.position || !element.chartInfo) continue;
    issues.push(...lintChartIdentity(slideNumber, element, element.chartInfo));
    issues.push(...lintChartLabelCapacity(slideNumber, element, element.chartInfo));
  }
  return issues;
}

function lintChartIdentity(
  slideNumber: number,
  element: SlideElementInfo,
  chart: SlideElementChartInfo,
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  const radialCategoryChart = chart.chartType === 'pie' || chart.chartType === 'doughnut';
  const namedCategoryCount = countNamedLabels(chart.categoryLabels);
  const namedSeriesCount = countNamedLabels(chart.seriesNames);
  const categoryIdentityVisible = radialCategoryChart
    ? chart.legend.visible
      || (chart.dataLabels.visible && chart.dataLabels.includesCategoryName)
    : chart.chartType === 'radar' || chart.categoryAxis.visible;

  if (
    chart.categoryLabels.length >= 2
    && (!categoryIdentityVisible || namedCategoryCount < chart.categoryLabels.length)
  ) {
    issues.push(buildIdentityIssue(
      slideNumber,
      element,
      chart,
      'categories',
      categoryIdentityVisible
        ? chart.categoryLabels.length - namedCategoryCount
        : chart.categoryLabels.length,
    ));
  }

  if (
    !radialCategoryChart
    && chart.seriesNames.length >= 2
    && (!chart.legend.visible || namedSeriesCount < chart.seriesNames.length)
  ) {
    issues.push(buildIdentityIssue(
      slideNumber,
      element,
      chart,
      'series',
      chart.legend.visible
        ? chart.seriesNames.length - namedSeriesCount
        : chart.seriesNames.length,
    ));
  }

  return issues;
}

function buildIdentityIssue(
  slideNumber: number,
  element: SlideElementInfo,
  chart: SlideElementChartInfo,
  missingIdentity: 'categories' | 'series',
  unidentifiedLabelCount: number,
): AestheticLintIssue {
  return {
    code: 'chart_identity_missing',
    severity: 'warning',
    confidence: 'medium',
    slides: [slideNumber],
    evidence: {
      kind: 'chart_readability',
      assessment: 'identity_missing',
      node: buildDiagnosticNodeRef(element),
      chartType: chart.chartType,
      categoryCount: chart.categoryLabels.length,
      seriesCount: chart.seriesNames.length,
      legendVisible: chart.legend.visible,
      dataLabelsVisible: chart.dataLabels.visible,
      missingIdentity,
      unidentifiedLabelCount,
    },
  };
}

function lintChartLabelCapacity(
  slideNumber: number,
  element: SlideElementInfo,
  chart: SlideElementChartInfo,
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  if (!element.position) return issues;

  if (
    chart.categoryAxis.visible
    && chart.categoryLabels.length >= 2
    && isCartesianChart(chart.chartType)
  ) {
    const categoryLabels = namedLabels(chart.categoryLabels);
    if (categoryLabels.length >= 2) {
      const direction = chart.chartType === 'bar' ? 'vertical' : 'horizontal';
      const availableSpanInches = resolveCategoryAxisSpan(element, chart, direction);
      const estimatedRequiredSpanInches = estimateCategoryLabelSpacingInches(
        categoryLabels,
        chart.categoryAxis.fontSizePt,
        direction,
        chart.categoryAxis.labelRotationDegrees,
      ) * categoryLabels.length;
      const issue = buildCapacityIssue({
        slideNumber,
        element,
        chart,
        channel: 'category_axis',
        direction,
        labels: categoryLabels,
        fontSizePt: chart.categoryAxis.fontSizePt,
        availableSpanInches,
        estimatedRequiredSpanInches,
      });
      if (issue) issues.push(issue);
    }
  }

  if (
    (chart.chartType === 'pie' || chart.chartType === 'doughnut')
    && chart.dataLabels.visible
    && chart.dataLabels.position === 'outside'
    && chart.categoryLabels.length >= 2
  ) {
    const categoryLabels = namedLabels(chart.categoryLabels);
    if (categoryLabels.length >= 2) {
      const labelsPerSide = Math.ceil(categoryLabels.length / 2);
      const availableSpanInches = element.position.h * 0.8;
      const estimatedRequiredSpanInches = estimateLineHeightInches(chart.dataLabels.fontSizePt)
        * labelsPerSide;
      const issue = buildCapacityIssue({
        slideNumber,
        element,
        chart,
        channel: 'data_labels',
        direction: 'vertical',
        labels: categoryLabels,
        fontSizePt: chart.dataLabels.fontSizePt,
        availableSpanInches,
        estimatedRequiredSpanInches,
      });
      if (issue) issues.push(issue);
    }
  }

  return issues;
}

interface CapacityIssueInput {
  readonly slideNumber: number;
  readonly element: SlideElementInfo;
  readonly chart: SlideElementChartInfo;
  readonly channel: 'category_axis' | 'data_labels';
  readonly direction: 'horizontal' | 'vertical';
  readonly labels: readonly string[];
  readonly fontSizePt: number;
  readonly availableSpanInches: number;
  readonly estimatedRequiredSpanInches: number;
}

function buildCapacityIssue(input: CapacityIssueInput): AestheticLintIssue | undefined {
  if (input.availableSpanInches <= 0 || input.estimatedRequiredSpanInches <= 0) return undefined;
  const capacityRatio = input.estimatedRequiredSpanInches / input.availableSpanInches;
  if (capacityRatio <= CHART_LABEL_CAPACITY_RISK_RATIO) return undefined;

  return {
    code: 'chart_label_capacity_exceeded',
    severity: 'warning',
    confidence: 'medium',
    slides: [input.slideNumber],
    evidence: {
      kind: 'chart_readability',
      assessment: 'label_capacity_exceeded',
      node: buildDiagnosticNodeRef(input.element),
      chartType: input.chart.chartType,
      categoryCount: input.chart.categoryLabels.length,
      seriesCount: input.chart.seriesNames.length,
      legendVisible: input.chart.legend.visible,
      dataLabelsVisible: input.chart.dataLabels.visible,
      channel: input.channel,
      direction: input.direction,
      labelCount: input.labels.length,
      maxLabel: abbreviateLabel(longestLabel(input.labels)),
      fontSizePt: input.fontSizePt,
      ...(input.channel === 'category_axis'
        ? { labelRotationDegrees: input.chart.categoryAxis.labelRotationDegrees }
        : {}),
      availableSpanInches: input.availableSpanInches,
      estimatedRequiredSpanInches: input.estimatedRequiredSpanInches,
      capacityRatio,
      thresholdRatio: CHART_LABEL_CAPACITY_RISK_RATIO,
    },
  };
}

function resolveCategoryAxisSpan(
  element: SlideElementInfo,
  chart: SlideElementChartInfo,
  direction: 'horizontal' | 'vertical',
): number {
  if (!element.position) return 0;
  if (direction === 'horizontal') {
    const sideLegend = chart.legend.visible
      && (chart.legend.position === 'left' || chart.legend.position === 'right');
    return element.position.w * (sideLegend ? 0.77 : 0.9);
  }
  const horizontalLegend = chart.legend.visible
    && (chart.legend.position === 'top' || chart.legend.position === 'bottom');
  return element.position.h * (horizontalLegend ? 0.72 : 0.82);
}

function isCartesianChart(chartType: RenderChartType): boolean {
  return chartType !== 'pie' && chartType !== 'doughnut' && chartType !== 'radar';
}

function estimateLineHeightInches(fontSizePt: number): number {
  return (fontSizePt / 72) * CHART_LABEL_LINE_HEIGHT_RATIO;
}

function estimateMaxLabelWidthInches(labels: readonly string[], fontSizePt: number): number {
  return Math.max(...labels.map((label) => estimateLabelWidthInches(label, fontSizePt)), 0);
}

/**
 * 相邻标签沿类目轴平移，只要在文字宽/高任一方向分离便不会相交。
 * 旋转后的轴对齐外接框可能重叠，不能把外接框宽度当作标签所需间距。
 * 此处等价于 min(width / |cos|, height / |sin|)，乘积形式避免 0°/90° 除零。
 * 宽高仍是保守估算，不代替 ECharts 的字体测量、自动间隔或最终像素复核。
 */
function estimateCategoryLabelSpacingInches(
  labels: readonly string[],
  fontSizePt: number,
  direction: 'horizontal' | 'vertical',
  labelRotationDegrees: number,
): number {
  const width = estimateMaxLabelWidthInches(labels, fontSizePt);
  const height = estimateLineHeightInches(fontSizePt);
  const axisRotationDegrees = direction === 'horizontal' ? 0 : 90;
  const relativeRotation = (axisRotationDegrees - labelRotationDegrees) * Math.PI / 180;
  return width * height / Math.max(
    height * Math.abs(Math.cos(relativeRotation)),
    width * Math.abs(Math.sin(relativeRotation)),
  );
}

/**
 * 仅用于容量预警的保守 em 估算：CJK/全角按 1em，Latin 与数字按 0.55em，
 * 空格和标点更窄。35% 的准入余量负责吸收具体字体差异；这里不冒充正式测量。
 */
function estimateLabelWidthInches(label: string, fontSizePt: number): number {
  let em = 0;
  for (const character of label) {
    if (/\s/u.test(character)) em += 0.33;
    else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) em += 1;
    else if (/\p{P}|\p{S}/u.test(character)) em += 0.45;
    else em += 0.55;
  }
  return em * (fontSizePt / 72);
}

function longestLabel(labels: readonly string[]): string {
  return labels.reduce((longest, label) => (
    [...label].length > [...longest].length ? label : longest
  ), '');
}

function abbreviateLabel(label: string): string {
  const normalized = label.replace(/\s+/g, ' ').trim();
  return normalized.length <= MAX_EVIDENCE_LABEL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_EVIDENCE_LABEL_LENGTH - 1)}…`;
}

function namedLabels(labels: readonly string[]): string[] {
  return labels.map((label) => label.trim()).filter((label) => label.length > 0);
}

function countNamedLabels(labels: readonly string[]): number {
  return namedLabels(labels).length;
}
