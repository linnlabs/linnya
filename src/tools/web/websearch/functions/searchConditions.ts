import type {
  WebSearchConditionExecution,
  WebSearchConditionName,
  WebSearchConditionReport,
  WebSearchParams,
} from '../providers/types';

export type RecencyBucket = 'day' | 'week' | 'month' | 'year';

const BUCKET_LABEL: Record<RecencyBucket, string> = {
  day: 'past day',
  week: 'past week',
  month: 'past month',
  year: 'past year',
};

/**
 * 离散时间窗只向上取整，不缩小模型要求的范围；超过一年时不加过滤，
 * 否则 400 天会被截成一年、漏掉合格结果。
 */
export function bucketRecency(recencyDays: number | undefined): RecencyBucket | undefined {
  if (!recencyDays || recencyDays <= 0) return undefined;
  if (recencyDays <= 1) return 'day';
  if (recencyDays <= 7) return 'week';
  if (recencyDays <= 31) return 'month';
  if (recencyDays <= 366) return 'year';
  return undefined;
}

type ConditionRule =
  | WebSearchConditionExecution
  | { readonly execution: WebSearchConditionExecution; readonly detail?: string };

/** 离散时间窗服务的统一描述：取整后算已执行，超出最大窗口算不支持。 */
export function describeBucketedRecency(recencyDays: number | undefined): ConditionRule {
  const bucket = bucketRecency(recencyDays);
  return bucket
    ? { execution: 'applied', detail: `as ${BUCKET_LABEL[bucket]}` }
    : { execution: 'unsupported', detail: 'longer than the largest time range this service offers' };
}

function readValue(params: WebSearchParams, condition: WebSearchConditionName): string | undefined {
  switch (condition) {
    case 'site': return params.site;
    case 'recency_days': return params.recencyDays === undefined ? undefined : String(params.recencyDays);
    case 'language': return params.language;
  }
}

/** 只报告本次真的带了的条件；每个服务按自己的请求实现声明规则。 */
export function describeSearchConditions(
  params: WebSearchParams,
  rules: Readonly<Record<WebSearchConditionName, ConditionRule>>,
): WebSearchConditionReport[] {
  const order: WebSearchConditionName[] = ['site', 'recency_days', 'language'];
  return order.flatMap((condition) => {
    const value = readValue(params, condition);
    if (value === undefined) return [];
    const rule = rules[condition];
    return [typeof rule === 'string'
      ? { condition, value, execution: rule }
      : { condition, value, execution: rule.execution, ...(rule.detail ? { detail: rule.detail } : {}) }];
  });
}

/** 端点进入缓存键并落盘，只保留 origin 与路径，去掉用户名、口令和查询串。 */
export function toEndpointIdentity(baseUrl: string | undefined, fallback: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return fallback;
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
  } catch {
    return fallback;
  }
}
