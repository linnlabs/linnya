/**
 * @file checkMarkdownChartRules.ts
 * @description 图表规格的字段间规则：等长、范围、份额合法性、双轴对应与数据量上限。
 *
 * 只检查数据与阅读语义的内在一致性。来源是否可靠、统计口径是否恰当、结论是否被证据支持
 * 属于研究判断，不在这里（也不可能被 schema）验证。
 */

import type {
  MarkdownChartDiagnosticCode,
  MarkdownChartPathSegment,
} from '../definitions/markdownChartDiagnostic';
import { MARKDOWN_CHART_LIMITS } from '../definitions/markdownChartConstants';
import { serializeMarkdownChartSpec } from './serializeMarkdownChartSpec';
import type {
  ComboMarkdownChartSpec,
  MarkdownChartSpec,
  MarkdownChartValueAxis,
} from '../definitions/markdownChartSpec';

export interface MarkdownChartRuleIssue {
  readonly code: MarkdownChartDiagnosticCode;
  readonly path: readonly MarkdownChartPathSegment[];
  readonly message: string;
}

type IssueSink = (code: MarkdownChartDiagnosticCode, path: readonly MarkdownChartPathSegment[], message: string) => void;

function checkLimits(spec: MarkdownChartSpec, report: IssueSink): void {
  if (spec.categories.length > MARKDOWN_CHART_LIMITS.maxCategories) {
    report('limit_exceeded', ['categories'],
      `categories has ${spec.categories.length} entries; the limit is ${MARKDOWN_CHART_LIMITS.maxCategories}. Aggregate the data or split the chart.`);
  }
  if (spec.series.length > MARKDOWN_CHART_LIMITS.maxSeries) {
    report('limit_exceeded', ['series'],
      `series has ${spec.series.length} entries; the limit is ${MARKDOWN_CHART_LIMITS.maxSeries}. Split the chart or keep the comparison to fewer series.`);
  }
  const points = spec.categories.length * spec.series.length;
  if (points > MARKDOWN_CHART_LIMITS.maxDataPoints) {
    report('limit_exceeded', ['series'],
      `the chart has ${points} data points (${spec.series.length} series x ${spec.categories.length} categories); the limit is ${MARKDOWN_CHART_LIMITS.maxDataPoints}. Aggregate the data or use a table.`);
  }
}

function checkSeriesShape(spec: MarkdownChartSpec, report: IssueSink): void {
  const names = new Map<string, number>();
  spec.series.forEach((series, index) => {
    const first = names.get(series.name);
    if (first !== undefined) {
      report('duplicate_name', ['series', index, 'name'],
        `series name "${series.name}" repeats series[${first}]; series names must be unique within one chart.`);
    } else {
      names.set(series.name, index);
    }
    if (series.values.length !== spec.categories.length) {
      report('length_mismatch', ['series', index, 'values'],
        `series[${index}].values has ${series.values.length} values but categories has ${spec.categories.length}; every series needs one value per category (missing data cannot be filled with 0).`);
    }
    if ('pointColors' in series && series.pointColors && series.pointColors.length !== spec.categories.length) {
      report('length_mismatch', ['series', index, 'pointColors'],
        `series[${index}].pointColors has ${series.pointColors.length} entries but categories has ${spec.categories.length}; use null to inherit a color.`);
    }
  });
}

function checkAxis(
  axis: MarkdownChartValueAxis | undefined,
  path: readonly MarkdownChartPathSegment[],
  report: IssueSink,
  options: { readonly includeZero: boolean },
): void {
  if (!axis) return;
  if (axis.min !== undefined && axis.max !== undefined && axis.min >= axis.max) {
    report('out_of_range', [...path, 'max'], `${path.join('.')}.max must be greater than min (${axis.min}).`);
  }
  if (options.includeZero) {
    if (axis.min !== undefined && axis.min > 0) {
      report('out_of_range', [...path, 'min'],
        `${path.join('.')}.min is ${axis.min}; bar and area axes must include zero, otherwise the baseline misrepresents magnitudes.`);
    }
    if (axis.max !== undefined && axis.max < 0) {
      report('out_of_range', [...path, 'max'],
        `${path.join('.')}.max is ${axis.max}; bar and area axes must include zero, otherwise the baseline misrepresents magnitudes.`);
    }
  }
}

function checkBar(spec: Extract<MarkdownChartSpec, { chartType: 'bar' }>, report: IssueSink): void {
  checkAxis(spec.valueAxis, ['valueAxis'], report, { includeZero: true });
  if (spec.stacking !== 'percent') return;

  if (spec.valueAxis?.min !== undefined || spec.valueAxis?.max !== undefined) {
    report('invalid_combination', ['valueAxis'],
      'stacking "percent" uses a fixed 0-1 scale; remove valueAxis.min and valueAxis.max.');
  }
  spec.series.forEach((series, seriesIndex) => {
    series.values.forEach((value, valueIndex) => {
      if (value < 0) {
        report('out_of_range', ['series', seriesIndex, 'values', valueIndex],
          `stacking "percent" shows shares of a whole, but series[${seriesIndex}].values[${valueIndex}] is negative (${value}). Use stacking "stacked" for signed contributions.`);
      }
    });
  });
  for (let category = 0; category < spec.categories.length; category += 1) {
    const total = spec.series.reduce((sum, series) => sum + (series.values[category] ?? 0), 0);
    if (!(total > 0) || !Number.isFinite(total)) {
      report('out_of_range', ['categories', category],
        `stacking "percent" needs a positive total for every category, but category ${category} totals ${total}.`);
    }
  }
}

