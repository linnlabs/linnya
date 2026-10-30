import type { DecisionQuantityType } from '../../../../shared';
import type { CheckValueResult } from '../definitions/decisionEvaluation';
import { formatDecisionClock } from '../functions/formatDecisionQuantity';

/** 声明文字作为数据展示，不能借换行、表格或HTML冒充程序章节。 */
export function decisionMarkdownText(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/&/g, '&amp;').replace(/([\\`*_{}[\]<>|])/g, '\\$1');
}

export function decisionMarkdownScalar(value: string | number | boolean, quantityType: DecisionQuantityType = 'other'): string {
  const clock = typeof value === 'number' ? formatDecisionClock(value, quantityType) : null;
  return decisionMarkdownText(typeof value === 'string' ? JSON.stringify(value) : `${value}${clock ? `（${clock}）` : ''}`);
}

export function decisionMarkdownResult(value: CheckValueResult, quantityType: DecisionQuantityType = 'other'): string {
  return value.status === 'available' ? decisionMarkdownScalar(value.value, quantityType) : `不可用：${decisionMarkdownText(value.reason)}`;
}

export function decisionMarkdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers.join(' | '), headers.map(() => '---').join(' | '), ...rows.map(row => row.join(' | '))].join('\n');
}
