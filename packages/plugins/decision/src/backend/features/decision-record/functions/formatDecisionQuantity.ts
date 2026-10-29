import type { DecisionQuantityType } from '../../../../shared';

/** 量类型是业务合同，unit仅为展示文字；不把耗时当时刻，不折回跨日。 */
export function formatDecisionClock(value: number, quantityType: DecisionQuantityType): string | null {
  if (quantityType !== 'day_clock' || !Number.isInteger(value) || value < 0 || value >= 1440) return null;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function formatDecisionQuantity(value: number, unit?: string, quantityType: DecisionQuantityType = 'other'): string {
  const clock = formatDecisionClock(value, quantityType);
  return `${value}${clock ? `（${clock}）` : ''}${unit ? ` ${unit}` : ''}`;
}