function checkShare(spec: Extract<MarkdownChartSpec, { chartType: 'pie' | 'doughnut' }>, report: IssueSink): void {
  if (spec.series.length !== 1) {
    report('invalid_combination', ['series'],
      `${spec.chartType} charts take exactly one series (the parts of one whole), but series has ${spec.series.length}.`);
  }
  const [series] = spec.series;
  if (!series) return;
  let total = 0;
  series.values.forEach((value, index) => {
    if (value < 0) {
      report('out_of_range', ['series', 0, 'values', index],
        `${spec.chartType} values are shares of a whole and must be non-negative, but values[${index}] is ${value}.`);
    }
    total += value;
  });
  if (!(total > 0) || !Number.isFinite(total)) {
    report('out_of_range', ['series', 0, 'values'],
      `${spec.chartType} values must sum to a positive finite total, got ${total}.`);
  }
}

function checkScatter(spec: Extract<MarkdownChartSpec, { chartType: 'scatter' }>, report: IssueSink): void {
  checkAxis(spec.xAxis, ['xAxis'], report, { includeZero: false });
  checkAxis(spec.valueAxis, ['valueAxis'], report, { includeZero: false });
  if (spec.pointLabels && spec.pointLabels.length !== spec.categories.length) {
    report('length_mismatch', ['pointLabels'],
      `pointLabels has ${spec.pointLabels.length} entries but categories (the X values) has ${spec.categories.length}.`);
  }
}

function checkRadar(spec: Extract<MarkdownChartSpec, { chartType: 'radar' }>, report: IssueSink): void {
  const seen = new Map<string, number>();
  spec.categories.forEach((category, index) => {
    const key = String(category);
    const first = seen.get(key);
    if (first !== undefined) {
      report('duplicate_name', ['categories', index],
        `radar dimension "${key}" repeats categories[${first}]; dimension names must be unique.`);
    } else {
      seen.set(key, index);
    }
  });
  spec.series.forEach((series, seriesIndex) => {
    series.values.forEach((value, valueIndex) => {
      if (value < 0 || value > spec.radarScale.max) {
        report('out_of_range', ['series', seriesIndex, 'values', valueIndex],
          `series[${seriesIndex}].values[${valueIndex}] is ${value}, outside radarScale 0-${spec.radarScale.max}. All dimensions share one fixed scale; normalize heterogeneous indicators first and state the method in the text.`);
      }
    });
  });
}

function checkCombo(spec: ComboMarkdownChartSpec, report: IssueSink): void {
  const hosted = (axis: 'primary' | 'secondary') =>
    spec.series.flatMap((series, index) => ((series.axis ?? 'primary') === axis ? [{ series, index }] : []));
  const primary = hosted('primary');
  const secondary = hosted('secondary');

  if (primary.length === 0) {
    report('invalid_combination', ['series'], 'combo charts need at least one series on the primary axis.');
  }
  if (secondary.length > 0 && !spec.secondaryValueAxis) {
    report('invalid_combination', ['secondaryValueAxis'],
      'series on the secondary axis require secondaryValueAxis so the second unit is labelled.');
  }
  if (secondary.length === 0 && spec.secondaryValueAxis) {
    report('invalid_combination', ['secondaryValueAxis'],
      'secondaryValueAxis is declared but no series uses axis "secondary"; remove it or assign a series.');
  }

  spec.series.forEach((series, index) => {
    if (series.pointColors && series.chartType !== 'bar') {
      report('invalid_combination', ['series', index, 'pointColors'],
        `pointColors only applies to bar series, but series[${index}] is a ${series.chartType} series.`);
    }
    if ((series.lineDash || series.marker) && series.chartType !== 'line') {
      report('invalid_combination', ['series', index, series.lineDash ? 'lineDash' : 'marker'],
        `lineDash and marker only apply to line series, but series[${index}] is a ${series.chartType} series.`);
    }
  });

  const needsZero = (items: typeof primary) => items.some(({ series }) => series.chartType !== 'line');
  checkAxis(spec.valueAxis, ['valueAxis'], report, { includeZero: needsZero(primary) });
  checkAxis(spec.secondaryValueAxis, ['secondaryValueAxis'], report, { includeZero: needsZero(secondary) });
}

/** 返回全部违反的规则；空数组表示该规格在数据语义上自洽。 */
export function checkMarkdownChartRules(spec: MarkdownChartSpec): readonly MarkdownChartRuleIssue[] {
  const issues: MarkdownChartRuleIssue[] = [];
  const report: IssueSink = (code, path, message) => { issues.push({ code, path, message }); };

  checkLimits(spec, report);
  checkSeriesShape(spec, report);

  switch (spec.chartType) {
    case 'bar':
      checkBar(spec, report);
      break;
    case 'line':
      checkAxis(spec.valueAxis, ['valueAxis'], report, { includeZero: false });
      break;
    case 'area':
      checkAxis(spec.valueAxis, ['valueAxis'], report, { includeZero: true });
      break;
    case 'pie':
    case 'doughnut':
      checkShare(spec, report);
      break;
    case 'scatter':
      checkScatter(spec, report);
      break;
    case 'radar':
      checkRadar(spec, report);
      break;
    case 'combo':
      checkCombo(spec, report);
      break;
  }

  // 保存 spec 属性和围栏写入共用这一闸门，否则可存入无法再导入的超限文档。
  if (issues.length === 0 && new TextEncoder().encode(serializeMarkdownChartSpec(spec)).length > MARKDOWN_CHART_LIMITS.maxCanonicalBytes) {
    report('limit_exceeded', [],
      `the canonical spec exceeds ${MARKDOWN_CHART_LIMITS.maxCanonicalBytes / 1024} KiB; aggregate the data or split the chart.`);
  }
  return issues;
}
