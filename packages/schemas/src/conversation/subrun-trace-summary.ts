/**
 * 父工具行上的轻量 subrun 索引。
 *
 * 完整 child facts 仍由 EventStore 持有；用于父卡展示的 trace 由 Host 紧凑历史 read model
 * 持有。父工具行只保留 child 清单和事件计数，避免列表渲染依赖完整事件树。
 */
export interface SubrunTraceSummary {
  readonly subrun_ids: readonly string[];
  readonly event_counts: Readonly<Record<string, number>>;
}

export function readSubrunTraceSummary(value: unknown): SubrunTraceSummary {
  if (!isRecord(value)) {
    return { subrun_ids: [], event_counts: {} };
  }

  const subrunIds = Array.isArray(value['subrun_ids'])
    ? readUniqueNonEmptyStrings(value['subrun_ids'])
    : [];
  const rawEventCounts = isRecord(value['event_counts']) ? value['event_counts'] : {};
  const eventCounts: Record<string, number> = {};
  for (const [subrunId, count] of Object.entries(rawEventCounts)) {
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      eventCounts[subrunId] = count;
    }
  }

  return {
    subrun_ids: subrunIds,
    event_counts: eventCounts,
  };
}

export function appendSubrunTraceSummary(
  current: unknown,
  subrunId: string,
): SubrunTraceSummary {
  const summary = readSubrunTraceSummary(current);
  return {
    subrun_ids: summary.subrun_ids.includes(subrunId)
      ? summary.subrun_ids
      : [...summary.subrun_ids, subrunId],
    event_counts: {
      ...summary.event_counts,
      [subrunId]: (summary.event_counts[subrunId] ?? 0) + 1,
    },
  };
}

/**
 * 从 StructuredToolResult 读取 batch tool 声明的权威 child 清单。
 *
 * `null` 表示该工具结果没有声明此契约；空数组则表示工具明确声明没有 child。
 */
export function readStructuredToolResultSubrunIds(result: unknown): readonly string[] | null {
  if (!isRecord(result) || !isRecord(result['data'])) {
    return null;
  }
  const rawSubrunIds = result['data']['subrun_ids'];
  if (!Array.isArray(rawSubrunIds)) {
    return null;
  }
  return readUniqueNonEmptyStrings(rawSubrunIds);
}

/**
 * tool_output 的清单决定稳定顺序，trace 只补充运行中已经出现的合法 child 和事件数。
 * 权威清单中的零 trace child 必须保留，并显式记为 0 次事件。
 */
export function mergeSubrunTraceSummaryWithAuthoritativeIds(
  current: unknown,
  authoritativeSubrunIds: readonly string[],
): SubrunTraceSummary {
  const summary = readSubrunTraceSummary(current);
  const mergedIds = readUniqueNonEmptyStrings([
    ...authoritativeSubrunIds,
    ...summary.subrun_ids,
  ]);
  const eventCounts: Record<string, number> = {};
  for (const subrunId of mergedIds) {
    eventCounts[subrunId] = summary.event_counts[subrunId] ?? 0;
  }
  return {
    subrun_ids: mergedIds,
    event_counts: eventCounts,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUniqueNonEmptyStrings(values: readonly unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
