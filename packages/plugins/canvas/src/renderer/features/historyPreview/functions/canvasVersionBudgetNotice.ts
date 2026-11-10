import type { CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
import { canvasLocale, canvasText } from '../../localization';
export function canvasVersionBudgetNotice(status: CanvasVersionBudgetStatus | null): string | null {
  if (!status || status.overBudgetBytes === 0) return null;
  const mib = (bytes: number) =>
    (bytes / 1024 / 1024).toLocaleString(canvasLocale(), { maximumFractionDigits: 1 });
  return canvasText('canvas.history.budget', {
    used: mib(status.usedBytes),
    budget: mib(status.budgetBytes),
    over: mib(status.overBudgetBytes),
  });
}
