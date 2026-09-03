import type { RuntimeEvent } from './events';

/**
 * Graph context compaction 向执行宿主报告摘要展示生命周期的唯一回调合同。
 *
 * 这里刻意只传递框架事实，不暴露 Host 的 SSE 表示：Host 只负责短生命周期
 * presentation；Context Manager 只创建 pending draft，Graph 的
 * `commit_context_compaction` stage 才能发布 `history_summary`。Graph Engine 与 Host
 * 必须共同导入本合同，禁止复制宽 `unknown` 形状。这是
 * no-throw presentation port：Host transport 失败只能记录，不得改写 durable 压缩结果。
 */
export interface SummarizationCallbacks {
  onSummarizationStart?: () => void;
  onSummarizationEnd?: (info: {
    originalMessageCount: number;
    summaryTokenCount?: number;
    /** 完成回调只读取该事实计算展示统计，不负责发布。 */
    summaryEvent: Extract<RuntimeEvent, { type: 'history_summary' }>;
  }) => void;
  onSummarizationError?: (error: Error) => void;
}
