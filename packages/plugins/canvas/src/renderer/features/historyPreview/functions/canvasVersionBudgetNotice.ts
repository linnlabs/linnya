import type { CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
export function canvasVersionBudgetNotice(status: CanvasVersionBudgetStatus | null): string | null {
  if (!status || status.overBudgetBytes === 0) return null;
  const mib = (bytes: number) => (bytes / 1024 / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  return `版本历史占用 ${mib(status.usedBytes)} MiB，超出 ${mib(status.budgetBytes)} MiB 软预算 ${mib(status.overBudgetBytes)} MiB。最近5个版本和仍在使用的资源会继续保留。`;
}
