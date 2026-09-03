/**
 * @file workspacePendingCitation.ts
 * @description workspace pending 注入后的 citation 派生判断。
 *
 * 中文说明：
 * - 这是纯函数文件，不依赖 Tiptap / Pinia / DOM；
 * - 供 workspacePending.ts 决定是否需要额外触发 forceCitationDerivation。
 */

import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway';

function hasCitationHydration(metaJson: string | null): boolean {
  if (!metaJson) return false;
  try {
    const parsed: unknown = JSON.parse(metaJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const hydration = (parsed as Record<string, unknown>).citation_hydration;
    return !!hydration && typeof hydration === 'object' && !Array.isArray(hydration) && Object.keys(hydration).length > 0;
  } catch {
    return false;
  }
}

export function pendingListMayAffectCitationDerivation(pending: WorkspacePendingRevisionDTO[]): boolean {
  return pending.some((dto) => {
    if (typeof dto.newMarkdown === 'string' && dto.newMarkdown.includes('[@')) return true;
    return hasCitationHydration(typeof dto.metaJson === 'string' ? dto.metaJson : null);
  });
}
