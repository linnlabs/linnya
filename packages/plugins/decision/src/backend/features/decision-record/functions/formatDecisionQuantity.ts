/** 只认已声明的当天钟点单位；不把耗时当时刻，也不暗中折回跨日数值。 */
export function formatDecisionClock(value: number, unit: string | undefined): string | null {
  if (unit !== '当天00:00起分钟' || !Number.isInteger(value) || value < 0 || value >= 1440) return null;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function formatDecisionQuantity(value: number, unit?: string): string {
  const clock = formatDecisionClock(value, unit);
  return `${value}${clock ? `（${clock}）` : ''}${unit ? ` ${unit}` : ''}`;
}
