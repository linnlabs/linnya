/** 已完成的 web_read 工具调用；不是 HTTP 重试次数，也不代表整站可访问性。 */
export interface WebReadAccessCounts {
  readonly blocked: number;
  readonly succeeded: number;
  /** 旧错误没有根因码，不能从文案猜成拦截或成功。 */
  readonly unclassified: number;
}

export interface WebReadAccessHistoryPort {
  /** Host 绑定当前 conversation，包含其 child；排除正在执行的同一调用。 */
  read(params: {
    readonly hostname: string;
    readonly currentRunId?: string;
    readonly currentToolCallId?: string;
  }): WebReadAccessCounts;
  /** 仅核对本会话正式成功 Web 结果中的来源/资源 URL；没有该能力不等于未出现。 */
  hasObservedUrl?(params: {
    readonly url: string;
    readonly currentRunId?: string;
    readonly currentToolCallId?: string;
  }): boolean;
}
