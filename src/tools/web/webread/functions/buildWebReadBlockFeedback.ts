import type { WebReadAccessCounts } from '../definitions/webReadAccessHistory';

/** hostname 来自已通过 URL admission 的请求，不合并子域，也不沿用网页正文。 */
export function buildWebReadBlockFeedback(hostname: string, history: WebReadAccessCounts): string {
  return `本会话（含子任务）对请求主机 ${hostname} 的已完成 web_read 调用：已确认访问拦截 ${history.blocked + 1} 次（含本次），成功返回 ${history.succeeded} 次${history.unclassified > 0 ? `，另有 ${history.unclassified} 次历史失败缺少可判定根因` : ''}。这些是调用记录，不证明整个网站均不可读。优先寻找其他主机上的官方副本、原件或可靠替代来源；只有具备新的访问条件或明确的新页面依据时再尝试同一主机。工具仍允许读取该主机，不会自动封禁或重试。`;
}
