import type { ToolContext } from '../../types';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

export function readTaskStateWorkingHistory(
  context: ToolContext,
  errorPrefix: string,
): ReadonlyArray<RuntimeEvent> {
  if (!context.conversationView) {
    throw new Error(`${errorPrefix} 工具上下文缺少 admitted conversationView。`);
  }
  return context.conversationView.getWorkingHistoryEvents();
}
