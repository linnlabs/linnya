import type { RuntimeEvent } from '../../contracts';

export interface ToolContextConversationView {
  /**
   * 当前工具执行可见的 working history
   *
   * 中文备注：
   * - 该视图允许工具读取“本轮 run 中已产生、但可能尚未持久化”的最新事实事件；
   * - ToolNode / graph runtime 后续只应更新这一层背后的 source，而不是覆写顶层 getter。
   */
  getWorkingHistoryEvents(): ReadonlyArray<RuntimeEvent>;

  /**
   * run 启动时的 persisted history 视图
   *
   * 中文备注：
   * - 该视图对应 EventStore 回放得到的稳定历史；
   * - 与 working history 显式区分，避免调用方误把“最新运行态”当成“已持久化事实”。
   */
  getPersistedHistoryEvents(): ReadonlyArray<RuntimeEvent>;
}
