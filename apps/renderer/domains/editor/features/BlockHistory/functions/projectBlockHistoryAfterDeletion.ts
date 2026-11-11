import type { BlockVersion } from '@/shared/ipc/blockHistoryGateway';
import type { BlockHistoryUiState } from '../definitions/blockHistory';

/** 删除选中项时优先选下一项，没有下一项则选上一项。 */
export function projectBlockHistoryAfterDeletion(
  currentVersions: BlockVersion[],
  uiState: BlockHistoryUiState,
  targetIndex: number,
  versionId: string
) {
  const newVersions = [...currentVersions];
  newVersions.splice(targetIndex, 1);

  // 处理“自动跳到最近的版本”的逻辑

  const isDeletedSelected = uiState.selectedVersionId === versionId;

  let nextSelectedId: string | undefined = uiState.selectedVersionId;

  if (isDeletedSelected) {
    const neighbor = newVersions[targetIndex] ?? newVersions[targetIndex - 1] ?? null;

    nextSelectedId = neighbor ? neighbor.id : undefined;
  }

  return {
    versions: newVersions,
    uiState: {
      ...uiState,
      selectedVersionId: nextSelectedId,
    },
  };
}
