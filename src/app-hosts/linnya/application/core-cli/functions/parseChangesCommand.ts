import { parseArgs } from 'node:util';
import { ACTION_LEDGER_MAX_QUERY_LIMIT, type ActionLedgerChangeQuery } from 'src/domains/action-ledger';

export const CHANGES_USAGE = 'linnya changes [--day today|yesterday|YYYY-MM-DD | --since YYYY-MM-DD --until YYYY-MM-DD] [--run ROOT_RUN_ID] [--limit 1..200]';
type ChangeFilters = Omit<ActionLedgerChangeQuery, 'projectId'>;

/** 以宿主当地日历解释日期。次日零点必须用日历加一天，夏令时当日未必有 24 小时。 */
function localMidnight(value: string): Date {
  if (!/^\d{4}-\d\d-\d\d$/u.test(value)) throw new Error('日期须为 YYYY-MM-DD');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const result = new Date(2000, 0, 1);
  result.setFullYear(year, month - 1, day);
  if (result.getFullYear() !== year || result.getMonth() + 1 !== month || result.getDate() !== day) {
    throw new Error(`无效日期：${value}`);
  }
  return result;
}

export function parseChangesCommand(argv: readonly string[], now: Date): ChangeFilters {
  const { values } = parseArgs({
    args: [...argv], options: {
      day: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' },
      run: { type: 'string' }, limit: { type: 'string', default: '30' },
    },
  });
  const limit = Number(values.limit);
  if (!/^\d+$/u.test(values.limit) || !Number.isInteger(limit) || limit < 1 || limit > ACTION_LEDGER_MAX_QUERY_LIMIT) {
    throw new Error('limit 须为 1–200 的整数');
  }
  if (values.run !== undefined && !values.run.trim()) throw new Error('run 不能为空');
  let since: number | undefined;
  let until: number | undefined;
  if (values.day !== undefined) {
    if (values.since !== undefined || values.until !== undefined) throw new Error('day 与 since/until 不能同时使用');
    const start = values.day === 'today' || values.day === 'yesterday'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(values.day === 'yesterday'))
      : localMidnight(values.day);
    since = start.getTime();
    start.setDate(start.getDate() + 1);
    until = start.getTime();
  } else {
    if (values.since !== undefined) since = localMidnight(values.since).getTime();
    if (values.until !== undefined) until = localMidnight(values.until).getTime();
  }
  if (since !== undefined && until !== undefined && since >= until) throw new Error('until 须晚于 since（不含终点）');
  return {
    limit,
    ...(values.run ? { rootRunId: values.run } : {}),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
  };
}
