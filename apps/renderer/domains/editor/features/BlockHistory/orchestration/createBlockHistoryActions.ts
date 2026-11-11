import { blockHistoryGateway } from '@/shared/ipc/blockHistoryGateway';
import type { BlockVersion, CreateBlockVersionParams } from '@/shared/ipc/blockHistoryGateway';
import type { useBlockHistoryState } from '../store/useBlockHistoryStore';
import { projectBlockHistoryAfterDeletion } from '../functions/projectBlockHistoryAfterDeletion';

export function createBlockHistoryActions(state: ReturnType<typeof useBlockHistoryState>) {
  const { versionsByBlock } = state;
  const inFlightLoads = new Map<string, Promise<void>>();
  async function loadBlockHistory(documentNodeId: string, blockId: string): Promise<void> {
    const requestKey = `${documentNodeId}::${blockId}`;
    const existingLoad = inFlightLoads.get(requestKey);
    if (existingLoad) {
      return existingLoad;
    }

    const loadPromise = (async () => {
      // 设置加载状态
      state.setLoading(blockId, true);

      try {
        const result = await blockHistoryGateway.listVersions({
          documentNodeId,
          targetBlockId: blockId,
        });

        if (result.success) {
          state.setVersions(blockId, result.data);
        } else {
          console.error('[BlockHistoryStore] 加载历史版本失败:', result.error);
          state.setVersions(blockId, []);
        }
      } catch (error) {
        console.error('[BlockHistoryStore] 加载历史版本异常:', error);
        state.setVersions(blockId, []);
      } finally {
        state.setLoading(blockId, false);
        inFlightLoads.delete(requestKey);
      }
    })();

    inFlightLoads.set(requestKey, loadPromise);
    return loadPromise;
  }

  async function restoreVersion(
    documentNodeId: string,
    blockId: string,
    versionId: string
  ): Promise<BlockVersion | null> {
    console.log('[BlockHistoryStore] Requesting restoreVersion:', { blockId, versionId });
    try {
      const result = await blockHistoryGateway.restoreVersion({
        documentNodeId,
        targetBlockId: blockId,
        sourceVersionId: versionId,
      });

      if (result.success) {
        console.log(
          '[BlockHistoryStore] Restore successful, new version created:',
          result.data.version_number
        );
        // 重新加载版本列表
        await loadBlockHistory(documentNodeId, blockId);
        return result.data;
      } else {
        console.error('[BlockHistoryStore] 恢复版本失败:', result.error);
        return null;
      }
    } catch (error) {
      console.error('[BlockHistoryStore] 恢复版本异常:', error);
      return null;
    }
  }

  async function createVersion(params: CreateBlockVersionParams): Promise<BlockVersion | null> {
    try {
      const result = await blockHistoryGateway.createVersion(params);

      if (result.success) {
        // 更新本地缓存
        const blockId = params.targetBlockId;
        state.prependVersion(blockId, result.data);
        return result.data;
      } else {
        console.error('[BlockHistoryStore] 创建版本失败:', result.error);
        return null;
      }
    } catch (error) {
      console.error('[BlockHistoryStore] 创建版本异常:', error);
      return null;
    }
  }

  async function deleteVersion(versionId: string): Promise<void> {
    // 找到该版本所属的块以及在列表中的下标
    let targetBlockId: string | null = null;
    let targetIndex = -1;

    for (const [blockId, versions] of Object.entries(versionsByBlock.value)) {
      const index = versions.findIndex(version => version.id === versionId);
      if (index !== -1) {
        targetBlockId = blockId;
        targetIndex = index;
        break;
      }
    }

    if (!targetBlockId || targetIndex === -1) {
      console.warn('[BlockHistoryStore] deleteVersion: 未在本地缓存中找到目标版本', versionId);
      // 依然尝试通知后端删除，以防只是本地状态缺失
      await blockHistoryGateway.deleteVersion({ versionId });
      return;
    }

    try {
      const result = await blockHistoryGateway.deleteVersion({ versionId });
      if (!result.success) {
        console.error('[BlockHistoryStore] 删除版本失败:', result.error);
        return;
      }
    } catch (error) {
      console.error('[BlockHistoryStore] 删除版本异常:', error);
      return;
    }

    const currentVersions = versionsByBlock.value[targetBlockId] ?? [];
    if (!currentVersions.length) {
      return;
    }

    const plan = projectBlockHistoryAfterDeletion(
      currentVersions,
      state.getUiState(targetBlockId),
      targetIndex,
      versionId
    );
    state.setVersions(targetBlockId, plan.versions);
    state.setUiState(targetBlockId, plan.uiState);
  }
  return { loadBlockHistory, restoreVersion, createVersion, deleteVersion };
}
