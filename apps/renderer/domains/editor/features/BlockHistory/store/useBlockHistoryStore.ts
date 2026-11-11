import { ref, computed } from 'vue';
import type { BlockVersion } from '@/shared/ipc/blockHistoryGateway';
import type { BlockHistoryUiState, HistoryViewMode } from '../definitions/blockHistory';
import { getDefaultUiState } from '../functions/createDefaultBlockHistoryUiState';

function createBlockHistoryState() {
  const versionsByBlock = ref<Record<string, BlockVersion[]>>({});
  const uiStateByBlock = ref<Record<string, BlockHistoryUiState>>({});
  const hasAnyHistoryMode = computed(() =>
    Object.values(uiStateByBlock.value).some(s => s.mode !== 'none')
  );
  function setVersions(blockId: string, versions: BlockVersion[]): void {
    versionsByBlock.value[blockId] = versions;
  }
  function prependVersion(blockId: string, version: BlockVersion): void {
    if (!versionsByBlock.value[blockId]) versionsByBlock.value[blockId] = [];
    versionsByBlock.value[blockId].unshift(version);
  }
  function setUiState(blockId: string, state: BlockHistoryUiState): void {
    uiStateByBlock.value[blockId] = state;
  }
  function setLoading(blockId: string, loading: boolean): void {
    if (!uiStateByBlock.value[blockId]) uiStateByBlock.value[blockId] = getDefaultUiState();
    uiStateByBlock.value[blockId].isLoading = loading;
  }
  function getVersions(blockId: string): BlockVersion[] {
    return versionsByBlock.value[blockId] || [];
  }

  function getUiState(blockId: string): BlockHistoryUiState {
    return uiStateByBlock.value[blockId] || getDefaultUiState();
  }

  function setViewMode(blockId: string, mode: HistoryViewMode): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState();
    }
    // 确保响应式更新
    uiStateByBlock.value[blockId] = {
      ...uiStateByBlock.value[blockId],
      mode,
    };
  }

  function selectVersion(blockId: string, versionId: string): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState();
    }
    // 确保响应式更新
    uiStateByBlock.value[blockId] = {
      ...uiStateByBlock.value[blockId],
      selectedVersionId: versionId,
    };
  }

  function selectMultipleVersions(blockId: string, versionIds: string[]): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState();
    }
    uiStateByBlock.value[blockId].selectedVersionIds = versionIds;
  }

  function setFocusedLineIndex(blockId: string, lineIndex: number): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState();
    }
    uiStateByBlock.value[blockId].focusedLineIndex = lineIndex;
  }

  function exitHistoryMode(blockId: string): void {
    if (uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = {
        ...uiStateByBlock.value[blockId],
        mode: 'none',
        selectedVersionId: undefined,
        selectedVersionIds: undefined,
        focusedLineIndex: undefined,
      };
    }
  }

  function clearBlockHistory(blockId: string): void {
    delete versionsByBlock.value[blockId];
    delete uiStateByBlock.value[blockId];
  }

  function isInHistoryMode(blockId: string): boolean {
    const state = uiStateByBlock.value[blockId];
    return state?.mode !== 'none' && state?.mode !== undefined;
  }
  return {
    versionsByBlock,
    uiStateByBlock,
    hasAnyHistoryMode,
    setVersions,
    prependVersion,
    setUiState,
    setLoading,
    getVersions,
    getUiState,
    setViewMode,
    selectVersion,
    selectMultipleVersions,
    setFocusedLineIndex,
    exitHistoryMode,
    clearBlockHistory,
    isInHistoryMode,
  };
}
// 与原先一致：编辑器视图、菜单和历史面板共享 Renderer 进程内的一个状态实例。
let singleton: ReturnType<typeof createBlockHistoryState> | null = null;
export function useBlockHistoryState() {
  return (singleton ??= createBlockHistoryState());
}
