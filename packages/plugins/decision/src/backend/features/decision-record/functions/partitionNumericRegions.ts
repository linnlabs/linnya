import type { NumericRegion } from '../definitions/optionRange';

/** 全部已求得的交点分割数轴，等号单独一格，供仿射检查及事件排序共同使用。 */
export function partitionNumericRegions(endpoints: readonly number[]): NumericRegion[] {
  const regions: NumericRegion[] = [];
  let previous: number | null = null;
  for (const endpoint of [...new Set(endpoints)].sort((a, b) => a - b)) {
    regions.push({ lower: previous, upper: endpoint, lowerInclusive: false, upperInclusive: false });
    regions.push({ lower: endpoint, upper: endpoint, lowerInclusive: true, upperInclusive: true });
    previous = endpoint;
  }
  regions.push({ lower: previous, upper: null, lowerInclusive: false, upperInclusive: false });
  return regions;
}
