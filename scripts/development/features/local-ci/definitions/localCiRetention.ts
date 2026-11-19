/** 每个工作区 `_dev_data/ci-local/` 里保留的最近运行目录数（含本次运行）。 */
export const LOCAL_CI_KEEP_RUNS = 20;

/** 通过的完整回执至少保留这么多天：合入与推送 main 的门禁按代码内容（tree）查找它们。 */
export const LOCAL_CI_RECEIPT_KEEP_DAYS = 7;

/** 运行目录名是 UTC 时间戳，如 `2026-11-19T10-30-55`；不符合的目录不是运行结果，不清理。 */
export const LOCAL_CI_RUN_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/u;

/** 回执 `summary.json` 里清理判断用到的字段。 */
export interface LocalCiReceiptFacts {
  readonly tree?: string;
  readonly clean?: boolean;
  readonly fullRun?: boolean;
  readonly passed?: boolean;
}

export interface LocalCiRunRecord {
  readonly name: string;
  /** 由目录名解析的运行开始时间。 */
  readonly startedAtMs: number;
  /** 没有或读不出 `summary.json`（运行中、被强杀、已损坏）时为 null。 */
  readonly receipt: LocalCiReceiptFacts | null;
}
