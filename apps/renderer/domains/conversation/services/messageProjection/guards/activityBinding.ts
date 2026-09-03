import type { ActivityBinding } from '../../../types';
import { isActivityBinding, isRecord } from '../../../utils/typeGuards';

/**
 * @description
 * 从 SSE event 的 metadata 中提取外部活动归属元数据（runId/feature）。
 *
 * 说明：
 * - 该字段只表达运行归属，不参与 UI 分组或组件选择。
 */
export function extractActivityBinding(event: unknown): ActivityBinding | undefined {
  if (!isRecord(event)) return undefined;
  const meta = event.metadata;
  if (!isRecord(meta)) return undefined;
  const wireBinding = meta.activity;
  if (!isActivityBinding(wireBinding)) return undefined;
  return wireBinding;
}
